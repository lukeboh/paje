import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LogEntry } from "../src/modules/git/core/loggerBroker.js";

// Regressão: gitSyncService.ts calculava hasValidSshAssociation(host) mas só
// usava o resultado para decidir se um token era exigido / se ensureSshKey
// deveria rodar — nunca para decidir se deveria montar pajeHttpUrl (URL
// HTTPS com o token embutido). Resultado: sempre que um servidor tinha um
// token (o que acontece em praticamente todo servidor, já que o próprio
// fluxo de cadastro via SSH também gera um token só para a API), pajeHttpUrl
// era preenchida e parallelSync.ts a usava para clone/pull/push em vez da
// URL SSH — contrariando docs/arquitetura.md e a própria mensagem exibida
// ao usuário após configurar SSH. Este teste cobre os três pontos onde
// pajeHttpUrl era montada (cache-hit, fresh-fetch GitLab, fresh-fetch
// GitHub), garantindo que ela só é preenchida quando o host NÃO tem
// associação SSH válida.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-ssh-preferred-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalFetch = globalThis.fetch;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

try {
  const { createGitSyncCore, computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const { upsertSshConfigHost } = await import("../src/modules/git/sshManager.js");

  // A run anterior de loadTree() no caminho de cache-hit agenda, via
  // setImmediate, uma atualização de status em background que reescreve
  // git-tree-cache.json — sem relação com este teste, mas se outro arquivo
  // de teste rodou esse caminho logo antes deste (ex.: git_sync_known_hosts_
  // test.ts) e ainda não processou seu setImmediate quando HOME já mudou
  // para o tmpHome daqui, essa escrita tardia usaria o HOME atual (por
  // resolvePajePaths() ler process.env.HOME/USERPROFILE a cada chamada) e
  // corromperia o cache que este teste está prestes a escrever. Drena a
  // fila de tarefas pendentes antes de montar as fixtures deste teste.
  const flushEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  await flushEventLoop();
  await flushEventLoop();

  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const sshDir = path.join(tmpHome, ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });
  const dummyKeyPath = path.join(sshDir, "id_ed25519_test");
  fs.writeFileSync(dummyKeyPath, "not-a-real-key");

  const gitlabSshHost = "gitlab.ssh.example.test";
  const gitlabTokenHost = "gitlab.token.example.test";
  const githubSshHost = "github.ssh.example.test";
  const githubTokenHost = "github.token.example.test";

  // Só os hosts "*-ssh-*" têm associação SSH válida (Host block + IdentityFile
  // existente em disco) — os "*-token-*" não têm nenhuma, então devem
  // continuar usando HTTPS+token normalmente.
  upsertSshConfigHost(gitlabSshHost, dummyKeyPath);
  upsertSshConfigHost(githubSshHost, dummyKeyPath);

  // Pré-popula known_hosts para os hosts SSH-associados, para que
  // ensureKnownHost() não precise chamar ssh-keyscan (rede) durante o teste.
  fs.writeFileSync(
    path.join(sshDir, "known_hosts"),
    `${gitlabSshHost} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyDataForTesting1234567890\n` +
      `${githubSshHost} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyDataForTesting1234567890\n`
  );

  const servers = [
    {
      id: `https://${gitlabSshHost}`,
      name: "GitLab-SSH",
      baseUrl: `https://${gitlabSshHost}`,
      type: "gitlab" as const,
      token: "glpat-should-not-be-used-for-clone",
    },
    {
      id: `https://${gitlabTokenHost}`,
      name: "GitLab-Token",
      baseUrl: `https://${gitlabTokenHost}`,
      type: "gitlab" as const,
      token: "glpat-used-for-clone",
    },
    {
      id: `https://${githubSshHost}`,
      name: "GitHub-SSH",
      baseUrl: `https://${githubSshHost}`,
      type: "github" as const,
      token: "ghp-should-not-be-used-for-clone",
    },
    {
      id: `https://${githubTokenHost}`,
      name: "GitHub-Token",
      baseUrl: `https://${githubTokenHost}`,
      type: "github" as const,
      token: "ghp-used-for-clone",
    },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  const config = {
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "paje-ssh-preferred-repos-")),
    prepareLocalDirs: false,
    noPublicRepos: false,
    noArchivedRepos: false,
    filter: "",
    syncRepos: "",
    verbose: false,
  } as unknown as import("../src/modules/git/core/gitSyncConfig.js").GitSyncConfig;

  const logger = new LoggerBroker();
  logger.addTransport({ name: "collector", minLevel: "info", log: () => {} });

  // -------------------------------------------------------------------
  // Parte 1: caminho de cache-hit
  // -------------------------------------------------------------------
  const cachedProject = (host: string, id: number) => ({
    id,
    name: "repo",
    path_with_namespace: "grupo/repo",
    ssh_url_to_repo: `git@${host}:grupo/repo.git`,
    http_url_to_repo: `https://${host}/grupo/repo.git`,
    default_branch: "main",
    visibility: "private" as const,
    archived: false,
    namespace: { id: id * 10, full_path: "grupo" },
  });

  const configHash = computeConfigHash(servers.map((s) => ({ ...s })));
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [
        { serverName: "GitLab-SSH", groups: [], projects: [cachedProject(gitlabSshHost, 1)] },
        { serverName: "GitLab-Token", groups: [], projects: [cachedProject(gitlabTokenHost, 2)] },
      ],
      statusMap: {},
    })
  );

  const core = createGitSyncCore();
  const cacheView = await core.loadTree({ config, logger });
  assert.equal(cacheView.fromCache, true, "Deve responder a partir do cache");

  const cacheSshProject = cacheView.projects?.find((p) => p.path_with_namespace === "grupo/repo" && p.id === 1);
  const cacheTokenProject = cacheView.projects?.find((p) => p.id === 2);
  assert.ok(cacheSshProject, "Projeto do servidor SSH deve estar presente no cache-hit");
  assert.ok(cacheTokenProject, "Projeto do servidor sem SSH deve estar presente no cache-hit");
  assert.equal(
    cacheSshProject!.pajeHttpUrl,
    undefined,
    "Host com associação SSH válida não deve receber pajeHttpUrl mesmo com token configurado (cache-hit)"
  );
  assert.ok(
    cacheTokenProject!.pajeHttpUrl?.startsWith("https://oauth2:glpat-used-for-clone@"),
    "Host sem associação SSH deve continuar recebendo pajeHttpUrl com token embutido (cache-hit)"
  );

  // -------------------------------------------------------------------
  // Parte 2: caminho de fresh-fetch (sem cache válido)
  // -------------------------------------------------------------------
  // Em vez de apagar o arquivo de cache (o que corre risco de uma corrida
  // com a atualização de status em background que o cache-hit da Parte 1
  // agenda via setImmediate — ela reescreveria o mesmo arquivo pouco depois),
  // invalida o cache da forma real: muda um campo que entra em
  // computeConfigHash. A tarefa em background, se rodar, reescreve o cache
  // com o hash ANTIGO, que não bate mais com o hash calculado a partir do
  // git-servers.json atualizado — forçando o caminho de fresh-fetch de forma
  // determinística.
  // noArchivedRepos entra no hash mas não afeta o filtro em si (os projetos
  // de teste não são archived), então só serve para invalidar o cache.
  const serversAfterConfigChange = servers.map((s) =>
    s.name === "GitLab-SSH" ? { ...s, noArchivedRepos: true } : s
  );
  fs.writeFileSync(paths.serversFile, JSON.stringify(serversAfterConfigChange, null, 2));

  const glProject = (host: string, id: number) => ({
    id,
    name: "repo",
    path_with_namespace: "grupo/repo",
    ssh_url_to_repo: `git@${host}:grupo/repo.git`,
    http_url_to_repo: `https://${host}/grupo/repo.git`,
    default_branch: "main",
    visibility: "private",
    archived: false,
    namespace: { id: id * 10, full_path: "grupo" },
  });

  const ghRepo = (host: string, id: number) => ({
    id,
    name: "repo",
    full_name: "grupo/repo",
    private: true,
    owner: { login: "grupo", id: id * 10 },
    ssh_url: `git@${host}:grupo/repo.git`,
    clone_url: `https://${host}/grupo/repo.git`,
    default_branch: "main",
    archived: false,
  });

  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(gitlabSshHost)) {
      if (url.includes("/api/v4/groups")) return jsonResponse([]);
      if (url.includes("/api/v4/projects")) return jsonResponse([glProject(gitlabSshHost, 11)]);
    }
    if (url.includes(gitlabTokenHost)) {
      if (url.includes("/api/v4/groups")) return jsonResponse([]);
      if (url.includes("/api/v4/projects")) return jsonResponse([glProject(gitlabTokenHost, 12)]);
    }
    if (url.includes(githubSshHost)) {
      if (url.includes("/user/orgs")) return jsonResponse([]);
      if (url.includes("/user/repos")) return jsonResponse([ghRepo(githubSshHost, 21)]);
      if (url.endsWith("/user")) return jsonResponse({ id: 900, login: "grupo" });
    }
    if (url.includes(githubTokenHost)) {
      if (url.includes("/user/orgs")) return jsonResponse([]);
      if (url.includes("/user/repos")) return jsonResponse([ghRepo(githubTokenHost, 22)]);
      if (url.endsWith("/user")) return jsonResponse({ id: 901, login: "grupo" });
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  }) as typeof fetch;

  const freshView = await core.loadTree({ config, logger });
  assert.notEqual(freshView.fromCache, true, "Deve buscar dados frescos (sem cache válido)");

  const byId = (id: number) => freshView.projects?.find((p) => p.id === id);

  assert.equal(
    byId(11)?.pajeHttpUrl,
    undefined,
    "GitLab com host SSH-associado não deve receber pajeHttpUrl (fresh-fetch)"
  );
  assert.ok(
    byId(12)?.pajeHttpUrl?.startsWith("https://oauth2:glpat-used-for-clone@"),
    "GitLab sem associação SSH deve receber pajeHttpUrl com token embutido (fresh-fetch)"
  );
  assert.equal(
    byId(21)?.pajeHttpUrl,
    undefined,
    "GitHub com host SSH-associado não deve receber pajeHttpUrl (fresh-fetch)"
  );
  assert.ok(
    byId(22)?.pajeHttpUrl?.startsWith("https://x-access-token:ghp-used-for-clone@"),
    "GitHub sem associação SSH deve receber pajeHttpUrl com token embutido (fresh-fetch)"
  );
} finally {
  globalThis.fetch = originalFetch;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log("git_sync_ssh_preferred_over_token_test: OK");
