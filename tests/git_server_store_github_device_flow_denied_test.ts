import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression coverage for the GitHub device flow's failure path: if the user
// denies authorization in the browser (or closes the page), GitHub's token
// endpoint replies with `error: "access_denied"`. The device flow must stop
// polling immediately (not keep retrying like it does for
// "authorization_pending"), show a message explaining what happened, and
// leave git-servers.json untouched — never persist a server with no token.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-github-device-flow-denied-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const calls: Array<{ url: string }> = [];
let accessTokenPollCount = 0;

const mockFetch = async (url: string): Promise<Response> => {
  calls.push({ url });

  if (url === "https://github.com/login/device/code") {
    return new Response(
      JSON.stringify({
        device_code: "device-code-xyz",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (url === "https://github.com/login/oauth/access_token") {
    accessTokenPollCount += 1;
    return new Response(JSON.stringify({ error: "access_denied" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

let serverListVisits = 0;
const shownMessages: string[] = [];

const sessionMock = {
  promptInput: async () => "",
  promptPassword: async () => "",
  promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
    const isAuthMethodChoice = opts.choices.some(
      (choice) => choice.value === "ssh" || choice.value === "password" || choice.value === "paste"
    );
    if (isAuthMethodChoice) {
      return "github";
    }
    serverListVisits += 1;
    if (serverListVisits === 1) {
      return opts.choices[0]?.value ?? null;
    }
    return null;
  },
  promptForm: async () => null,
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

assert.strictEqual(accessTokenPollCount, 1, "Não deve continuar tentando depois de um access_denied");

const deniedMessage =
  shownMessages.some((message) => message.includes("negada")) ||
  shownMessages.some((message) => message.toLowerCase().includes("denied"));
assert.ok(deniedMessage, "Deve avisar que a autorização foi negada");

const tokenApiCalls = calls.filter((call) => call.url === "https://api.github.com/user");
assert.strictEqual(tokenApiCalls.length, 0, "Nunca deve validar/persistir um token quando a autorização é negada");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as unknown[];
assert.strictEqual(serverData.length, 0, "Nenhum servidor deve ser persistido quando a autorização é negada");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_github_device_flow_denied_test: OK");
