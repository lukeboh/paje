import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Covers the "Regenerate token" action in the Manage Git Servers screen:
// picking an existing server now offers "Update server details" (the
// pre-filled form) or "Regenerate token", which renews only the token and
// leaves the rest of the entry untouched.
//
// 1. GitLab with a token that can be rotated: rotates it via
//    /personal_access_tokens/self/rotate, never asks for a password, never
//    shows the registration form, and keeps every other property.
// 2. GitLab whose rotation fails and the user cancels the password prompt:
//    nothing is persisted — the current token is kept.
// 3. GitHub: runs a new OAuth device flow and persists the new token with
//    tokenOrigin "oauth-device-flow", keeping every other property.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;
const originalNoBrowser = process.env.PAJE_NO_BROWSER;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-regenerate-token-home-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";
process.env.PAJE_NO_BROWSER = "1";

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");

type SavedServer = {
  id: string;
  name: string;
  baseUrl: string;
  type?: string;
  username?: string;
  token?: string;
  tokenOrigin?: string;
  filter?: string;
  baseDir?: string;
};

const gitlabServer: SavedServer = {
  id: "https://gitlab.example.com",
  name: "Corp",
  baseUrl: "https://gitlab.example.com",
  type: "gitlab",
  username: "dev",
  token: "glpat-old",
  tokenOrigin: "personal-access-token",
  filter: "grupo/**",
  baseDir: "/tmp/repos",
};
const githubServer: SavedServer = {
  id: "https://github.com",
  name: "GitHub",
  baseUrl: "https://github.com",
  type: "github",
  username: "antigo",
  token: "ghp-old",
  tokenOrigin: "personal-access-token",
  filter: "org/**",
};

const readServers = (): SavedServer[] => JSON.parse(fs.readFileSync(serversPath, "utf-8")) as SavedServer[];

const calls: string[] = [];
let rotateStatus = 200;

globalThis.fetch = (async (url: string): Promise<Response> => {
  calls.push(url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url === "https://gitlab.example.com/api/v4/personal_access_tokens/self/rotate") {
    return rotateStatus === 200
      ? json({ id: 7, name: "paje", token: "glpat-new", scopes: ["read_api"], expires_at: "2027-01-01" })
      : json({ message: "401 Unauthorized" }, rotateStatus);
  }
  if (url === "https://github.com/login/device/code") {
    return json({
      device_code: "device-code",
      user_code: "WXYZ-9876",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 1,
    });
  }
  if (url === "https://github.com/login/oauth/access_token") {
    return json({ access_token: "gho-new", scope: "repo workflow write:packages read:org" });
  }
  if (url === "https://api.github.com/user") {
    return json({ id: 1, login: "novo-login" });
  }
  throw new Error(`URL inesperada: ${url}`);
}) as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

const runRegenerate = async (serverId: string) => {
  let serverListVisits = 0;
  const actionChoices: unknown[] = [];
  const forms: Array<{ fields: Array<{ name: string }> }> = [];
  const messages: string[] = [];
  const session = {
    promptInput: async () => "",
    promptPassword: async () => "",
    promptList: async (opts: { choices: Array<{ value: unknown }> }) => {
      if (opts.choices.some((choice) => choice.value === "regenerate-token")) {
        actionChoices.push(...opts.choices.map((choice) => choice.value));
        return "regenerate-token";
      }
      serverListVisits += 1;
      return serverListVisits === 1 ? serverId : null;
    },
    // Only reachable as the GitLab password prompt; answering empty cancels.
    promptForm: async (opts: { fields: Array<{ name: string }> }) => {
      forms.push(opts);
      return { password: "" };
    },
    promptConfirm: async () => false,
    showInlineError: () => undefined,
    showMessage: async (opts: { message: string }) => {
      messages.push(opts.message);
    },
    setParameters: () => undefined,
    getParameters: () => [],
    mountScreen: () => 1,
    releaseScreen: () => undefined,
    destroy: () => undefined,
  };
  const program = new Command();
  configureSshKeyStoreCommand(program, session as unknown as import("../src/modules/git/tuiSession.js").TuiSession);
  const originalArgv = process.argv;
  const args = ["node", "cli.ts", "git-server-store"];
  process.argv = args;
  try {
    await program.parseAsync(args);
  } finally {
    process.argv = originalArgv;
  }
  return { actionChoices, forms, messages };
};

// 1. GitLab — rotation succeeds.
fs.writeFileSync(serversPath, JSON.stringify([gitlabServer, githubServer]), "utf-8");
rotateStatus = 200;
const rotated = await runRegenerate(gitlabServer.id);
assert.deepStrictEqual(rotated.actionChoices, ["edit", "regenerate-token"], "O servidor deve oferecer atualizar dados e regerar token");
assert.strictEqual(rotated.forms.length, 0, "Rotação bem-sucedida não deve pedir senha nem abrir formulário");
const afterRotate = readServers().find((server) => server.baseUrl === gitlabServer.baseUrl);
assert.strictEqual(afterRotate?.token, "glpat-new", "O token rotacionado deve ser persistido");
assert.strictEqual(afterRotate?.name, "Corp");
assert.strictEqual(afterRotate?.filter, "grupo/**", "Regerar o token não pode apagar o filtro");
assert.strictEqual(afterRotate?.baseDir, "/tmp/repos", "Regerar o token não pode apagar o baseDir");
assert.strictEqual(readServers().length, 2, "Nenhum servidor pode ser duplicado ou removido");

// 2. GitLab — rotation fails and the password prompt is cancelled.
fs.writeFileSync(serversPath, JSON.stringify([gitlabServer, githubServer]), "utf-8");
rotateStatus = 401;
const cancelled = await runRegenerate(gitlabServer.id);
assert.strictEqual(cancelled.forms.length, 1, "Sem rotação possível, deve pedir a senha uma vez");
assert.deepStrictEqual(cancelled.forms[0].fields.map((field) => field.name), ["password"]);
assert.strictEqual(
  readServers().find((server) => server.baseUrl === gitlabServer.baseUrl)?.token,
  "glpat-old",
  "Cancelar deve manter o token atual"
);

// 3. GitHub — new device-flow authorization.
fs.writeFileSync(serversPath, JSON.stringify([gitlabServer, githubServer]), "utf-8");
const github = await runRegenerate(githubServer.id);
assert.ok(
  github.messages.some((message) => message.includes("WXYZ-9876")),
  "O código do device flow deve ser exibido ao usuário"
);
const afterGithub = readServers().find((server) => server.baseUrl === githubServer.baseUrl);
assert.strictEqual(afterGithub?.token, "gho-new");
assert.strictEqual(afterGithub?.tokenOrigin, "oauth-device-flow");
assert.strictEqual(afterGithub?.username, "novo-login");
assert.strictEqual(afterGithub?.filter, "org/**", "Regerar o token não pode apagar o filtro");
assert.strictEqual(
  readServers().find((server) => server.baseUrl === gitlabServer.baseUrl)?.token,
  "glpat-old",
  "Regerar o token de um servidor não pode afetar os demais"
);

globalThis.fetch = originalFetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;
process.env.PAJE_NO_BROWSER = originalNoBrowser;

console.log("git_server_store_regenerate_token_test: OK");
