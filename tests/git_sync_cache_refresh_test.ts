import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regressões cobertas:
// 1. loadTree com cache válido retorna imediatamente (fromCache: true) sem
//    chamadas de API.
// 2. O refresh de status em background entrega cada status individualmente
//    via onStatusRefreshed (entrega incremental, não em barreira única).
// 3. Ao final do refresh o cache é regravado com o statusMap atualizado.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-cache-home-"));
const tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "paje-cache-repos-"));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

try {
  const { createGitSyncCore, computeConfigHash } = await import(
    "../src/modules/git/core/gitSyncService.js"
  );
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const servers = [
    {
      id: "https://git.exemplo.com",
      name: "Exemplo",
      baseUrl: "https://git.exemplo.com",
      useBasicAuth: false,
    },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  const groups = [{ id: 1, name: "grupo", full_path: "grupo" }];
  const projects = [
    {
      id: 101,
      name: "proj-a",
      path_with_namespace: "grupo/proj-a",
      ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-a.git",
      http_url_to_repo: "https://git.exemplo.com/grupo/proj-a.git",
      default_branch: "main",
      visibility: "private" as const,
    },
    {
      id: 102,
      name: "proj-b",
      path_with_namespace: "grupo/proj-b",
      ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-b.git",
      http_url_to_repo: "https://git.exemplo.com/grupo/proj-b.git",
      default_branch: "main",
      visibility: "private" as const,
    },
  ];

  const configHash = computeConfigHash(
    servers.map((s) => ({ ...s }))
  );
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [{ serverName: "Exemplo", groups, projects }],
      statusMap: {},
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

  const refreshed: Array<{ id: number; state: string }> = [];
  const core = createGitSyncCore();
  const started = Date.now();
  const view = await core.loadTree({
    config,
    logger: new LoggerBroker(),
    onStatusRefreshed: (projectId, status) => {
      refreshed.push({ id: projectId, state: status.state });
    },
  });
  const elapsed = Date.now() - started;

  assert.equal(view.fromCache, true, "loadTree deve responder a partir do cache");
  assert.ok(view.tree.length > 0, "Árvore do cache não deve ser vazia");
  assert.equal(view.projects.length, 2, "Ambos os projetos do cache devem ser carregados");
  assert.ok(elapsed < 2000, `Cache hit deve ser rápido (levou ${elapsed}ms)`);

  const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  };

  const allRefreshed = await waitFor(() => refreshed.length === 2);
  assert.ok(allRefreshed, "onStatusRefreshed deve ser chamado uma vez por projeto");
  assert.deepEqual(
    new Set(refreshed.map((r) => r.id)),
    new Set([101, 102]),
    "Cada projeto deve receber seu próprio status"
  );
  refreshed.forEach((r) => {
    assert.equal(r.state, "EMPTY", "Diretórios inexistentes devem resultar em estado EMPTY");
  });

  const cacheRewritten = await waitFor(() => {
    try {
      const cache = JSON.parse(fs.readFileSync(paths.treeCacheFile, "utf-8"));
      return cache.statusMap && cache.statusMap["101"]?.state === "EMPTY" && cache.statusMap["102"]?.state === "EMPTY";
    } catch {
      return false;
    }
  });
  assert.ok(cacheRewritten, "Cache deve ser regravado com o statusMap atualizado após o refresh");
} finally {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepos, { recursive: true, force: true });
}

console.log("git_sync_cache_refresh_test: OK");
