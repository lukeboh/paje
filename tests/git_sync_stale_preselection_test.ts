import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regressão (BUG-22): no caminho de cache-hit, a pré-seleção da árvore vinha
// de applyInitialSelectionFromStatusMap(tree, cached.statusMap) — o retrato da
// execução ANTERIOR, gravado no load (antes do sync daquela sessão). Duas
// consequências, ambas relatadas pelo usuário:
//
//   (a) um repositório cujo clone local foi apagado (manualmente, ou pela
//       própria remoção do PAJÉ na sessão anterior) continuava constando como
//       SYNCED no cache → entrava PRÉ-SELECIONADO [x] → o Ctrl+S o CLONAVA de
//       volta, sem o usuário nunca tê-lo marcado;
//   (b) um repositório clonado durante a sessão anterior constava como EMPTY
//       no cache → entrava DESMARCADO [ ] apesar de clonado → virava candidato
//       a remoção no Ctrl+S (e, para estados limpos, era removido).
//
// A regra correta, confirmada com o usuário: a seleção inicial deve refletir o
// DISCO REAL (existe clone? → [x]; não existe? → [ ]), nunca o retrato do
// cache. Este teste força as duas divergências no mesmo cache e verifica a
// seleção logo após o loadTree() de cache-hit.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-stale-presel-home-"));
const tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "paje-stale-presel-repos-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

try {
  const { createGitSyncCore, computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const { runGit } = await import("../src/modules/git/parallelSync.js");
  const { collectSelectedProjects } = await import("../src/modules/git/treeBuilder.js");
  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const servers = [
    { id: "https://git.exemplo.com", name: "Exemplo", baseUrl: "https://git.exemplo.com" },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  const groups = [{ id: 1, name: "grupo", full_path: "grupo" }];
  const projects = [
    {
      // (a) o cache jura que está SYNCED, mas o clone local NÃO existe mais
      id: 101,
      name: "proj-fantasma",
      path_with_namespace: "grupo/proj-fantasma",
      ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-fantasma.git",
      http_url_to_repo: "https://git.exemplo.com/grupo/proj-fantasma.git",
      default_branch: "main",
      visibility: "private" as const,
    },
    {
      // (b) o cache jura que está EMPTY, mas o clone local EXISTE
      id: 102,
      name: "proj-real",
      path_with_namespace: "grupo/proj-real",
      ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-real.git",
      http_url_to_repo: "https://git.exemplo.com/grupo/proj-real.git",
      default_branch: "main",
      visibility: "private" as const,
    },
  ];

  const realRepoPath = path.join(tmpRepos, "grupo", "proj-real");
  fs.mkdirSync(realRepoPath, { recursive: true });
  await runGit(["-C", realRepoPath, "init", "-b", "main"]);
  await runGit(["-C", realRepoPath, "config", "user.email", "test@example.com"]);
  await runGit(["-C", realRepoPath, "config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(realRepoPath, "README.md"), "conteudo");
  await runGit(["-C", realRepoPath, "add", "."]);
  await runGit(["-C", realRepoPath, "commit", "-m", "init"]);

  const configHash = computeConfigHash(servers.map((s) => ({ ...s })));
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [{ serverName: "Exemplo", groups, projects }],
      statusMap: {
        "101": { branch: "main", state: "SYNCED" },
        "102": { branch: "main", state: "EMPTY" },
      },
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

  // O fixture de cache escrito acima (linhas 77-88) já grava statusMap com as
  // chaves "101"/"102" preenchidas — não dá pra usar a presença delas como
  // sinal de que o refresh em segundo plano rodou. O mtime de antes de
  // loadTree() é a referência para saber quando a regravação real aconteceu.
  const cacheMtimeBefore = fs.statSync(paths.treeCacheFile).mtimeMs;

  const core = createGitSyncCore();
  const view = await core.loadTree({ config, logger: new LoggerBroker() });

  assert.equal(view.fromCache, true, "Este teste cobre especificamente o caminho de cache-hit");

  // loadTree() em cache-hit dispara um refresh de status em segundo plano via
  // setImmediate (gitSyncService.ts) que ao final regrava paths.treeCacheFile
  // — sem esperar por ele aqui, o finally abaixo restaura HOME/USERPROFILE
  // para os valores reais ANTES desse writeGitTreeCache assíncrono rodar, e a
  // escrita acaba pousando no ~/.paje real do usuário (ver BUG-01).
  const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return predicate();
  };
  const cacheRewritten = await waitFor(() => {
    try {
      return fs.statSync(paths.treeCacheFile).mtimeMs > cacheMtimeBefore;
    } catch {
      return false;
    }
  });
  assert.ok(cacheRewritten, "Refresh em segundo plano deve regravar o cache antes do fim do teste");

  const projectNodes = view.tree.flatMap(function collect(node): typeof view.tree {
    return [node, ...(node.children ?? []).flatMap(collect)];
  });
  const fantasma = projectNodes.find((node) => node.project?.id === 101);
  const real = projectNodes.find((node) => node.project?.id === 102);
  assert.ok(fantasma && real, "Os dois nós de projeto devem existir na árvore");

  assert.equal(
    fantasma?.selected ?? false,
    false,
    "proj-fantasma (sem clone no disco) NÃO pode entrar pré-selecionado só porque o cache antigo dizia SYNCED — era isso que fazia o Ctrl+S clonar repositórios nunca marcados"
  );
  assert.equal(
    real?.selected ?? false,
    true,
    "proj-real (clone existe no disco) DEVE entrar pré-selecionado mesmo com o cache antigo dizendo EMPTY — sem isso ele virava candidato a remoção indevida"
  );

  const selecionados = collectSelectedProjects(view.tree).map((project) => project.id);
  assert.deepEqual(
    selecionados,
    [102],
    "A seleção efetiva (o que o Ctrl+S sincronizaria) deve refletir exatamente o disco: só o proj-real"
  );
} finally {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepos, { recursive: true, force: true });
}

console.log("git_sync_stale_preselection_test: OK");
