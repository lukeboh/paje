import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regressão: um token de GitHub inválido/expirado (401/403) costumava ser
// engolido por um `catch { return null; }` genérico — o servidor era pulado
// sem nenhuma mensagem específica, indistinguível de um erro de rede. GitHub
// não oferece nem rotação silenciosa (como o GitLab) nem bootstrap por senha,
// então a única cura possível hoje é uma mensagem clara orientando o usuário
// a colar um token novo via `git-server-store`.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalLog = console.log;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-github-expired-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(
  serversPath,
  JSON.stringify([
    {
      id: "https://github.com",
      name: "Expired-GitHub",
      baseUrl: "https://github.com",
      type: "github",
      username: "usuario",
      token: "ghp-expired",
    },
  ]),
  "utf-8"
);

const calls: Array<{ url: string }> = [];

const mockFetch = async (url: string): Promise<Response> => {
  calls.push({ url });
  if (url.startsWith("https://api.github.com/")) {
    return new Response("Bad credentials", { status: 401, headers: { "content-type": "application/json" } });
  }
  throw new Error(`URL inesperada: ${url}`);
};

globalThis.fetch = mockFetch as typeof fetch;

let capturedLogs = "";
console.log = (...args: unknown[]) => {
  capturedLogs += `${args.map((item) => String(item)).join(" ")}\n`;
};

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const program = new Command();
configureGitSyncCommand(program);
process.argv = ["node", "cli.ts", "git-sync", "--no-summary"];
await program.parseAsync(process.argv);

const warnedExpired =
  capturedLogs.includes("O token do GitHub para Expired-GitHub expirou ou foi revogado") ||
  capturedLogs.includes("The GitHub token for Expired-GitHub expired or was revoked");
assert.ok(warnedExpired, "Deve avisar especificamente que o token do GitHub expirou/foi revogado");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{ token?: string }>;
assert.strictEqual(serverData[0].token, "ghp-expired", "Não deve tentar (nem conseguir) alterar o token do GitHub sozinho");

console.log = originalLog;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.argv = originalArgv;

console.log("git_sync_github_token_expired_test: OK");
