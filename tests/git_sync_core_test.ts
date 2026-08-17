import assert from "node:assert/strict";
import {
  filterProjects,
  filterGroups,
  resolveSyncReposSpecs,
  resolveSyncTargets,
  prepareTargets,
  resolveParallels,
  withToken,
} from "../src/modules/git/core/gitSyncService.js";
import type { GitServerEntry } from "../src/modules/git/core/gitSyncService.js";
import {
  resolveProjectLocalPath,
  resolveLocalPathConflicts,
} from "../src/modules/git/gitPathUtils.js";
import type { GitLabProject, GitLabGroup } from "../src/modules/git/types.js";
import type { GitSyncConfig } from "../src/modules/git/core/gitSyncConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeProject = (overrides: Partial<GitLabProject> & { id: number; path_with_namespace: string }): GitLabProject => ({
  name: overrides.path_with_namespace.split("/").pop() ?? "repo",
  ssh_url_to_repo: `git@gitlab.example.com:${overrides.path_with_namespace}.git`,
  http_url_to_repo: `https://gitlab.example.com/${overrides.path_with_namespace}.git`,
  visibility: "private",
  archived: false,
  default_branch: "main",
  namespace: {
    id: overrides.id * 10,
    full_path: overrides.path_with_namespace.split("/").slice(0, -1).join("/"),
  },
  ...overrides,
});

const baseConfig = (overrides: Partial<GitSyncConfig> = {}): GitSyncConfig => ({
  baseDir: "/repos",
  serverName: undefined,
  baseUrl: undefined,
  username: undefined,
  userEmail: undefined,
  token: undefined,
  useBasicAuth: false,
  noPublicRepos: false,
  noArchivedRepos: false,
  filter: undefined,
  excludeFilter: undefined,
  syncRepos: undefined,
  parallel: undefined,
  shallow: false,
  dryRun: false,
  verbose: false,
  prepareLocalDirs: false,
  noSummary: false,
  ...overrides,
} as GitSyncConfig);

const runCoreTests = async (): Promise<void> => {

  // =========================================================================
  // resolveProjectLocalPath
  // =========================================================================

  {
    const p = makeProject({ id: 1, path_with_namespace: "grupo/repo" });
    assert.equal(
      resolveProjectLocalPath(p),
      "grupo/repo",
      "usa path_with_namespace quando pajeOriginalPathWithNamespace está ausente"
    );
  }

  {
    const p = makeProject({
      id: 1,
      path_with_namespace: "grupo/repo",
      pajeOriginalPathWithNamespace: "original/repo",
    });
    assert.equal(
      resolveProjectLocalPath(p),
      "original/repo",
      "prefere pajeOriginalPathWithNamespace quando presente"
    );
  }

  // =========================================================================
  // resolveLocalPathConflicts
  // =========================================================================

  {
    const projects = [
      makeProject({ id: 1, path_with_namespace: "grupo/repo-a" }),
      makeProject({ id: 2, path_with_namespace: "grupo/repo-b" }),
    ];
    const result = resolveLocalPathConflicts(projects);
    assert.equal(result.get(1), "grupo/repo-a", "sem conflito: caminho inalterado para id 1");
    assert.equal(result.get(2), "grupo/repo-b", "sem conflito: caminho inalterado para id 2");
  }

  {
    const projects = [
      makeProject({ id: 1, path_with_namespace: "grupo/repo", pajeServerName: "ServidorA" }),
      makeProject({ id: 2, path_with_namespace: "grupo/repo", pajeServerName: "ServidorB" }),
    ];
    const result = resolveLocalPathConflicts(projects);
    assert.equal(result.get(1), "grupo/repo-ServidorA", "conflito: adiciona sufixo com nome do servidor (id 1)");
    assert.equal(result.get(2), "grupo/repo-ServidorB", "conflito: adiciona sufixo com nome do servidor (id 2)");
  }

  {
    const projects = [
      makeProject({ id: 1, path_with_namespace: "grupo/repo" }),
      makeProject({ id: 2, path_with_namespace: "grupo/repo" }),
    ];
    const result = resolveLocalPathConflicts(projects);
    assert.equal(result.get(1), "grupo/repo-servidor", "conflito sem server name: sufixo padrão '-servidor'");
    assert.equal(result.get(2), "grupo/repo-servidor", "conflito sem server name: sufixo padrão '-servidor'");
  }

  {
    const projects = [
      makeProject({
        id: 1,
        path_with_namespace: "grupo/repo",
        pajeOriginalPathWithNamespace: "original/repo",
        pajeServerName: "S1",
      }),
      makeProject({
        id: 2,
        path_with_namespace: "grupo/repo",
        pajeOriginalPathWithNamespace: "original/repo",
        pajeServerName: "S2",
      }),
    ];
    const result = resolveLocalPathConflicts(projects);
    assert.equal(result.get(1), "original/repo-S1", "conflito com pajeOriginalPathWithNamespace");
    assert.equal(result.get(2), "original/repo-S2", "conflito com pajeOriginalPathWithNamespace");
  }

  // =========================================================================
  // filterProjects
  // =========================================================================

  const projects = [
    makeProject({ id: 1, path_with_namespace: "grupo/public-repo", visibility: "public" }),
    makeProject({ id: 2, path_with_namespace: "grupo/archived-repo", archived: true }),
    makeProject({ id: 3, path_with_namespace: "grupo/private-repo" }),
    makeProject({ id: 4, path_with_namespace: "devops/ci-tool" }),
    makeProject({
      id: 5,
      path_with_namespace: "devops/other",
      pajeOriginalPathWithNamespace: "shared/other",
      namespace: { id: 50, full_path: "shared" },
    }),
  ];

  {
    const result = filterProjects(projects, baseConfig());
    assert.equal(result.length, 5, "sem filtros: todos os projetos passam");
  }

  {
    const result = filterProjects(projects, baseConfig({ noPublicRepos: true }));
    assert.ok(
      result.every((p) => p.visibility !== "public"),
      "noPublicRepos: exclui públicos"
    );
    assert.equal(result.length, 4);
  }

  {
    const result = filterProjects(projects, baseConfig({ noArchivedRepos: true }));
    assert.ok(
      result.every((p) => !p.archived),
      "noArchivedRepos: exclui arquivados"
    );
    assert.equal(result.length, 4);
  }

  {
    const result = filterProjects(projects, baseConfig({ noPublicRepos: true, noArchivedRepos: true }));
    assert.equal(result.length, 3, "combina noPublicRepos e noArchivedRepos");
  }

  {
    const result = filterProjects(projects, baseConfig({ filter: "devops/*" }));
    assert.equal(result.length, 2, "filtro glob: devops/*");
    assert.ok(result.every((p) => p.path_with_namespace.startsWith("devops/")));
  }

  {
    const result = filterProjects(projects, baseConfig({ filter: "**/ci*" }));
    assert.equal(result.length, 1, "filtro glob recursivo: **/ci*");
    assert.equal(result[0].path_with_namespace, "devops/ci-tool");
  }

  {
    const result = filterProjects(projects, baseConfig({ filter: "shared/*" }));
    assert.equal(result.length, 1, "filtro glob via pajeOriginalPathWithNamespace");
    assert.equal(result[0].id, 5);
  }

  {
    const result = filterProjects(projects, baseConfig({ filter: "grupo/*", noPublicRepos: true }));
    assert.equal(result.length, 2, "filtro glob combinado com noPublicRepos");
    assert.ok(result.every((p) => p.path_with_namespace.startsWith("grupo/")));
  }

  // =========================================================================
  // filterProjects — excludeFilter
  // =========================================================================

  {
    const result = filterProjects(projects, baseConfig({ excludeFilter: "" }));
    assert.equal(result.length, 5, "excludeFilter vazio não exclui nada (regressão: matchesAntPatterns trata lista vazia como 'passa tudo')");
  }

  {
    const result = filterProjects(projects, baseConfig({ excludeFilter: "grupo/private-repo" }));
    assert.equal(result.length, 4, "excludeFilter: exclui projeto exato");
    assert.ok(!result.some((p) => p.path_with_namespace === "grupo/private-repo"));
  }

  {
    const result = filterProjects(projects, baseConfig({ excludeFilter: "grupo/**" }));
    assert.equal(result.length, 2, "excludeFilter com /** exclui toda a pasta grupo/");
    assert.ok(result.every((p) => !p.path_with_namespace.startsWith("grupo/")));
  }

  {
    const result = filterProjects(projects, baseConfig({ filter: "grupo/*", excludeFilter: "grupo/private-repo" }));
    assert.equal(result.length, 2, "excludeFilter tem prioridade sobre filter: remove mesmo o que filter incluiria");
    assert.ok(!result.some((p) => p.path_with_namespace === "grupo/private-repo"));
    assert.ok(result.every((p) => p.path_with_namespace.startsWith("grupo/")));
  }

  // =========================================================================
  // filterGroups
  // =========================================================================

  const groups: GitLabGroup[] = [
    { id: 1, name: "grupo", full_path: "grupo", parent_id: null },
    { id: 2, name: "subgrupo", full_path: "grupo/subgrupo", parent_id: 1 },
    { id: 3, name: "devops", full_path: "devops", parent_id: null },
  ];

  {
    const result = filterGroups(groups, baseConfig());
    assert.equal(result.length, 3, "sem excludeFilter: todos os grupos passam");
  }

  {
    const result = filterGroups(groups, baseConfig({ excludeFilter: "" }));
    assert.equal(result.length, 3, "excludeFilter vazio não exclui grupo nenhum");
  }

  {
    const result = filterGroups(groups, baseConfig({ excludeFilter: "devops" }));
    assert.equal(result.length, 2, "excludeFilter: exclui grupo exato pelo full_path");
    assert.ok(!result.some((g) => g.full_path === "devops"));
  }

  {
    const result = filterGroups(groups, baseConfig({ excludeFilter: "grupo/**" }));
    assert.equal(result.length, 1, "excludeFilter com /** exclui o grupo e o subgrupo aninhado");
    assert.equal(result[0].full_path, "devops");
  }

  // =========================================================================
  // resolveSyncReposSpecs
  // =========================================================================

  {
    const result = resolveSyncReposSpecs(undefined);
    assert.deepEqual(result, [], "sem padrão: retorna vazio");
  }

  {
    const result = resolveSyncReposSpecs("grupo/repo");
    assert.deepEqual(result, [{ projectPath: "grupo/repo" }], "caminho simples sem branch");
  }

  {
    const result = resolveSyncReposSpecs("grupo/repo.git");
    assert.deepEqual(result, [{ projectPath: "grupo/repo" }], "remove sufixo .git");
  }

  {
    const result = resolveSyncReposSpecs("grupo/repo#develop");
    assert.deepEqual(result, [{ projectPath: "grupo/repo", branch: "develop" }], "caminho com branch");
  }

  {
    const result = resolveSyncReposSpecs("grupo/repo#develop;outro/repo#main");
    assert.deepEqual(result, [
      { projectPath: "grupo/repo", branch: "develop" },
      { projectPath: "outro/repo", branch: "main" },
    ], "múltiplos padrões separados por ;");
  }

  {
    const result = resolveSyncReposSpecs("grupo/repo#");
    assert.deepEqual(result, [{ projectPath: "grupo/repo", branch: undefined }], "branch vazia normalizada para undefined");
  }

  // =========================================================================
  // resolveSyncTargets
  // =========================================================================

  const syncProjects = [
    makeProject({ id: 1, path_with_namespace: "grupo/repo-a" }),
    makeProject({ id: 2, path_with_namespace: "grupo/repo-b" }),
    makeProject({ id: 3, path_with_namespace: "devops/ci-tool" }),
    makeProject({
      id: 4,
      path_with_namespace: "servidor-b/projeto",
      pajeOriginalPathWithNamespace: "grupo/projeto",
    }),
  ];

  {
    const result = resolveSyncTargets(syncProjects, []);
    assert.deepEqual(result, [], "specs vazio: retorna vazio");
  }

  {
    const specs = resolveSyncReposSpecs("grupo/repo-a");
    const result = resolveSyncTargets(syncProjects, specs);
    assert.equal(result.length, 1);
    assert.equal(result[0].pathWithNamespace, "grupo/repo-a", "match exato de caminho");
  }

  {
    const specs = resolveSyncReposSpecs("grupo/*");
    const result = resolveSyncTargets(syncProjects, specs);
    assert.equal(result.length, 3, "glob grupo/*: id 1, 2 e 4 (via pajeOriginalPathWithNamespace)");
    const paths = result.map((t) => t.pathWithNamespace).sort();
    assert.ok(paths.includes("grupo/repo-a"));
    assert.ok(paths.includes("grupo/repo-b"));
    assert.ok(paths.includes("grupo/projeto"));
  }

  {
    const specs = resolveSyncReposSpecs("grupo/repo-a#feature-x");
    const result = resolveSyncTargets(syncProjects, specs);
    assert.equal(result.length, 1);
    assert.equal(result[0].branch, "feature-x", "branch passada para o target");
  }

  {
    const specs = resolveSyncReposSpecs("grupo/*");
    const result = resolveSyncTargets(syncProjects, specs);
    const keys = result.map((t) => `${t.pathWithNamespace}#${t.branch ?? ""}`);
    const uniqueKeys = new Set(keys);
    assert.equal(keys.length, uniqueKeys.size, "sem duplicatas no resultado");
  }

  {
    const specs = resolveSyncReposSpecs("grupo/projeto");
    const result = resolveSyncTargets(syncProjects, specs);
    assert.equal(result.length, 1, "match via pajeOriginalPathWithNamespace");
    assert.equal(result[0].id, 4);
  }

  // =========================================================================
  // prepareTargets
  // =========================================================================

  {
    const ps = [
      makeProject({ id: 1, path_with_namespace: "grupo/repo", pajeHttpUrl: "https://oauth2:token@gitlab.example.com/grupo/repo.git" }),
    ];
    const result = prepareTargets(ps, "/base");
    assert.equal(result.length, 1);
    assert.equal(result[0].localPath, "/base/grupo/repo", "localPath construído com baseDir");
    assert.equal(result[0].httpUrl, "https://oauth2:token@gitlab.example.com/grupo/repo.git", "httpUrl vem de pajeHttpUrl");
  }

  {
    const ps = [
      makeProject({ id: 1, path_with_namespace: "grupo/repo", pajeServerName: "S1" }),
      makeProject({ id: 2, path_with_namespace: "grupo/repo", pajeServerName: "S2" }),
    ];
    const result = prepareTargets(ps, "/base");
    const paths = result.map((t) => t.localPath).sort();
    assert.ok(paths.includes("/base/grupo/repo-S1"), "conflito: sufixo S1");
    assert.ok(paths.includes("/base/grupo/repo-S2"), "conflito: sufixo S2");
  }

  {
    const ps = [makeProject({ id: 1, path_with_namespace: "grupo/repo" })];
    const result = prepareTargets(ps, "/base", "dev-user", "dev@example.com");
    assert.equal(result[0].gitUserName, "dev-user", "gitUserName propagado");
    assert.equal(result[0].gitUserEmail, "dev@example.com", "gitUserEmail propagado");
  }

  // =========================================================================
  // resolveParallels
  // =========================================================================

  assert.equal(resolveParallels(undefined), "auto", "undefined → auto");
  assert.equal(resolveParallels(""), "auto", "string vazia → auto");
  assert.equal(resolveParallels("auto"), "auto", "'auto' → auto");
  assert.equal(resolveParallels("4"), 4, "'4' → 4");
  assert.equal(resolveParallels("1"), 1, "'1' → 1");
  assert.equal(resolveParallels("0"), "auto", "'0' inválido → auto");
  assert.equal(resolveParallels("-2"), "auto", "negativo → auto");
  assert.equal(resolveParallels("abc"), "auto", "NaN → auto");

  const bareServer: GitServerEntry = { id: "s1", name: "Servidor", baseUrl: "https://gitlab.example.com" };
  const withDefaultOrigin = withToken(bareServer, "glpat-xyz");
  assert.equal(withDefaultOrigin.token, "glpat-xyz", "withToken deve gravar o token");
  assert.equal(
    withDefaultOrigin.tokenOrigin,
    "personal-access-token",
    "withToken deve gravar 'personal-access-token' como origem padrão"
  );
  assert.equal(withDefaultOrigin.id, bareServer.id, "withToken não pode alterar campos que não sejam token/tokenOrigin");
  const withExplicitOrigin = withToken(bareServer, "oauth-xyz", "oauth-device-flow");
  assert.equal(withExplicitOrigin.tokenOrigin, "oauth-device-flow", "withToken deve aceitar uma origem explícita");

  console.log("git_sync_core_test: OK");
};

const testPromise = runCoreTests();
const globalBucket = globalThis as { __pajeTests?: Promise<void>[] };
if (globalBucket.__pajeTests) {
  globalBucket.__pajeTests.push(testPromise);
} else {
  globalBucket.__pajeTests = [testPromise];
}
