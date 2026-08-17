import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "../src/modules/git/parallelSync.js";
import {
  branchExistsRemoteOrLocal,
  checkBranchAvailability,
  checkoutDefaultBranchBulk,
  checkoutOrCreateBranch,
  checkoutOrCreateBranchBulk,
  renameBranch,
} from "../src/modules/git/core/gitBranchService.js";

// Cobre as funções novas de operação em massa (checkout/criar, voltar ao
// padrão) e renomear branch (local + remoto), usando repositórios git reais
// e um "remoto" local (bare) — não um binário git falso — porque o que está
// sendo testado é justamente a interação real entre local e remoto (push,
// delete, tracking), não só a sequência de comandos chamados.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-branch-bulk-"));

const bareRemotePath = path.join(tempDir, "remote.git");
await runGit(["init", "--bare", "-b", "main", bareRemotePath]);

const initRepoWithRemote = async (name: string): Promise<string> => {
  const repoPath = path.join(tempDir, name);
  await runGit(["clone", bareRemotePath, repoPath]);
  await runGit(["-C", repoPath, "config", "user.email", "test@example.com"]);
  await runGit(["-C", repoPath, "config", "user.name", "Test User"]);
  return repoPath;
};

// O primeiro clone precisa criar o commit inicial e empurrar main antes dos
// demais clonarem — um bare recém-criado não tem nenhum branch ainda.
const seedRepoPath = path.join(tempDir, "seed");
await runGit(["-C", tempDir, "init", "seed"]);
await runGit(["-C", seedRepoPath, "config", "user.email", "test@example.com"]);
await runGit(["-C", seedRepoPath, "config", "user.name", "Test User"]);
fs.writeFileSync(path.join(seedRepoPath, "README.md"), "seed");
await runGit(["-C", seedRepoPath, "add", "."]);
await runGit(["-C", seedRepoPath, "commit", "-m", "init"]);
await runGit(["-C", seedRepoPath, "branch", "-M", "main"]);
await runGit(["-C", seedRepoPath, "remote", "add", "origin", bareRemotePath]);
await runGit(["-C", seedRepoPath, "push", "-u", "origin", "main"]);

const repoA = await initRepoWithRemote("repoA");
const repoB = await initRepoWithRemote("repoB");

// =============================================================================
// branchExistsRemoteOrLocal / checkoutOrCreateBranch
// =============================================================================

assert.equal(await branchExistsRemoteOrLocal(repoA, "main"), true, "main deve existir (clonado do remoto)");
assert.equal(await branchExistsRemoteOrLocal(repoA, "does-not-exist"), false, "branch inexistente não deve ser encontrada");

{
  const result = await checkoutOrCreateBranch(repoA, "does-not-exist", { createIfMissing: false });
  assert.equal(result.action, "skipped", "sem createIfMissing, branch ausente é só pulada, não lança erro");
}

{
  const result = await checkoutOrCreateBranch(repoA, "feature-created", { createIfMissing: true });
  assert.equal(result.action, "created", "com createIfMissing, cria a branch ausente");
  const branchOutput = await runGit(["-C", repoA, "branch", "--show-current"]);
  assert.equal(branchOutput.trim(), "feature-created", "deve estar na branch recém-criada");
  const remoteRefs = await runGit(["-C", bareRemotePath, "branch", "--list", "feature-created"]);
  assert.ok(remoteRefs.includes("feature-created"), "criar deve empurrar a branch para o remoto (createBranchAndPush)");
}

{
  await runGit(["-C", repoA, "checkout", "main"]);
  const result = await checkoutOrCreateBranch(repoA, "main", { createIfMissing: false });
  assert.equal(result.action, "checked-out", "branch existente é só trocada, não recriada");
}

// =============================================================================
// checkBranchAvailability
// =============================================================================

{
  const targets = [
    { targetPath: repoA, label: "repoA" },
    { targetPath: repoB, label: "repoB" },
  ];
  const { withBranch, withoutBranch } = await checkBranchAvailability(targets, "feature-created");
  assert.equal(withBranch.length, 1, "repoA já tem feature-created");
  assert.equal(withBranch[0].label, "repoA");
  assert.equal(withoutBranch.length, 1, "repoB ainda não tem feature-created");
  assert.equal(withoutBranch[0].label, "repoB");
}

// =============================================================================
// checkoutOrCreateBranchBulk — tally correto, um item falhando não derruba os outros
// =============================================================================

{
  const missingRepoPath = path.join(tempDir, "does-not-exist-dir");
  const targets = [
    { targetPath: repoA, label: "repoA" },
    { targetPath: repoB, label: "repoB" },
    { targetPath: missingRepoPath, label: "repo-inexistente" },
  ];
  const results = await checkoutOrCreateBranchBulk(targets, "feature-created", true);
  assert.equal(results.length, 3, "deve retornar um resultado por alvo, mesmo com falha");

  const byLabel = new Map(results.map((r) => [r.target.label, r]));
  assert.equal(byLabel.get("repoA")?.status, "checked-out", "repoA já tinha a branch: só troca");
  assert.equal(byLabel.get("repoB")?.status, "created", "repoB não tinha: cria (createIfMissing=true)");
  assert.equal(byLabel.get("repo-inexistente")?.status, "failed", "diretório inexistente deve falhar, não travar o lote");
  assert.ok(byLabel.get("repo-inexistente")?.message, "falha deve carregar a mensagem bruta do erro");
}

{
  // createIfMissing=false: repoB não tinha "feature-only-if-created" — deve
  // ser pulado (reason: branch-missing), não falhar nem criar.
  await runGit(["-C", repoA, "checkout", "-b", "feature-only-if-created"]);
  await runGit(["-C", repoA, "push", "-u", "origin", "feature-only-if-created"]);
  const targets = [{ targetPath: repoB, label: "repoB" }];
  const results = await checkoutOrCreateBranchBulk(targets, "feature-only-if-created", false);
  assert.equal(results[0].status, "skipped");
  assert.equal(results[0].reason, "branch-missing");
}

// =============================================================================
// checkoutDefaultBranchBulk — pula quem não tem default_branch conhecida
// =============================================================================

{
  const targets = [
    { targetPath: repoA, label: "repoA", defaultBranch: "main" },
    { targetPath: repoB, label: "repoB", defaultBranch: undefined },
  ];
  const results = await checkoutDefaultBranchBulk(targets);
  const byLabel = new Map(results.map((r) => [r.target.label, r]));
  assert.equal(byLabel.get("repoA")?.status, "checked-out");
  const branchOutput = await runGit(["-C", repoA, "branch", "--show-current"]);
  assert.equal(branchOutput.trim(), "main", "deve ter voltado para a branch padrão");
  assert.equal(byLabel.get("repoB")?.status, "skipped");
  assert.equal(byLabel.get("repoB")?.reason, "no-default-branch");
}

// =============================================================================
// renameBranch — local + remoto, e falha isolada do delete não derruba o resultado
// =============================================================================

{
  await runGit(["-C", repoA, "checkout", "-b", "old-name"]);
  await runGit(["-C", repoA, "push", "-u", "origin", "old-name"]);

  const result = await renameBranch(repoA, "old-name", "new-name", { hasRemote: true });
  assert.equal(result.remoteDeleteFailed, undefined, "delete do remoto deve funcionar normalmente aqui");

  const localBranches = await runGit(["-C", repoA, "branch", "--list", "old-name", "new-name"]);
  assert.ok(!localBranches.includes("old-name"), "old-name não deve mais existir localmente");
  assert.ok(localBranches.includes("new-name"), "new-name deve existir localmente");

  const remoteBranches = await runGit(["-C", bareRemotePath, "branch", "--list", "old-name", "new-name"]);
  assert.ok(!remoteBranches.includes("old-name"), "old-name não deve mais existir no remoto");
  assert.ok(remoteBranches.includes("new-name"), "new-name deve existir no remoto");

  const upstream = await runGit(["-C", repoA, "rev-parse", "--abbrev-ref", "new-name@{upstream}"]).catch(() => "");
  assert.equal(upstream.trim(), "origin/new-name", "new-name deve rastrear origin/new-name (push -u), não o remoto antigo");
}

{
  // Sem remoto: só renomeia local, nunca tenta git push.
  await runGit(["-C", seedRepoPath, "checkout", "-b", "local-only-old"]);
  await runGit(["-C", seedRepoPath, "remote", "remove", "origin"]);
  const result = await renameBranch(seedRepoPath, "local-only-old", "local-only-new", { hasRemote: false });
  assert.deepEqual(result, {}, "sem remoto, não deve reportar nada sobre delete remoto");
  const localBranches = await runGit(["-C", seedRepoPath, "branch", "--list", "local-only-new"]);
  assert.ok(localBranches.includes("local-only-new"), "rename local deve funcionar mesmo sem remoto configurado");
}

console.log("git_branch_bulk_test: OK");
