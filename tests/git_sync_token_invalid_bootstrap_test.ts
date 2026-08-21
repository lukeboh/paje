import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

// Regressão: quando um token existente falha (401/403) E a tentativa de
// rotação silenciosa também falha (token de fato revogado, não só expirado),
// o PAJÉ deve cair no bootstrap por senha — pedindo a senha uma única vez,
// gerando um token novo via login web, e persistindo — em vez de só avisar
// "sem autenticação" e desistir (como fazia antes desta mudança).

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalPrompt = inquirer.prompt;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-invalid-bootstrap-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(
  serversPath,
  JSON.stringify([
    {
      id: "https://git.revoked.example.com",
      name: "Revoked-GitLab",
      baseUrl: "https://git.revoked.example.com",
      username: "usuario",
      token: "glpat-fully-revoked",
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
<html><body><input id="created-personal-access-token" value="glpat-freshly-bootstrapped" /></body></html>
`;

let tokenCreated = false;
const calls: Array<{ url: string; method?: string; token?: string | null }> = [];

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const token = headers["PRIVATE-TOKEN"] ?? null;
  calls.push({ url, method: init?.method, token });

  if (url.endsWith("/api/v4/personal_access_tokens/self/rotate") && init?.method === "POST") {
    // The old token is fully revoked — even rotation is rejected.
    return makeResponse("Unauthorized", 401, makeHeaders({ "content-type": "application/json" }));
  }
  if (url.includes("/api/v4/groups") || url.includes("/api/v4/projects")) {
    if (token === "glpat-fully-revoked") {
      return makeResponse("Unauthorized", 401, makeHeaders({ "content-type": "application/json" }));
    }
    return makeResponse("[]", 200, makeHeaders({ "content-type": "application/json" }));
  }
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
    return makeResponse(
      JSON.stringify({ token: "glpat-freshly-bootstrapped" }),
      201,
      makeHeaders({ "content-type": "application/json" })
    );
  }
  throw new Error(`URL inesperada: ${url} (token=${token})`);
};

globalThis.fetch = mockFetch as typeof fetch;

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

assert.strictEqual(passwordPromptCount, 1, "Deve pedir a senha exatamente uma vez, já que a rotação silenciosa falhou");

const rotateCalls = calls.filter((call) => call.url.endsWith("/personal_access_tokens/self/rotate"));
assert.strictEqual(rotateCalls.length, 1, "Deve tentar rotacionar antes de cair no bootstrap por senha");

const tokenCreateCalls = calls.filter(
  (call) => call.url.endsWith("/-/user_settings/personal_access_tokens") && call.method === "POST"
);
assert.strictEqual(tokenCreateCalls.length, 1, "Deve criar um token novo via bootstrap por senha");

const listCallsWithNewToken = calls.filter(
  (call) => call.url.includes("/api/v4/groups") && call.token === "glpat-freshly-bootstrapped"
);
assert.strictEqual(listCallsWithNewToken.length, 1, "Deve tentar listar de novo com o token recém-gerado");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{ token?: string }>;
assert.strictEqual(serverData[0].token, "glpat-freshly-bootstrapped", "O token gerado via bootstrap deve ser persistido");

inquirer.prompt = originalPrompt;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.argv = originalArgv;

console.log("git_sync_token_invalid_bootstrap_test: OK");
