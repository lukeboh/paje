import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regression coverage for the "quick registration" gap in git-sync: running
// `git-sync --server-name X --base-url Y ...` with no servers configured yet
// used to persist a bare GitServerEntry (no token, no SSH association) and
// go straight on to syncing — the exact server shape that used to keep
// re-prompting for a password on every single run instead of ever finishing
// its setup. It now runs through the same bootstrap the full "Manage Git
// Servers" flow uses right after saving that bare entry, so by the time
// sync actually starts, the server has a real token.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-quick-register-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
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
<html><body><input id="created-personal-access-token" value="glpat-quick-xyz" /></body></html>
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
    return makeResponse(JSON.stringify({ token: "glpat-quick-xyz" }), 201, makeHeaders({ "content-type": "application/json" }));
  }
  if (url.includes("/api/v4/groups") || url.includes("/api/v4/projects")) {
    return makeResponse("[]", 200, makeHeaders({ "content-type": "application/json" }));
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const program = new Command();
configureGitSyncCommand(program);
process.argv = [
  "node",
  "cli.ts",
  "git-sync",
  "--server-name",
  "Quick-GitLab",
  "--base-url",
  "https://git.quick.example.com",
  "--use-basic-auth",
  "--username",
  "usuario",
  "--password",
  "segredo",
  "--no-summary",
];
await program.parseAsync(process.argv);

const tokenCreateCalls = calls.filter(
  (call) => call.url.endsWith("/-/user_settings/personal_access_tokens") && call.method === "POST"
);
assert.strictEqual(tokenCreateCalls.length, 1, "O cadastro rápido deve completar o bootstrap e criar um token");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  token?: string;
  useBasicAuth?: boolean;
}>;
assert.strictEqual(serverData.length, 1, "git-servers.json deve conter o servidor cadastrado rapidamente");
const saved = serverData[0];
assert.strictEqual(saved.baseUrl, "https://git.quick.example.com");
assert.strictEqual(saved.token, "glpat-quick-xyz", "O servidor não pode ficar sem token após o cadastro rápido");
assert.strictEqual(saved.useBasicAuth, undefined, "useBasicAuth nunca deve ser persistido");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.argv = originalArgv;

console.log("git_sync_quick_register_bootstrap_test: OK");
