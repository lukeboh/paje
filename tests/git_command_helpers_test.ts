import assert from "node:assert/strict";
import {
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

const password = await promptBasicAuthPassword("usuario", undefined, "segredo");
assert.strictEqual(password, "segredo");

console.log("git_command_helpers_test: OK");
