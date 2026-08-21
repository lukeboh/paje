import assert from "node:assert/strict";
import path from "node:path";
import {
  mergeServer,
  normalizeBaseUrl,
  promptBasicAuthPassword,
  promptGitServer,
  promptValidBaseUrl,
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
const originalUserProfile = process.env.USERPROFILE;
const testHome = path.resolve("/tmp/paje-tests-home");
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
assert.strictEqual(resolveHomePath("~"), testHome);
assert.strictEqual(resolveHomePath("~/repos"), path.join(testHome, "repos"));
assert.strictEqual(resolveHomePath("/var/repos"), "/var/repos");
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;

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
  promptInput: async () => "https://gitlab.com",
  promptForm: async () => ({ name: "GitLab", username: "user" }),
  promptConfirm: async () => true,
  showMessage: async () => undefined,
} as any;
const serverResult = await promptGitServer(sessionMock, { name: "X" });
assert.strictEqual(serverResult.name, "GitLab");
assert.strictEqual(serverResult.baseUrl, "https://gitlab.com");
assert.strictEqual(serverResult.id, "https://gitlab.com");

const password = await promptBasicAuthPassword("usuario", undefined, "segredo");
assert.strictEqual(password, "segredo");

const invalidThenValidInputs = ["not-a-url", "https://git.example.com/"];
const invalidUrlSessionMock = {
  promptInput: async () => invalidThenValidInputs.shift(),
  showMessage: async () => undefined,
} as any;
const resolvedBaseUrl = await promptValidBaseUrl(invalidUrlSessionMock, "https://gitlab.com");
assert.strictEqual(resolvedBaseUrl, "https://git.example.com");
assert.strictEqual(invalidThenValidInputs.length, 0, "Deve reperguntar até receber uma URL válida");

console.log("git_command_helpers_test: OK");
