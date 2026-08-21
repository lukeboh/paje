import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

// Regressão: um servidor recém-cadastrado durante o próprio `git-sync` (sem
// nenhum servidor configurado ainda) era salvo em git-servers.json assim que
// nome/URL eram informados — antes do bootstrap de credencial (chave
// SSH/token) terminar de verdade. Se esse bootstrap falhasse/fosse
// cancelado (aqui: senha vazia), o fluxo seguia direto pra loadTree(), que só
// avisaria "sem autenticação" de forma genérica lá dentro, em vez de barrar
// a sincronização explicitamente logo ali. Cobre o caminho de cadastro
// rápido via flags de CLI (--server-name/--base-url), o mesmo já coberto
// (no caminho de sucesso) por git_sync_quick_register_bootstrap_test.ts.

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalArgv = process.argv;
const originalPrompt = inquirer.prompt;
const originalConsoleLog = console.log;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-registration-incomplete-"));
process.env.HOME = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(serversPath, "[]", "utf-8");

const calls: Array<{ url: string; method?: string }> = [];
const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  // Só intercepta chamadas http(s) de verdade (o servidor GitLab falso) —
  // outras coisas no processo (ex.: um data: URI de um blob wasm carregado
  // preguiçosamente por alguma dependência) não têm nada a ver com este
  // teste e devem passar direto pro fetch original.
  if (typeof url !== "string" || !url.startsWith("http")) {
    return originalFetch(url as unknown as string, init);
  }
  calls.push({ url, method: init?.method });
  throw new Error(`Nenhuma chamada de rede era esperada, mas recebeu: ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

// Senha vazia simula o usuário cancelando/não completando o bootstrap —
// storeSshKeyOnly detecta isso (`!resolvedUsername || !basicAuthPassword`)
// e retorna limpo, sem nunca chamar ensureGitLabPersonalAccessToken (daí
// nenhuma chamada de rede acontecer nesse teste inteiro).
let promptCount = 0;
inquirer.prompt = (async () => {
  promptCount += 1;
  return { password: "" };
}) as unknown as typeof inquirer.prompt;

const logLines: string[] = [];
console.log = ((...args: unknown[]) => {
  logLines.push(args.map(String).join(" "));
}) as typeof console.log;

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const program = new Command();
configureGitSyncCommand(program);
process.argv = [
  "node",
  "cli.ts",
  "git-sync",
  "--server-name",
  "Incompleto-GitLab",
  "--base-url",
  "https://git.incompleto.example.com",
  "--use-basic-auth",
  "--username",
  "usuario",
  "--no-summary",
];
await program.parseAsync(process.argv);

assert.strictEqual(calls.length, 0, "Nenhuma chamada de API deve acontecer — nem de criação de token, nem de listagem de grupos/projetos");

// A pista real de que o bloqueio funcionou: a senha só é pedida UMA vez (no
// bootstrap do cadastro). Sem o bloqueio, o fluxo antigo seguia direto pra
// loadTree(), que tentaria o mesmo bootstrap de novo por dentro do
// onMissingCredentials — pedindo a senha uma segunda vez.
assert.strictEqual(
  promptCount,
  1,
  "A senha deve ser pedida apenas uma vez — sem o bloqueio, o fluxo seguiria pra loadTree() e pediria de novo"
);

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{
  baseUrl: string;
  token?: string;
}>;
assert.strictEqual(serverData.length, 1, "O servidor ainda deve ficar salvo (mesmo incompleto) para o próximo bootstrap automático");
assert.strictEqual(serverData[0].baseUrl, "https://git.incompleto.example.com");
assert.strictEqual(serverData[0].token, undefined, "Sem token — o bootstrap não completou");

assert.ok(
  logLines.some((line) => line.includes("Incompleto-GitLab")),
  "Deve avisar claramente que o cadastro deste servidor não foi concluído"
);

inquirer.prompt = originalPrompt;
console.log = originalConsoleLog;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.argv = originalArgv;

console.log("git_sync_registration_incomplete_test: OK");
