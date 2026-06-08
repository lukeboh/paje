import assert from "node:assert/strict";
import {
  filterSyncTargetsBySelection,
  mergeServer,
  normalizeBaseUrl,
  promptBasicAuthPassword,
  promptGitServer,
  resolveEnvValue,
  resolveEnvString,
  resolveEnvBoolean,
  resolveEnvNumber,
  resolveEnvStringArray,
  resolveHomePath,
} from "../src/modules/git/gitCommand.js";
import { GitLabProject, GitRepositoryTarget, GitLabTreeNode } from "../src/modules/git/types.js";

const envConfig = {
  str: "valor",
  boolTrue: true,
  boolFalse: false,
  num: 5,
  list: ["a", "b"],
  raw: "10",
};

assert.strictEqual(resolveEnvValue(undefined, envConfig, "str"), "valor");
assert.strictEqual(resolveEnvString(undefined, envConfig, "str"), "valor");
assert.strictEqual(resolveEnvBoolean(undefined, envConfig, "boolTrue"), true);
assert.strictEqual(resolveEnvBoolean(undefined, envConfig, "boolFalse"), false);
assert.strictEqual(resolveEnvBoolean(true, envConfig, "boolFalse"), true);
assert.strictEqual(resolveEnvNumber(undefined, envConfig, "num"), 5);
assert.strictEqual(resolveEnvNumber(undefined, envConfig, "raw"), 10);
assert.strictEqual(resolveEnvStringArray(undefined, envConfig, "list"), "a,b");
assert.strictEqual(resolveEnvStringArray("x,y", envConfig, "list"), "x,y");

const originalHome = process.env.HOME;
process.env.HOME = "/tmp/paje-tests-home";
assert.strictEqual(resolveHomePath("~"), "/tmp/paje-tests-home");
assert.strictEqual(resolveHomePath("~/repos"), "/tmp/paje-tests-home/repos");
assert.strictEqual(resolveHomePath("/var/repos"), "/var/repos");
process.env.HOME = originalHome;

const emptyEnv = {} as Record<string, string | number | boolean | string[]>;
assert.strictEqual(resolveEnvString(undefined, emptyEnv, "missing"), undefined);
assert.strictEqual(resolveEnvBoolean(undefined, emptyEnv, "missing"), undefined);
assert.strictEqual(resolveEnvNumber(undefined, emptyEnv, "missing"), undefined);
assert.strictEqual(resolveEnvStringArray(undefined, emptyEnv, "missing"), undefined);

assert.strictEqual(normalizeBaseUrl("https://git.tse.jus.br///"), "https://git.tse.jus.br");

const mergeResult = mergeServer(
  [{ id: "1", name: "A", baseUrl: "https://git.tse.jus.br" }],
  { id: "2", name: "B", baseUrl: "https://git.tse.jus.br/" }
);
assert.ok(mergeResult.servers.length === 1, "Deve fazer merge por baseUrl normalizada");

const sessionMock = {
  promptForm: async () => ({ name: "GitLab", baseUrl: "https://gitlab.com", username: "user" }),
  promptConfirm: async () => true,
} as any;
const serverResult = await promptGitServer(sessionMock, { name: "X" });
assert.strictEqual(serverResult.name, "GitLab");

const selectionProjects: GitLabProject[] = [
  {
    id: 101,
    name: "Repo A",
    path_with_namespace: "grupo/repo-a",
    ssh_url_to_repo: "git@gitlab.com:grupo/repo-a.git",
    http_url_to_repo: "https://gitlab.com/grupo/repo-a.git",
  },
  {
    id: 102,
    name: "Repo B",
    path_with_namespace: "outro/repo-b",
    ssh_url_to_repo: "git@gitlab.com:outro/repo-b.git",
    http_url_to_repo: "https://gitlab.com/outro/repo-b.git",
  },
];
const selectionNodes: GitLabTreeNode[] = selectionProjects.map((project) => ({
  id: `project-${project.id}`,
  label: project.name,
  type: "project",
  project,
}));
const syncTargets: GitRepositoryTarget[] = selectionProjects.map((project) => ({
  id: project.id,
  name: project.name,
  pathWithNamespace: project.path_with_namespace,
  sshUrl: project.ssh_url_to_repo,
  localPath: "",
}));
const filteredSingle = filterSyncTargetsBySelection(syncTargets, selectionNodes, "single");
assert.strictEqual(filteredSingle.length, 2, "Deve filtrar targets pelo escopo em single");
const filteredAll = filterSyncTargetsBySelection(syncTargets, selectionNodes, "all");
assert.strictEqual(filteredAll.length, 2, "Não deve filtrar targets quando modo=all");
const filteredUndefined = filterSyncTargetsBySelection(syncTargets, selectionNodes, undefined);
assert.strictEqual(filteredUndefined.length, 2, "Não deve filtrar targets sem modo explícito");

const password = await promptBasicAuthPassword("usuario", undefined, "segredo");
assert.strictEqual(password, "segredo");

console.log("git_command_helpers_test: OK");
