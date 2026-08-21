import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

// Regression coverage for the "self-healing" bootstrap: a server already
// saved in git-servers.json with no token and no SSH association (e.g. one
// left over from before the token-first redesign, or one whose setup was
// interrupted) used to either sit there forever unusable or (before that
// redesign) silently re-prompt for a password on every single sync run. It
// now bootstraps a token automatically the next time it's synced — asking
// for the password exactly once — and persists it, so it never has to
// happen again for that server.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalPrompt = inquirer.prompt;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-missing-creds-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(
  serversPath,
  JSON.stringify([
    {
      id: "https://git.legacy.example.com",
      name: "Legacy-GitLab",
      baseUrl: "https://git.legacy.example.com",
      username: "usuario",
    },
  ]),
  "utf-8"
);

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
<html><body><input id="created-personal-access-token" value="glpat-healed-xyz" /></body></html>
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
    return makeResponse(JSON.stringify({ token: "glpat-healed-xyz" }), 201, makeHeaders({ "content-type": "application/json" }));
  }
  if (url.includes("/api/v4/groups") || url.includes("/api/v4/projects")) {
    return makeResponse("[]", 200, makeHeaders({ "content-type": "application/json" }));
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

// Non-interactive path (no TUI session): promptBasicAuthPassword falls back
// to inquirer, asked exactly once for the missing password.
let passwordPromptCount = 0;
inquirer.prompt = (async () => {
  passwordPromptCount += 1;
  return { password: "segredo" };
}) as unknown as typeof inquirer.prompt;

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const program = new Command();
configureGitSyncCommand(program);
process.argv = ["node", "cli.ts", "git-sync", "--no-summary"];
await program.parseAsync(process.argv);

assert.strictEqual(passwordPromptCount, 1, "A senha deve ser pedida exatamente uma vez para o bootstrap automático");

const tokenCreateCalls = calls.filter(
  (call) => call.url.endsWith("/-/user_settings/personal_access_tokens") && call.method === "POST"
);
assert.strictEqual(tokenCreateCalls.length, 1, "Deve criar um token automaticamente ao sincronizar um servidor sem credenciais");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  token?: string;
}>;
assert.strictEqual(serverData.length, 1);
assert.strictEqual(serverData[0].token, "glpat-healed-xyz", "O token gerado automaticamente deve ser persistido");

inquirer.prompt = originalPrompt;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.argv = originalArgv;

console.log("git_sync_missing_credentials_bootstrap_test: OK");
