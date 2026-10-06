import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// Teste da nova funcionalidade:
// Mesmo com cache válido, um processo em segundo plano busca atualizações
// remotas de repositórios no GitLab/GitHub, descobre novos repositórios criados
// recentemente, atualiza o cache em disco e notifica a árvore via onTreeUpdated.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-bg-cache-home-"));
const tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "paje-bg-cache-repos-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

let serverInstance: http.Server | null = null;

try {
  // Configura um servidor HTTP mock simulando o GitLab
  const mockGroups = [{ id: 1, name: "grupo", full_path: "grupo", path: "grupo" }];
  const mockProjects = [
    {
      id: 101,
      name: "proj-a",
      path_with_namespace: "grupo/proj-a",
      ssh_url_to_repo: "git@mock.gitlab:grupo/proj-a.git",
      http_url_to_repo: "http://127.0.0.1:0/grupo/proj-a.git",
      default_branch: "main",
      visibility: "private",
      archived: false,
    },
    {
      id: 102,
      name: "proj-novo",
      path_with_namespace: "grupo/proj-novo",
      ssh_url_to_repo: "git@mock.gitlab:grupo/proj-novo.git",
      http_url_to_repo: "http://127.0.0.1:0/grupo/proj-novo.git",
      default_branch: "main",
      visibility: "private",
      archived: false,
    },
  ];

  const serverPort = await new Promise<number>((resolve) => {
    serverInstance = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      res.setHeader("Content-Type", "application/json");
      if (url.pathname.includes("/api/v4/groups")) {
        res.writeHead(200);
        res.end(JSON.stringify(mockGroups));
      } else if (url.pathname.includes("/api/v4/projects")) {
        res.writeHead(200);
        res.end(JSON.stringify(mockProjects));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    serverInstance.listen(0, "127.0.0.1", () => {
      const addr = serverInstance!.address() as { port: number };
      resolve(addr.port);
    });
  });

  const baseUrl = `http://127.0.0.1:${serverPort}`;

  const { createGitSyncCore, computeConfigHash } = await import(
    "../src/modules/git/core/gitSyncService.js"
  );
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const servers = [
    {
      id: baseUrl,
      name: "GitLab-Mock",
      baseUrl,
      token: "mock-token",
      useBasicAuth: false,
    },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  // Cache antigo: continha apenas proj-a (id 101)
  const cachedProjects = [mockProjects[0]];
  const configHash = computeConfigHash(servers.map((s) => ({ ...s })));
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [{ serverName: "GitLab-Mock", groups: mockGroups, projects: cachedProjects }],
      statusMap: { 101: { state: "EMPTY", branch: "main" } },
    })
  );

  const config = {
    baseDir: tmpRepos,
    prepareLocalDirs: false,
    noPublicRepos: false,
    noArchivedRepos: false,
    filter: "",
    syncRepos: "",
    verbose: false,
  } as unknown as import("../src/modules/git/core/gitSyncConfig.js").GitSyncConfig;

  let bgStarted = false;
  let bgEnded = false;
  let updatedTreeData: { projects: unknown[] } | null = null;

  const core = createGitSyncCore();
  const initialView = await core.loadTree({
    config,
    logger: new LoggerBroker(),
    onBackgroundSyncStart: () => {
      bgStarted = true;
    },
    onBackgroundSyncEnd: () => {
      bgEnded = true;
    },
    onTreeUpdated: (data) => {
      updatedTreeData = data;
    },
  });

  // 1. Deve abrir imediatamente a partir do cache inicial com 1 projeto
  assert.equal(initialView.fromCache, true, "Deve carregar instantaneamente do cache");
  assert.equal(initialView.projects.length, 1, "Cache inicial continha apenas 1 projeto");
  assert.equal(bgStarted, true, "onBackgroundSyncStart deve ter sido disparado");

  // Aguarda a sincronização em segundo plano completar
  const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  };

  const bgCompleted = await waitFor(() => bgEnded);
  assert.ok(bgCompleted, "Background sync deve terminar dentro do tempo limite");

  // 2. Deve ter notificado a árvore com os 2 projetos (incluindo o novo proj-novo)
  assert.ok(updatedTreeData !== null, "onTreeUpdated deve ter sido chamado com a nova árvore");
  assert.equal((updatedTreeData as { projects: unknown[] }).projects.length, 2, "Nova árvore deve ter 2 projetos");

  // 3. O arquivo de cache em disco deve ter sido atualizado com o novo projeto
  const rawCache = JSON.parse(fs.readFileSync(paths.treeCacheFile, "utf-8"));
  const cachedProjs = rawCache.servers[0].projects;
  assert.equal(cachedProjs.length, 2, "Cache em disco deve conter os 2 projetos após atualização");
  assert.ok(
    cachedProjs.some((p: { name: string }) => p.name === "proj-novo"),
    "proj-novo deve estar persistido no cache"
  );
} finally {
  if (serverInstance) {
    await new Promise((resolve) => serverInstance!.close(resolve));
  }
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepos, { recursive: true, force: true });
}

console.log("git_sync_background_remote_refresh_test: OK");
