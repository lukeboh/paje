import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalArgv = process.argv;
const originalHomedir = os.homedir;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-home-"));
process.env.HOME = tempHome;
os.homedir = () => tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
fs.writeFileSync(
  path.join(pajeDir, "git-servers.json"),
  JSON.stringify([
    {
      id: "https://gitlab.example.com",
      name: "TSE-GIT",
      baseUrl: "https://gitlab.example.com",
      useBasicAuth: false,
    },
    {
      id: "https://gitlab.dev.local",
      name: "DEV-GIT",
      baseUrl: "https://gitlab.dev.local",
      useBasicAuth: false,
    },
  ])
);
const envPath = path.join(tempHome, "env-test.yaml");
fs.writeFileSync(envPath, "", "utf-8");

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const calls: Array<{ url: string; init?: RequestInit }> = [];
globalThis.fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
  calls.push({ url, init });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let capturedLogs = "";
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  capturedLogs += `${args.map((item) => String(item)).join(" ")}\n`;
};

const program = new Command();
configureGitSyncCommand(program);
process.argv = ["node", "cli.ts", "git-sync", "--env-file", envPath];
await program.parseAsync(["node", "cli.ts", "git-sync", "--env-file", envPath]);

const noAuthTseGit =
  capturedLogs.includes("Não há autenticação configurada para TSE-GIT") ||
  capturedLogs.includes("No authentication configured for TSE-GIT");
assert.ok(noAuthTseGit, "Deve avisar quando não há autenticação no servidor TSE-GIT");
const noAuthDevGit =
  capturedLogs.includes("Não há autenticação configurada para DEV-GIT") ||
  capturedLogs.includes("No authentication configured for DEV-GIT");
assert.ok(noAuthDevGit, "Deve avisar quando não há autenticação no servidor DEV-GIT");
const noValidServer =
  capturedLogs.includes("Nenhum servidor com autenticação válida") ||
  capturedLogs.includes("No server with valid authentication");
assert.ok(noValidServer, "Deve informar quando nenhum servidor possui autenticação válida");
assert.strictEqual(calls.length, 0, "Não deve chamar API sem autenticação");

console.log = originalLog;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
os.homedir = originalHomedir;
process.argv = originalArgv;

console.log("git_sync_auth_guard_test: OK");
