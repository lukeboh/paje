import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression coverage for the "I want to authenticate to github.com" quick
// pick on the auth-method screen (new capability — previously a brand new
// registration always showed the GitLab-oriented SSH/password/paste question
// with no indication that github.com only needs a pasted token; picking any
// of those three still worked, since the base URL alone decides which
// store* function runs, but the base URL had to be typed out by hand and the
// options offered were misleading for GitHub). Confirms: choosing this
// option pre-fills the base URL as https://github.com on the following form,
// asks for a token (never a password/token-name), and persists a proper
// GitHub server entry.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-github-quick-pick-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const calls: Array<{ url: string }> = [];

const mockFetch = async (url: string): Promise<Response> => {
  calls.push({ url });
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
let formOpts: { fields: Array<{ name: string; defaultValue?: string }> } | undefined;

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
  promptForm: async (opts: { fields: Array<{ name: string; defaultValue?: string }> }) => {
    formOpts = opts;
    return {
      baseUrl: opts.fields.find((field) => field.name === "baseUrl")?.defaultValue ?? "",
      serverName: opts.fields.find((field) => field.name === "serverName")?.defaultValue ?? "",
      username: "",
      token: "ghp-quick-pick",
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

assert.ok(formOpts, "O formulário de cadastro deve ser exibido");
const baseUrlField = formOpts?.fields.find((field) => field.name === "baseUrl");
assert.strictEqual(baseUrlField?.defaultValue, "https://github.com", "A URL deve vir pré-preenchida com https://github.com");
assert.ok(
  formOpts?.fields.some((field) => field.name === "token"),
  "Deve pedir o token diretamente, sem passar por senha"
);
assert.ok(
  !formOpts?.fields.some((field) => field.name === "password"),
  "Não pode pedir senha para o atalho do github.com"
);

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  type?: string;
  token?: string;
  username?: string;
}>;
assert.strictEqual(serverData.length, 1, "git-servers.json deve conter o servidor cadastrado");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, "https://github.com");
assert.strictEqual(saved.type, "github");
assert.strictEqual(saved.token, "ghp-quick-pick");
assert.strictEqual(saved.username, "novo-usuario", "O login deve vir da API do GitHub, não do formulário");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_github_quick_pick_test: OK");
