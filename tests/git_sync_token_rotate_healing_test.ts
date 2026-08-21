import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";

// Regressão: um servidor com um token já salvo, mas que o GitLab rejeita
// (401/403 — expirado ou revogado), costumava só ser pulado silenciosamente
// (mensagem genérica de "sem autenticação", igual a um servidor que nunca
// teve token nenhum). Agora, quando o token existente falha, o PAJÉ tenta
// rotacioná-lo primeiro — sem precisar de senha nenhuma — e só recorre ao
// bootstrap por senha se a rotação também falhar (token de fato revogado,
// não só expirado).

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalPrompt = inquirer.prompt;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-rotate-heal-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
const serversPath = path.join(pajeDir, "git-servers.json");
fs.writeFileSync(
  serversPath,
  JSON.stringify([
    {
      id: "https://git.rotate.example.com",
      name: "Rotate-GitLab",
      baseUrl: "https://git.rotate.example.com",
      username: "usuario",
      token: "glpat-expired-old",
    },
  ]),
  "utf-8"
);

const makeHeaders = (extra?: Record<string, string>) => ({
  "content-type": "application/json",
  ...(extra ?? {}),
});
const makeResponse = (body: string, status: number, headers?: Record<string, string>): Response =>
  new Response(body, { status, headers: headers ?? {} });

const calls: Array<{ url: string; method?: string; token?: string | null }> = [];

const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const token = headers["PRIVATE-TOKEN"] ?? null;
  calls.push({ url, method: init?.method, token });

  if (url.endsWith("/api/v4/personal_access_tokens/self/rotate") && init?.method === "POST") {
    // Rotating the OLD token succeeds and returns a brand-new one.
    return makeResponse(
      JSON.stringify({ token: "glpat-rotated-new", name: "paje", scopes: ["read_api"] }),
      200,
      makeHeaders()
    );
  }
  if (url.includes("/api/v4/groups") || url.includes("/api/v4/projects")) {
    if (token === "glpat-expired-old") {
      return makeResponse("Unauthorized", 401, makeHeaders());
    }
    return makeResponse("[]", 200, makeHeaders());
  }
  throw new Error(`URL inesperada: ${url} (token=${token})`);
};

globalThis.fetch = mockFetch as typeof fetch;

let passwordPromptCount = 0;
inquirer.prompt = (async () => {
  passwordPromptCount += 1;
  return { password: "não-deveria-ser-usada" };
}) as unknown as typeof inquirer.prompt;

const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

const program = new Command();
configureGitSyncCommand(program);
process.argv = ["node", "cli.ts", "git-sync", "--no-summary"];
await program.parseAsync(process.argv);

assert.strictEqual(passwordPromptCount, 0, "A rotação silenciosa não deve pedir senha nenhuma");

const rotateCalls = calls.filter((call) => call.url.endsWith("/personal_access_tokens/self/rotate"));
assert.strictEqual(rotateCalls.length, 1, "Deve tentar rotacionar o token existente");
assert.strictEqual(rotateCalls[0].token, "glpat-expired-old", "A rotação deve usar o token antigo, não o novo");

const listCallsWithNewToken = calls.filter(
  (call) => call.url.includes("/api/v4/groups") && call.token === "glpat-rotated-new"
);
assert.strictEqual(listCallsWithNewToken.length, 1, "Deve tentar listar de novo com o token rotacionado");

const serverData = JSON.parse(fs.readFileSync(serversPath, "utf-8")) as Array<{ token?: string }>;
assert.strictEqual(serverData[0].token, "glpat-rotated-new", "O token rotacionado deve ser persistido");

inquirer.prompt = originalPrompt;
globalThis.fetch = originalFetch as typeof fetch;
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;
process.argv = originalArgv;

console.log("git_sync_token_rotate_healing_test: OK");
