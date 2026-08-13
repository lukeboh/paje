import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression coverage for the "I want to authenticate to github.com" quick
// pick on the auth-method screen. It used to only pre-fill the base URL and
// still ask the user to paste a token by hand; it now runs the actual OAuth
// device flow — request a device code, best-effort open the browser to it,
// show the code as a fallback, poll until the user authorizes, and persist
// the resulting token — no URL/username/password/token typing at all.
// Confirms: no form is shown, the device code + polling endpoints are called
// with PAJÉ's client ID, a slow "authorization_pending" response is retried
// instead of failing, and the persisted server carries tokenOrigin
// "oauth-device-flow" (distinguishing it from a manually pasted token).

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-github-device-flow-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const calls: Array<{ url: string; body?: string }> = [];
let accessTokenPollCount = 0;

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const body = typeof init?.body === "string" ? init.body : undefined;
  calls.push({ url, body });

  if (url === "https://github.com/login/device/code") {
    return new Response(
      JSON.stringify({
        device_code: "device-code-xyz",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        verification_uri_complete: "https://github.com/login/device?user_code=ABCD-1234",
        expires_in: 900,
        interval: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (url === "https://github.com/login/oauth/access_token") {
    accessTokenPollCount += 1;
    if (accessTokenPollCount === 1) {
      return new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ access_token: "gho-device-flow-token", scope: "repo read:org" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url === "https://api.github.com/user") {
    return new Response(JSON.stringify({ id: 1, login: "novo-usuario" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

let serverListVisits = 0;
let formShown = false;
const shownMessages: string[] = [];

const sessionMock = {
  promptInput: async () => "",
  promptPassword: async () => "",
  promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
    const isAuthMethodChoice = opts.choices.some(
      (choice) => choice.value === "ssh" || choice.value === "password" || choice.value === "paste"
    );
    if (isAuthMethodChoice) {
      assert.strictEqual(opts.choices[0]?.value, "github", "A opção 'autenticar ao github.com' deve ser a primeira da lista");
      return "github";
    }
    serverListVisits += 1;
    if (serverListVisits === 1) {
      return opts.choices[0]?.value ?? null;
    }
    return null;
  },
  promptForm: async () => {
    formShown = true;
    return null;
  },
  promptConfirm: async () => true,
  showInlineError: () => undefined,
  showMessage: async (opts: { message: string }) => {
    shownMessages.push(opts.message);
  },
  setParameters: () => undefined,
  getParameters: () => [],
  mountScreen: () => 1,
  releaseScreen: () => undefined,
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

assert.strictEqual(formShown, false, "O atalho do github.com nunca deve mostrar o formulário de URL/usuário/token");

const deviceCodeCalls = calls.filter((call) => call.url === "https://github.com/login/device/code");
assert.strictEqual(deviceCodeCalls.length, 1, "Deve pedir um device code ao GitHub");
assert.ok(
  deviceCodeCalls[0].body?.includes("client_id=Ov23li2sMJinkczX2RFj"),
  "Deve usar o Client ID do OAuth App do PAJÉ"
);

assert.ok(
  shownMessages.some((message) => message.includes("ABCD-1234") && message.includes("https://github.com/login/device")),
  "Deve mostrar o código e a URL de verificação como retaguarda, mesmo tentando abrir o navegador sozinho"
);

assert.strictEqual(accessTokenPollCount, 2, "Deve tentar de novo depois de um 'authorization_pending', não falhar na primeira tentativa");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  type?: string;
  token?: string;
  tokenOrigin?: string;
  username?: string;
}>;
assert.strictEqual(serverData.length, 1, "git-servers.json deve conter o servidor cadastrado");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, "https://github.com");
assert.strictEqual(saved.type, "github");
assert.strictEqual(saved.token, "gho-device-flow-token");
assert.strictEqual(saved.tokenOrigin, "oauth-device-flow", "O token do device flow deve ser identificado como tal");
assert.strictEqual(saved.username, "novo-usuario", "O login deve vir da API do GitHub");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_github_quick_pick_test: OK");
