import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

// Regressão: quando o host já tem uma associação SSH válida em
// ~/.ssh/config (a chave já foi gerada E já está registrada no servidor —
// é exatamente o que "Tenho acesso SSH" pressupõe), storeSshKeyOnly() não
// deve tentar gerar/reaproveitar chave, sondar a porta 22, pedir senha nem
// fazer login web para "registrar" uma chave que já está lá. Antes desta
// correção, esse fluxo rodava incondicionalmente mesmo com SSH já pronto —
// o que falha (e pede uma senha que talvez nem exista, em contas via SSO)
// contra qualquer servidor cujo login não seja o formulário LDAP padrão do
// GitLab. Só o token (para a API REST) deve continuar sendo verificado.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalPrompt = inquirer.prompt;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-ssh-already-configured-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const sshDir = path.join(tempHome, ".ssh");
fs.mkdirSync(sshDir, { recursive: true });
const identityPath = path.join(sshDir, "id_existing");
fs.writeFileSync(identityPath, "PRIVATE-KEY-ALREADY-REGISTERED-ON-SERVER");
fs.writeFileSync(
  path.join(sshDir, "config"),
  `Host gitlab.example.com\n  HostName gitlab.example.com\n  User git\n  IdentityFile ${identityPath}\n  IdentitiesOnly yes\n`
);
fs.writeFileSync(path.join(sshDir, "known_hosts"), "gitlab.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKey\n");

const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
fs.writeFileSync(
  path.join(pajeDir, "git-servers.json"),
  JSON.stringify([
    {
      id: "https://gitlab.example.com",
      name: "GitLab-SSH-Ready",
      baseUrl: "https://gitlab.example.com",
      token: "glpat-existing-and-valid",
    },
  ]),
  "utf-8"
);

// Only the token-validation endpoint is mocked. Any request touching the
// SSH-key web-registration flow (/users/sign_in, /users/auth/ldapmain/
// callback, /-/user_settings/ssh_keys) throws — that's how the test catches
// a regression that re-runs that flow when it shouldn't.
const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  if (url.endsWith("/api/v4/personal_access_tokens/self")) {
    return new Response(
      JSON.stringify({ active: true, expires_at: "2099-01-01", scopes: ["read_api"] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  throw new Error(`URL inesperada no teste (fluxo de SSH não deveria rodar): ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

// Any interactive prompt (password included) is a regression here — SSH is
// already fully configured, and a valid token already exists, so nothing
// should ever need to ask the user anything.
let promptCallCount = 0;
inquirer.prompt = (async () => {
  promptCallCount += 1;
  throw new Error("Nenhum prompt interativo era esperado neste cenário");
}) as unknown as typeof inquirer.prompt;

let capturedLogs = "";
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  capturedLogs += `${args.map((item) => String(item)).join(" ")}\n`;
};

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
    "GitLab-SSH-Ready",
    "--base-url",
    "https://gitlab.example.com",
    "--server-type",
    "gitlab",
    "--username",
    "usuario",
  ];
  await program.parseAsync(process.argv);

  assert.strictEqual(promptCallCount, 0, "Não deveria ter pedido nada ao usuário (nem senha)");

  const { logsDir } = resolvePajePaths();
  const today = new Date().toISOString().slice(0, 10);
  const logContent = fs.readFileSync(path.join(logsDir, `git-sync-${today}.log`), "utf-8");
  const skippedKeySetup =
    logContent.includes("já tem uma chave SSH associada") || logContent.includes("already has an SSH key associated");
  assert.ok(skippedKeySetup, `Deveria registrar que pulou a geração/registro de chave. Log:\n${logContent}`);

  const serverData = JSON.parse(
    fs.readFileSync(path.join(pajeDir, "git-servers.json"), "utf-8")
  ) as Array<{ token?: string }>;
  assert.strictEqual(
    serverData[0]?.token,
    "glpat-existing-and-valid",
    "Deve manter o token já existente e válido, sem tentar criar um novo"
  );
} finally {
  console.log = originalLog;
  globalThis.fetch = originalFetch as typeof fetch;
  inquirer.prompt = originalPrompt;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.argv = originalArgv;
}

console.log("git_server_store_ssh_already_configured_test: OK");
