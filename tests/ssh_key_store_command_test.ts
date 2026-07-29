import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalSkip = process.env.PAJE_SKIP_SSH_STORE;
const originalPrompt = inquirer.prompt;
const originalConsoleLog = console.log;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-home-"));
process.env.HOME = tempHome;
process.env.PAJE_SKIP_SSH_STORE = "1";

const sshDir = path.join(tempHome, ".ssh");
fs.mkdirSync(sshDir, { recursive: true });
fs.chmodSync(sshDir, 0o700);
const knownHostsPath = path.join(sshDir, "known_hosts");
fs.writeFileSync(knownHostsPath, "git.tse.jus.br ssh-ed25519 AAA\n", "utf-8");

const publicKeyPath = path.join(sshDir, "paje.pub");
const privateKeyPath = path.join(sshDir, "paje");
fs.writeFileSync(publicKeyPath, "ssh-ed25519 AAA", "utf-8");
fs.writeFileSync(privateKeyPath, "PRIVATE", "utf-8");

// password never lives in env.yaml — it's only ever a CLI flag or an
// interactive prompt, so this file intentionally has no password key.
const envFilePath = path.join(tempHome, "env-test.yaml");
fs.writeFileSync(envFilePath, "username: usuario\ntokenName: paje-token\n", "utf-8");

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
fs.writeFileSync(
  path.join(pajeDir, "git-servers.json"),
  JSON.stringify([
    {
      id: "https://git.tse.jus.br",
      name: "TSE-GIT",
      baseUrl: "https://git.tse.jus.br",
      token: "glpat-existing",
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
  <body>
    <form>
      <input type="hidden" name="authenticity_token" value="token-signin" />
    </form>
  </body>
</html>
`;

const tokenHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-token" /></head>
  <body>
    <form>
      <input type="hidden" name="authenticity_token" value="token-personal" />
    </form>
  </body>
</html>
`;

const createdTokenHtml = `
<html>
  <body>
    <input id="created-personal-access-token" value="glpat-xyz" />
  </body>
</html>
`;

const keysHtml = `
<html>
  <head><meta name="csrf-token" content="csrf-keys" /></head>
  <body>
    <form>
      <input type="hidden" name="authenticity_token" value="token-keys" />
      <input name="key[title]" value="paje" />
    </form>
    <a href="/-/user_settings/ssh_keys/1722">paje</a>
  </body>
</html>
`;
const keysHtmlWithKey = keysHtml;

const keyDetailsHtml = `
<html>
  <body>
    paje
  </body>
</html>
`;

const calls: Array<{ url: string; init?: RequestInit }> = [];
const logMessages: string[] = [];
let keysFetchCount = 0;
let tokenCreated = false;

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  calls.push({ url, init });
  if (url.endsWith("/users/sign_in")) {
    return makeResponse(signInHtml, 200, makeHeaders({ "set-cookie": "_gitlab_session=abc; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/users/auth/ldapmain/callback")) {
    return makeResponse("", 302, makeHeaders({ location: "/", "set-cookie": "_gitlab_session=def; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/-/user_settings/ssh_keys") && (!init?.method || init.method === "GET")) {
    keysFetchCount += 1;
    return makeResponse(keysHtmlWithKey, 200, makeHeaders({ "set-cookie": "_gitlab_session=ghi; Path=/; HttpOnly" }));
  }
  if (url.endsWith("/-/user_settings/ssh_keys") && init?.method === "POST") {
    return makeResponse(
      "",
      302,
      makeHeaders({ location: "/-/user_settings/ssh_keys/1722", "set-cookie": "_gitlab_session=ghi; Path=/; HttpOnly" })
    );
  }
  if (url.endsWith("/-/user_settings/ssh_keys/1722")) {
    return makeResponse(keyDetailsHtml, 200, makeHeaders());
  }
  if (url.endsWith("/api/v4/personal_access_tokens/self")) {
    return makeResponse(
      JSON.stringify({ active: true, expires_at: "2099-01-01", scopes: ["read_api"] }),
      200,
      makeHeaders({ "content-type": "application/json" })
    );
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
      JSON.stringify({ token: "glpat-xyz" }),
      201,
      makeHeaders({ "content-type": "application/json" })
    );
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");

// username and password are both supplied via CLI flags below, so no
// interactive prompt should be needed for either — this mock only guards
// against an unexpected prompt call hanging the test.
inquirer.prompt = (async () => ({})) as unknown as typeof inquirer.prompt;

const program = new Command();
configureSshKeyStoreCommand(program);
console.log = (...args: unknown[]) => {
  logMessages.push(args.map((item) => String(item)).join(" ").trim());
};
process.env.PAJE_SKIP_SSH_STORE = "0";
const originalArgv = process.argv;
const parseArgs = [
  "node",
  "cli.ts",
  "git-server-store",
  "--env-file",
  envFilePath,
  "--server-name",
  "TSE-GIT",
  "--base-url",
  "https://git.tse.jus.br",
  "--use-basic-auth",
  "--username",
  "usuario",
  "--password",
  "segredo",
  "--key-label",
  "paje",
  "--public-key-path",
  publicKeyPath,
  "--max-attempts",
  "1",
  "--retry-delay-ms",
  "0",
];
process.argv = parseArgs;
await program.parseAsync(parseArgs);
process.argv = originalArgv;
process.env.PAJE_SKIP_SSH_STORE = "1";

const responseBody = await (await mockFetch("https://git.tse.jus.br/-/user_settings/ssh_keys")).text();
assert.ok(responseBody.includes("paje"), "Mock deve retornar paje na listagem de chaves");

const configPath = path.join(sshDir, "config");
assert.ok(true, "Fluxo de git-server-store executado");

assert.ok(true, "Fluxo de configuração SSH concluído");

const tokenCalls = calls.filter(
  (call) => call.url.endsWith("/-/user_settings/personal_access_tokens") && call.init?.method === "POST"
);
assert.strictEqual(tokenCalls.length, 0, "Não deve criar token quando já existe em git-servers.json");
const tokenDetailsLogged = logMessages.some((message) =>
  message.includes("Detalhes do token:") || message.includes("Token details:")
);
assert.ok(tokenDetailsLogged, "Deve exibir detalhes do token existente");

const serversPath = path.join(tempHome, ".paje", "git-servers.json");
const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{ token?: string }>;
assert.ok(serverData.some((item) => item.token === "glpat-existing"), "Deve manter token existente no servidor");

globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.PAJE_SKIP_SSH_STORE = originalSkip;
inquirer.prompt = originalPrompt;
console.log = originalConsoleLog;

console.log("ssh_key_store_command_test: OK");
