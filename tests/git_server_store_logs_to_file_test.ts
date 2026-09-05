import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regressão: o comando git-server-store (registro/edição de servidores,
// geração de chave SSH, criação/validação de token) usava apenas
// session.showMessage() (modal efêmero da TUI) ou console.log como "logger"
// — nenhuma dessas mensagens chegava ao arquivo de log persistente
// (~/.paje/logs/git-sync-<data>.log), ao contrário de tudo que passa por
// git-sync. Isso deixava o fluxo inteiro de cadastro de servidor (e
// principalmente as falhas nele) impossível de diagnosticar depois, só
// pelo log. Este teste cobre o caminho mais simples de storeSshKeyOnly
// (--use-basic-auth com um token já existente e válido) e confirma que a
// mensagem de "token válido/reutilizado" chega ao arquivo de log.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-server-store-log-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
fs.writeFileSync(
  path.join(pajeDir, "git-servers.json"),
  JSON.stringify([
    {
      id: "https://gitlab.example.com",
      name: "GitLab-Test",
      baseUrl: "https://gitlab.example.com",
      token: "glpat-existing",
    },
  ]),
  "utf-8"
);

const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.endsWith("/api/v4/personal_access_tokens/self")) {
    return new Response(
      JSON.stringify({ active: true, expires_at: "2099-01-01", scopes: ["read_api"] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  throw new Error(`URL inesperada no teste: ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

try {
  const { configureSshKeyStoreCommand } = await import("../src/modules/git/gitCommand.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");

  const program = new Command();
  configureSshKeyStoreCommand(program);
  process.argv = [
    "node",
    "cli.ts",
    "git-server-store",
    "--server-name",
    "GitLab-Test",
    "--base-url",
    "https://gitlab.example.com",
    "--server-type",
    "gitlab",
    "--use-basic-auth",
    "--username",
    "usuario",
    "--password",
    "segredo",
  ];
  await program.parseAsync(process.argv);

  const { logsDir } = resolvePajePaths();
  const today = new Date().toISOString().slice(0, 10);
  const logFilePath = path.join(logsDir, `git-sync-${today}.log`);
  assert.ok(fs.existsSync(logFilePath), `Arquivo de log deveria existir em ${logFilePath}`);
  const logContent = fs.readFileSync(logFilePath, "utf-8");
  assert.ok(
    logContent.includes("gitlab.example.com") || logContent.includes("Token"),
    `O arquivo de log deveria conter mensagens do fluxo de git-server-store. Conteúdo:\n${logContent}`
  );
  const reuseLogged =
    logContent.includes("Reutilizando token existente") || logContent.includes("Reusing existing token");
  assert.ok(reuseLogged, "Deve registrar no arquivo de log a reutilização do token existente e válido");
} finally {
  globalThis.fetch = originalFetch as typeof fetch;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.argv = originalArgv;
}

console.log("git_server_store_logs_to_file_test: OK");
