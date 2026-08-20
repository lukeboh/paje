import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderRepositoryTree } from "../src/modules/git/tui.app.js";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { runGit } from "../src/modules/git/parallelSync.js";
import { recomputeTreeSelection, toggleTreeNode } from "../src/modules/git/treeBuilder.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Funcionalidade coberta: Ctrl+K (checkout em massa, com opção de criar
// branch ausente) e Ctrl+R (voltar em massa para a branch padrão), usando
// repositórios git reais + um "remoto" local (bare) — a mesma convenção de
// tests/git_branch_bulk_test.ts, já que o que está sob teste é a interação
// real local/remoto.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-bulk-branch-ops-"));

const bareRemotePath = path.join(tmpDir, "remote.git");
await runGit(["init", "--bare", "-b", "main", bareRemotePath]);

const seedPath = path.join(tmpDir, "seed");
await runGit(["-C", tmpDir, "init", "seed"]);
await runGit(["-C", seedPath, "config", "user.email", "test@example.com"]);
await runGit(["-C", seedPath, "config", "user.name", "Test User"]);
fs.writeFileSync(path.join(seedPath, "README.md"), "seed");
await runGit(["-C", seedPath, "add", "."]);
await runGit(["-C", seedPath, "commit", "-m", "init"]);
await runGit(["-C", seedPath, "branch", "-M", "main"]);
await runGit(["-C", seedPath, "remote", "add", "origin", bareRemotePath]);
await runGit(["-C", seedPath, "push", "-u", "origin", "main"]);

const cloneRepo = async (name: string): Promise<string> => {
  const repoPath = path.join(tmpDir, name);
  await runGit(["clone", bareRemotePath, repoPath]);
  await runGit(["-C", repoPath, "config", "user.email", "test@example.com"]);
  await runGit(["-C", repoPath, "config", "user.name", "Test User"]);
  return repoPath;
};

const repoA = await cloneRepo("repoA");
const repoB = await cloneRepo("repoB");

// repoA já tem "feature-x" (local + remoto); repoB ainda não tem.
await runGit(["-C", repoA, "checkout", "-b", "feature-x"]);
await runGit(["-C", repoA, "push", "-u", "origin", "feature-x"]);
await runGit(["-C", repoA, "checkout", "main"]);

const makeNode = (id: string, label: string, localPath: string): GitLabTreeNode => ({
  id,
  type: "project",
  label,
  selected: false,
  localPath,
  project: {
    id: Number(id.replace(/\D/g, "")) || 1,
    name: label,
    path_with_namespace: `grupo/${label}`,
    ssh_url_to_repo: `file://${bareRemotePath}`,
    http_url_to_repo: `file://${bareRemotePath}`,
    default_branch: "main",
  },
});

const buildNodes = (): GitLabTreeNode[] => [makeNode("project-1", "repoA", repoA), makeNode("project-2", "repoB", repoB)];

const treeNodes = buildNodes();

const findNodeById = (list: GitLabTreeNode[], id: string): GitLabTreeNode | undefined => {
  for (const node of list) {
    if (node.id === id) {
      return node;
    }
    const found = node.children ? findNodeById(node.children, id) : undefined;
    if (found) {
      return found;
    }
  }
  return undefined;
};

// Mirrors gitCommand.ts's toggleById — renderRepositoryTree only reports
// which node id was toggled, the caller owns actually flipping .selected.
const onToggle = (id: string): void => {
  const node = findNodeById(treeNodes, id);
  if (!node) {
    return;
  }
  toggleTreeNode(node, !(node.selected ?? false));
  treeNodes.forEach((root) => recomputeTreeSelection(root));
};

const tty = createFakeTTY();
const session = createTuiSession("test", {
  renderOptions: {
    stdout: tty.stdout,
    stdin: tty.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  },
});

let resolvedResult: { confirmed: boolean } | null = null;
const treePromise = renderRepositoryTree(treeNodes, onToggle, session, {}).then((result) => {
  resolvedResult = result;
  return result;
});

await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 150));

const lastFrame = (): string => stripAnsi(tty.getLastFrame());

// --- Ctrl+K sem nada marcado: só avisa, não abre modal nenhum ---
await tty.press(KEYS.ctrlK);
await new Promise((resolve) => setTimeout(resolve, 100));
const afterNoSelection = lastFrame();
assert.ok(
  afterNoSelection.includes("Nenhum repositório marcado") || afterNoSelection.includes("No repositories marked"),
  "Ctrl+K sem seleção deve avisar, não abrir nenhum modal"
);
assert.ok(
  !afterNoSelection.includes("Checkout em massa") && !afterNoSelection.includes("Bulk checkout"),
  "Nenhum modal de checkout em massa deve abrir sem seleção"
);

// --- Marca os dois repositórios (Espaço em cada um) ---
await tty.press(" ");
await tty.press(KEYS.arrowDown);
await tty.press(" ");

// --- Ctrl+K: nome da branch, confirma criação onde falta (só local, sem push) ---
await tty.press(KEYS.ctrlK);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.ok(
  lastFrame().includes("Checkout em massa") || lastFrame().includes("Bulk checkout"),
  "Ctrl+K com itens marcados deve abrir o prompt de nome da branch"
);

for (const char of "feature-x") {
  await tty.press(char);
}
await tty.press(KEYS.enter);
await new Promise((resolve) => setTimeout(resolve, 200));

const confirmFrame = lastFrame();
assert.ok(
  confirmFrame.includes("feature-x") && (confirmFrame.includes("repoB") || confirmFrame.includes("1")),
  "Deve pedir confirmação pra criar a branch ausente em repoB"
);

await tty.press(KEYS.enter);
await new Promise((resolve) => setTimeout(resolve, 400));

// A árvore reflete o resultado direto na coluna de status assim que a
// operação termina (resolveRepoStatus por item, ver applyBulkResults) — mais
// confiável de checar aqui do que o painel de log, que é bem pequeno neste
// terminal falso e pode já ter rolado as linhas de confirmação para fora da
// área visível.
const afterBulkCheckout = lastFrame();
assert.ok(
  afterBulkCheckout.includes("repoA") && afterBulkCheckout.includes("feature-x"),
  "Árvore deve mostrar repoA já na branch feature-x"
);
assert.ok(
  afterBulkCheckout.includes("repoB") && afterBulkCheckout.includes("feature-x"),
  "Árvore deve mostrar repoB já na branch feature-x (recém-criada)"
);

const repoABranch = (await runGit(["-C", repoA, "branch", "--show-current"])).trim();
assert.equal(repoABranch, "feature-x", "repoA deve estar em feature-x");
const repoBBranch = (await runGit(["-C", repoB, "branch", "--show-current"])).trim();
assert.equal(repoBBranch, "feature-x", "repoB deve estar em feature-x (criada)");
// feature-x já estava no remoto por causa do push feito na configuração
// (linha 47, a partir de repoA) — a criação em massa em repoB não deve ter
// mandado nada pro remoto: sem upstream configurado ali é a prova direta de
// que nenhum "git push" rodou a partir de repoB.
const repoBUpstream = await runGit(["-C", repoB, "rev-parse", "--abbrev-ref", "feature-x@{upstream}"]).catch(
  () => ""
);
assert.equal(
  repoBUpstream.trim(),
  "",
  "checkout em massa com criação não deve configurar upstream nem enviar nada ao remoto a partir de repoB"
);

// --- Ctrl+R: volta os dois (ainda marcados) para a branch padrão (main) ---
await tty.press(KEYS.ctrlR);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.ok(
  lastFrame().includes("branch padrão") || lastFrame().includes("default branch"),
  "Ctrl+R deve pedir confirmação antes de voltar à branch padrão"
);
await tty.press(KEYS.enter);
await new Promise((resolve) => setTimeout(resolve, 400));

const repoABranchAfterReturn = (await runGit(["-C", repoA, "branch", "--show-current"])).trim();
assert.equal(repoABranchAfterReturn, "main", "repoA deve ter voltado para main");
const repoBBranchAfterReturn = (await runGit(["-C", repoB, "branch", "--show-current"])).trim();
assert.equal(repoBBranchAfterReturn, "main", "repoB deve ter voltado para main");

await tty.press(KEYS.escape);
const result = await treePromise;
assert.equal(result.confirmed, false, "Esc sem modal aberto deve cancelar a tela normalmente");
session.destroy();

console.log("tui_bulk_branch_ops_test: OK");
