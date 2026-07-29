import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Feature: editing an already-registered git server from the TUI
// ("Gerenciar Servidores Git" list). Before this, selecting an existing
// server only opened a read-only details view — there was no way to change
// anything about it short of hand-editing ~/.paje/git-servers.json.
//
// Covers:
// 1. Selecting an existing server opens the SAME form used for registration,
//    pre-filled with that server's current baseUrl/serverName/username/
//    tokenName (not the blank/generic defaults used for a brand new server).
// 2. Saving updates the entry in place — no duplicate is created.
// 3. Properties the form doesn't expose (userEmail, baseDir, filter,
//    noPublicRepos, tokenExpiresAt) are preserved from the existing entry
//    rather than wiped out by the current invocation's empty CLI options
//    (the specific regression this feature could easily have introduced,
//    since those fields used to be sourced unconditionally from `options`).
// 4. Renaming the server's baseUrl during edit does not leave a stale
//    duplicate behind under the old URL.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-edit-server-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");

const existingServer = {
  id: "https://github.com",
  name: "GH Antigo",
  baseUrl: "https://github.com",
  type: "github" as const,
  useBasicAuth: false,
  username: "antigo-login",
  token: "ghp-existing",
  tokenName: "paje",
  userEmail: "old@example.com",
  baseDir: "/repos/old",
  filter: "grupo/*",
  noPublicRepos: true,
  tokenExpiresAt: "2030-01-01",
};
fs.writeFileSync(serversPath, JSON.stringify([existingServer]), "utf-8");

const mockFetch = async (url: string): Promise<Response> => {
  // github.com resolves to api.github.com; a *.github.com host (used below
  // to simulate a GitHub Enterprise Server rename) resolves to <host>/api/v3.
  if (url === "https://api.github.com/user" || url === "https://ghe.github.com/api/v3/user") {
    return new Response(JSON.stringify({ id: 1, login: "novo-login" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`URL inesperada: ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

const promptFormCalls: Array<{ fields: Array<{ name: string; defaultValue?: string }> }> = [];
const showMessageCalls: Array<{ title: string; message: string }> = [];
let promptListCallCount = 0;

const sessionMock = {
  promptInput: async () => "",
  promptPassword: async () => "",
  promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
    promptListCallCount += 1;
    // First visit: pick the existing server (never "__register__", which is
    // always choices[0]) to enter the edit flow. Second visit: exit.
    if (promptListCallCount === 1) {
      const existingChoice = opts.choices.find((choice) => choice.value === existingServer.id);
      return existingChoice?.value ?? null;
    }
    return null;
  },
  promptForm: async (opts: { fields: Array<{ name: string; defaultValue?: string }> }) => {
    promptFormCalls.push(opts);
    // Only the display name changes; baseUrl/username/tokenName stay as-is.
    return {
      baseUrl: existingServer.baseUrl,
      serverName: "GH Renomeado",
      username: existingServer.username,
      password: "",
      tokenName: existingServer.tokenName,
    };
  },
  promptConfirm: async () => false,
  showInlineError: () => undefined,
  showMessage: async (opts: { title: string; message: string }) => {
    showMessageCalls.push(opts);
  },
  setParameters: () => undefined,
  getParameters: () => [],
  destroy: () => undefined,
};

const program = new Command();
configureSshKeyStoreCommand(program, sessionMock as unknown as import("../src/modules/git/tuiSession.js").TuiSession);

const originalArgv = process.argv;
const parseArgs = ["node", "cli.ts", "git-server-store"];
process.argv = parseArgs;
await program.parseAsync(parseArgs);
process.argv = originalArgv;

// 1. Details were shown before the form (nothing lost by adding edit)
assert.ok(
  showMessageCalls.some((call) => call.message.includes("old@example.com") && call.message.includes("/repos/old")),
  "Selecionar um servidor existente deve mostrar seus detalhes atuais antes do formulário"
);

// 1b. The form opened pre-filled with the EXISTING server's values, not the
// blank/generic defaults used when registering a new server.
assert.strictEqual(promptFormCalls.length, 1, "Deve abrir o formulário uma única vez para o servidor selecionado");
const fieldDefault = (name: string): string | undefined =>
  promptFormCalls[0]?.fields.find((field) => field.name === name)?.defaultValue;
assert.strictEqual(fieldDefault("baseUrl"), existingServer.baseUrl, "Formulário deve pré-preencher a URL existente");
assert.strictEqual(fieldDefault("serverName"), existingServer.name, "Formulário deve pré-preencher o nome existente");
assert.strictEqual(fieldDefault("username"), existingServer.username, "Formulário deve pré-preencher o usuário existente");
assert.strictEqual(fieldDefault("tokenName"), existingServer.tokenName, "Formulário deve pré-preencher o nome do token existente");

// 2 & 3. Saved in place (no duplicate), edited field updated, fields outside
// the form preserved from the existing entry.
const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<Record<string, unknown>>;
assert.strictEqual(serverData.length, 1, "Editar não pode duplicar a entrada do servidor");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, existingServer.baseUrl);
assert.strictEqual(saved.name, "GH Renomeado", "O campo alterado no formulário deve ser persistido");
assert.strictEqual(saved.token, "ghp-existing", "Token existente e válido deve ser mantido, não descartado");
assert.strictEqual(saved.userEmail, "old@example.com", "userEmail (fora do formulário) deve ser preservado");
assert.strictEqual(saved.baseDir, "/repos/old", "baseDir (fora do formulário) deve ser preservado");
assert.strictEqual(saved.filter, "grupo/*", "filter (fora do formulário) deve ser preservado");
assert.strictEqual(saved.noPublicRepos, true, "noPublicRepos (fora do formulário) deve ser preservado");
assert.strictEqual(saved.tokenExpiresAt, "2030-01-01", "tokenExpiresAt (fora do formulário) deve ser preservado");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_edit_test: OK (parte 1/2)");

// --- Parte 2: renomear a baseUrl durante a edição não deve deixar duplicata ---

const tempHome2 = fs.mkdtempSync(path.join(os.tmpdir(), "paje-edit-server-rename-"));
process.env.HOME = tempHome2;
process.env.PAJE_SKIP_SSH_STORE = "1";
const pajeDir2 = path.join(tempHome2, ".paje");
fs.mkdirSync(pajeDir2, { recursive: true });
const serversPath2 = path.join(pajeDir2, "git-servers.json");

const existingServer2 = {
  id: "https://github.com",
  name: "GH Original",
  baseUrl: "https://github.com",
  type: "github" as const,
  useBasicAuth: false,
  username: "user2",
  token: "ghp-existing-2",
  tokenName: "paje",
};
fs.writeFileSync(serversPath2, JSON.stringify([existingServer2]), "utf-8");

globalThis.fetch = mockFetch as typeof fetch;

let promptListCallCount2 = 0;
const sessionMock2 = {
  promptInput: async () => "",
  promptPassword: async () => "",
  promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
    promptListCallCount2 += 1;
    if (promptListCallCount2 === 1) {
      const existingChoice = opts.choices.find((choice) => choice.value === existingServer2.id);
      return existingChoice?.value ?? null;
    }
    return null;
  },
  // Polymorphic like the real TUI: the 5-field registration form and the
  // single-field "enter a new GitHub token" prompt both go through
  // `promptForm`, distinguished only by which fields are requested. A rename
  // to a different host means storeGitHubServer can no longer find a token
  // under the new identity, so it prompts for a fresh one — expected, since
  // a different GitHub host legitimately needs its own PAT.
  promptForm: async (opts: { fields: Array<{ name: string }> }) => {
    if (opts.fields.some((field) => field.name === "baseUrl")) {
      // A genuinely different host (still *.github.com, so it keeps
      // resolving as a GitHub server — simulates moving to a GHES instance).
      return {
        baseUrl: "https://ghe.github.com",
        serverName: existingServer2.name,
        username: existingServer2.username,
        password: "",
        tokenName: existingServer2.tokenName,
      };
    }
    return { token: "ghp-new-for-ghe" };
  },
  promptConfirm: async () => false,
  showInlineError: () => undefined,
  showMessage: async () => undefined,
  setParameters: () => undefined,
  getParameters: () => [],
  destroy: () => undefined,
};

const program2 = new Command();
configureSshKeyStoreCommand(program2, sessionMock2 as unknown as import("../src/modules/git/tuiSession.js").TuiSession);
process.argv = parseArgs;
await program2.parseAsync(parseArgs);
process.argv = originalArgv;

const serverData2 = JSON.parse(fs.readFileSync(serversPath2, "utf-8")) as Array<Record<string, unknown>>;
assert.strictEqual(
  serverData2.length,
  1,
  "Renomear a baseUrl durante a edição não pode deixar a entrada antiga órfã"
);
assert.strictEqual(
  serverData2[0]?.baseUrl,
  "https://ghe.github.com",
  "A única entrada restante deve ser a da nova URL, não a antiga"
);

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;

console.log("git_server_store_edit_test: OK");
