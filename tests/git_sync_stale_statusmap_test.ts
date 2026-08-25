import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regressão: gitCommand.ts's onConfirm (o handler que decide quais
// repositórios desmarcados devem ter a cópia local removida) lia
// statusMap[project.id] — um retrato de UMA vez, tirado no exato momento em
// que loadTree() respondeu. No caminho de cache-hit, esse retrato é o
// statusMap da execução ANTERIOR (cached.statusMap em gitSyncService.ts);
// o statusMap de verdade só é recomputado depois, em segundo plano
// (setImmediate), e entregue incrementalmente via onStatusRefreshed — que
// atualiza o node.status de cada nó da própria árvore (o mesmo array
// retornado por loadTree()), não esse statusMap separado. Resultado: um
// repositório que estava "EMPTY" (não clonado) no cache anterior, mas que
// foi clonado manualmente desde então, continuava aparecendo como "EMPTY"
// no statusMap pelo resto da sessão — e `removalCandidates` pulava
// silenciosamente qualquer remoção pra ele, mesmo com a árvore mostrando o
// status correto na tela.
//
// Este teste prova a divergência isoladamente via core.loadTree(): o
// statusMap devolvido fica estagnado no valor do cache, enquanto o node da
// árvore (o mesmo objeto) é atualizado para o status real assim que o
// refresh em segundo plano termina — confirmando por que gitCommand.ts
// precisa ler node.status (ao vivo), não statusMap[id] (retrato antigo).

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-stale-statusmap-home-"));
const tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "paje-stale-statusmap-repos-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

try {
  const { createGitSyncCore, computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const { runGit } = await import("../src/modules/git/parallelSync.js");
  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const servers = [
    { id: "https://git.exemplo.com", name: "Exemplo", baseUrl: "https://git.exemplo.com" },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  const groups = [{ id: 1, name: "grupo", full_path: "grupo" }];
  const projects = [
    {
      id: 101,
      name: "proj-ja-clonado",
      path_with_namespace: "grupo/proj-ja-clonado",
      ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-ja-clonado.git",
      http_url_to_repo: "https://git.exemplo.com/grupo/proj-ja-clonado.git",
      default_branch: "main",
      visibility: "private" as const,
    },
  ];

  // Repositório real, clonado agora (branch main, sem remote configurado) —
  // é o que uma checagem em tempo real (resolveRepoStatus) encontraria.
  const repoPath = path.join(tmpRepos, "grupo", "proj-ja-clonado");
  fs.mkdirSync(repoPath, { recursive: true });
  await runGit(["-C", repoPath, "init", "-b", "main"]);
  await runGit(["-C", repoPath, "config", "user.email", "test@example.com"]);
  await runGit(["-C", repoPath, "config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(repoPath, "README.md"), "conteudo");
  await runGit(["-C", repoPath, "add", "."]);
  await runGit(["-C", repoPath, "commit", "-m", "init"]);

  // Mas o CACHE (da execução anterior, antes deste clone existir) ainda diz
  // "EMPTY" — exatamente o retrato desatualizado que statusMap carrega.
  const configHash = computeConfigHash(servers.map((s) => ({ ...s })));
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [{ serverName: "Exemplo", groups, projects }],
      statusMap: { "101": { branch: "main", state: "EMPTY" } },
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
  const view = await core.loadTree({
    config,
    logger: new LoggerBroker(),
    onStatusRefreshed: (projectId, status) => {
      refreshed.push({ id: projectId, state: status.state });
    },
  });

  assert.equal(view.fromCache, true, "Este teste cobre especificamente o caminho de cache-hit");
  assert.equal(view.statusMap[101]?.state, "EMPTY", "statusMap devolvido é o retrato antigo do cache (EMPTY)");

  const projectNode = view.tree
    .flatMap(function collect(node): typeof view.tree {
      return [node, ...(node.children ?? []).flatMap(collect)];
    })
    .find((node) => node.project?.id === 101);
  assert.ok(projectNode, "Nó do projeto deve existir na árvore");
  assert.equal(projectNode?.status?.state, "EMPTY", "Antes do refresh em segundo plano, o nó também começa com o valor do cache");

  const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  };
  await waitFor(() => refreshed.length === 1);
  assert.equal(refreshed[0]?.state, "REMOTE", "O refresh em segundo plano deve encontrar o estado real (REMOTE — clonado, sem remote configurado)");

  // Simula exatamente o que deliverStatus/treeProgress.updateStatus fazem em
  // tui.app.tsx: mutam node.status do MESMO objeto retornado por loadTree().
  if (projectNode) {
    projectNode.status = { branch: "main", state: "REMOTE" };
  }

  // A prova da divergência: o node (fonte que a correção agora usa) reflete
  // o estado real; o statusMap (fonte que o código antigo usava) continua
  // estagnado no valor do cache pelo resto desta sessão.
  assert.equal(projectNode?.status?.state, "REMOTE", "node.status deve refletir o estado real, ao vivo");
  assert.equal(
    view.statusMap[101]?.state,
    "EMPTY",
    "statusMap NUNCA é atualizado nesta sessão — é exatamente por isso que gitCommand.ts não pode mais confiar nele para decidir remoção"
  );
} finally {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepos, { recursive: true, force: true });
}

console.log("git_sync_stale_statusmap_test: OK");
