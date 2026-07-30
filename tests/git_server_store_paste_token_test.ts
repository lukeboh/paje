import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression coverage for the "I already have a personal access token"
// registration option (new capability — previously GitLab could only get a
// token via the username/password web-login scrape or the SSH-key path,
// which both always ended up creating a NEW token; there was no way to just
// paste one already created outside PAJÉ). Confirms: no username/password
// is ever asked, the pasted token is validated (not blindly trusted) via the
// same endpoint used elsewhere, and the persisted server never carries
// useBasicAuth or password.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-paste-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const makeHeaders = (extra?: Record<string, string>) => ({
  "content-type": "application/json",
  ...(extra ?? {}),
});
const makeResponse = (body: string, status: number, headers?: Record<string, string>): Response =>
  new Response(body, { status, headers: headers ?? {} });

const calls: Array<{ url: string; method?: string }> = [];

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  calls.push({ url, method: init?.method });
  if (url.endsWith("/api/v4/personal_access_tokens/self")) {
    return makeResponse(JSON.stringify({ active: true, expires_at: "2099-01-01", scopes: ["read_api"] }), 200, makeHeaders());
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

const promptListCalls: unknown[] = [];
let serverListVisits = 0;

const sessionMock = {
  promptInput: async () => "",
  promptPassword: async () => "",
  promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
    promptListCalls.push(opts);
    const isAuthMethodChoice = opts.choices.some(
      (choice) => choice.value === "ssh" || choice.value === "password" || choice.value === "paste"
    );
    if (isAuthMethodChoice) {
      return "paste";
    }
    serverListVisits += 1;
    if (serverListVisits === 1) {
      return opts.choices[0]?.value ?? null;
    }
    return null;
  },
  promptForm: async (opts: { fields: Array<{ name: string }> }) => {
    // The "paste" choice must ask for the token value, never a password.
    assert.ok(
      opts.fields.some((field) => field.name === "token"),
      "Formulário deve pedir o token quando a opção 'já tenho um token' é escolhida"
    );
    assert.ok(
      !opts.fields.some((field) => field.name === "password"),
      "Formulário não pode pedir senha quando a opção 'já tenho um token' é escolhida"
    );
    return {
      baseUrl: "https://git.example.com",
      serverName: "Example GitLab",
      username: "",
      token: "glpat-pasted-directly",
    };
  },
  promptConfirm: async () => true,
  showInlineError: () => undefined,
  showMessage: async () => undefined,
  setParameters: () => undefined,
  getParameters: () => [],
  destroy: () => undefined,
};

const program = new Command();
configureSshKeyStoreCommand(program, sessionMock as unknown as import("../src/modules/git/tuiSession.js").TuiSession);

process.env.PAJE_SKIP_SSH_STORE = "0";
const originalArgv = process.argv;
const parseArgs = ["node", "cli.ts", "git-server-store"];
process.argv = parseArgs;
await program.parseAsync(parseArgs);
process.argv = originalArgv;
process.env.PAJE_SKIP_SSH_STORE = "1";

assert.strictEqual(serverListVisits, 2, "Deve mostrar a lista antes e depois do cadastro");

const validateCalls = calls.filter((call) => call.url.endsWith("/api/v4/personal_access_tokens/self"));
assert.strictEqual(validateCalls.length, 1, "O token colado deve ser validado antes de ser persistido");

const webLoginCalls = calls.filter((call) => call.url.includes("/users/sign_in"));
assert.strictEqual(webLoginCalls.length, 0, "Nenhum login web (usuário/senha) pode acontecer ao colar um token existente");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  token?: string;
  useBasicAuth?: boolean;
  password?: string;
}>;
assert.strictEqual(serverData.length, 1, "git-servers.json deve conter o servidor cadastrado");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, "https://git.example.com");
assert.strictEqual(saved.token, "glpat-pasted-directly", "O token colado deve ser persistido tal como informado");
assert.strictEqual(saved.useBasicAuth, undefined, "useBasicAuth nunca deve ser persistido");
assert.strictEqual(saved.password, undefined, "A senha nunca deve ser persistida");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_paste_token_test: OK");
