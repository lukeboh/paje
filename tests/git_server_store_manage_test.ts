import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression test for two bugs found in the interactive "Manage Git Servers"
// flow (git-server-store run from the TUI menu, i.e. with a session):
//
// 1. `tokenName` had no interactive prompt anywhere. Since the TUI menu runs
//    the command with zero CLI flags, `resolvedTokenName` was always empty,
//    which made storeSshKeyOnly/storeGitHubServer's basic-auth branch bail
//    out early (`if (!resolvedTokenName) { ...; return; }`) *before* ever
//    calling writeGitServers — so ~/.paje/git-servers.json was never updated
//    no matter what the user typed into the wizard.
// 2. The registration screens should now be a single combined form (baseUrl,
//    serverName, username, password, tokenName together), reached through a
//    "Manage Git Servers" list+register flow instead of a field-by-field
//    wizard.
//
// This test drives that flow with a mocked TuiSession (no real Ink
// rendering) and a mocked GitLab HTTP surface, and asserts the new server
// — including its freshly created token — actually lands in git-servers.json.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-manage-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const makeHeaders = (extra?: Record<string, string>) => ({
  "content-type": "text/html; charset=utf-8",
  ...(extra ?? {}),
});
const makeResponse = (body: string, status: number, headers?: Record<string, string>): Response =>
  new Response(body, { status, headers: headers ?? {} });

const signInHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-signin" /></head>
  <body><form><input type="hidden" name="authenticity_token" value="token-signin" /></form></body>
</html>
`;
const tokenHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-token" /></head>
  <body><form><input type="hidden" name="authenticity_token" value="token-personal" /></form></body>
</html>
`;
const createdTokenHtml = `
<html><body><input id="created-personal-access-token" value="glpat-xyz" /></body></html>
`;

let tokenCreated = false;
const calls: Array<{ url: string; method?: string }> = [];

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  calls.push({ url, method: init?.method });
  if (url.endsWith("/users/sign_in")) {
    return makeResponse(signInHtml, 200, makeHeaders({ "set-cookie": "_gitlab_session=abc; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/users/auth/ldapmain/callback")) {
    return makeResponse("", 302, makeHeaders({ location: "/", "set-cookie": "_gitlab_session=def; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/-/user_settings/personal_access_tokens") && (!init?.method || init.method === "GET")) {
    if (tokenCreated) {
      return makeResponse(createdTokenHtml, 200, makeHeaders());
    }
    return makeResponse(tokenHtml, 200, makeHeaders({ "set-cookie": "_gitlab_session=ghi; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/-/user_settings/personal_access_tokens") && init?.method === "POST") {
    tokenCreated = true;
    return makeResponse(JSON.stringify({ token: "glpat-xyz" }), 201, makeHeaders({ "content-type": "application/json" }));
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

const promptListCalls: unknown[] = [];
const serverListCalls: unknown[] = [];
const promptFormCalls: unknown[] = [];
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
      // "I don't have SSH, but I have a username and password" — bootstraps a
      // token via the same basic-auth flow this test already exercises,
      // avoiding the need for a real port-22 probe.
      return "password";
    }
    serverListCalls.push(opts);
    serverListVisits += 1;
    // First visit to the server list: pick "register new" (always the first choice).
    // Second visit (after registration completes and the flow loops back): exit.
    if (serverListVisits === 1) {
      return opts.choices[0]?.value ?? null;
    }
    return null;
  },
  promptForm: async (opts: { fields: Array<{ name: string }> }) => {
    promptFormCalls.push(opts);
    return {
      baseUrl: "https://git.example.com",
      serverName: "Example GitLab",
      username: "usuario",
      password: "segredo",
      tokenName: "paje-token",
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

assert.strictEqual(serverListVisits, 2, "Deve mostrar a lista antes e depois do cadastro (fluxo de gerenciamento)");
assert.strictEqual(
  promptListCalls.length,
  3,
  "Lista de servidores (antes) + escolha do método de autenticação + lista de servidores (depois)"
);
assert.strictEqual(promptFormCalls.length, 1, "Deve coletar todos os campos em uma única tela de formulário");

const firstListChoices = (serverListCalls[0] as { choices: Array<{ value: unknown; label: string }> }).choices;
assert.strictEqual(firstListChoices.length, 1, "Lista inicial (sem servidores) deve ter apenas a opção de cadastro");
const secondListChoices = (serverListCalls[1] as { choices: Array<{ value: unknown; label: string }> }).choices;
assert.ok(
  secondListChoices.some((choice) => choice.label.includes("https://git.example.com")),
  "Após o cadastro, a lista deve refletir o novo servidor salvo"
);

const tokenCreateCalls = calls.filter(
  (call) => call.url.endsWith("/-/user_settings/personal_access_tokens") && call.method === "POST"
);
assert.strictEqual(tokenCreateCalls.length, 1, "Deve criar o token via fluxo de autenticação básica");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  name: string;
  token?: string;
  tokenName?: string;
  useBasicAuth?: boolean;
  password?: string;
}>;
assert.strictEqual(serverData.length, 1, "git-servers.json deve conter o novo servidor cadastrado");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, "https://git.example.com");
assert.strictEqual(saved.name, "Example GitLab");
assert.strictEqual(saved.token, "glpat-xyz", "O token recém-criado deve ser persistido");
assert.strictEqual(saved.tokenName, "paje-token");
assert.strictEqual(saved.useBasicAuth, undefined, "useBasicAuth nunca deve ser persistido em git-servers.json");
assert.strictEqual(saved.password, undefined, "A senha nunca deve ser persistida em git-servers.json");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_manage_test: OK");
