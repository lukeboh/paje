import assert from "node:assert/strict";
import { GitHubApi } from "../src/modules/git/githubApi.js";

// Regressão: erros HTTP do GitHubApi só carregavam o status embutido na
// mensagem como texto ("GitHub API 401: ..."), diferente do GitLabApi (que já
// anexa `error.details.status`). Sem um jeito estruturado de checar o status,
// o código de sincronização não conseguia distinguir "token inválido/expirado"
// (401/403) de um erro de rede genérico para disparar a cura automática.

const originalFetch = globalThis.fetch;

globalThis.fetch = (async () =>
  new Response("Bad credentials", { status: 401 })) as typeof fetch;

const api = new GitHubApi({ baseUrl: "https://github.com", token: "ghp-invalido" });

try {
  await api.getAuthenticatedUser();
  assert.fail("Deveria lançar um erro para uma resposta 401");
} catch (error) {
  assert.ok(error instanceof Error, "Deve lançar um Error");
  assert.strictEqual((error as Error & { status?: number }).status, 401, "O erro deve carregar o status HTTP");
  assert.ok(error.message.includes("401"), "A mensagem também deve mencionar o status, por compatibilidade");
}

globalThis.fetch = originalFetch;

console.log("github_api_error_status_test: OK");
