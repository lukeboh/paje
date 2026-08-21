import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderRepositoryTree } from "../src/modules/git/tui.app.js";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { runGit } from "../src/modules/git/parallelSync.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Funcionalidade coberta: renomear branch (local + remoto) a partir do
// Ctrl+B existente — nova opção "✎ Renomear branch atual" ao lado de "+
// Criar nova branch", usando repositório git real (não mockado) porque o
// que está sendo testado é a interação real local/remoto (git branch -m,
// push -u, push --delete).

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-branch-rename-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-branch-rename-"));

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

const repoPath = path.join(tmpDir, "repo");
await runGit(["clone", bareRemotePath, repoPath]);
await runGit(["-C", repoPath, "config", "user.email", "test@example.com"]);
await runGit(["-C", repoPath, "config", "user.name", "Test User"]);
await runGit(["-C", repoPath, "checkout", "-b", "feature-old"]);
await runGit(["-C", repoPath, "push", "-u", "origin", "feature-old"]);

const nodes: GitLabTreeNode[] = [
  {
    id: "project-1",
    type: "project",
    label: "repo",
    selected: false,
    localPath: repoPath,
    project: {
      id: 1,
      name: "repo",
      path_with_namespace: "grupo/repo",
      ssh_url_to_repo: `file://${bareRemotePath}`,
      http_url_to_repo: `file://${bareRemotePath}`,
      default_branch: "feature-old",
    },
  },
];

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
const treePromise = renderRepositoryTree(nodes, () => undefined, session, {}).then((result) => {
  resolvedResult = result;
  return result;
});

await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 150));

const lastFrame = (): string => stripAnsi(tty.getLastFrame());

// Ctrl+B abre o modal de branch para o item destacado (o único da árvore).
await tty.press(KEYS.ctrlB);
await tty.waitForOutput(
  (out) => out.includes("feature-old") && (out.includes("Renomear branch atual") || out.includes("Rename current branch")),
  3000
);

// Desce até a última opção selecionável — clampSelectedIndex garante que
// pressionar para baixo mais vezes que existem itens só para no último
// ("✎ Renomear branch atual" é sempre o último quando há uma branch atual).
for (let i = 0; i < 10; i += 1) {
  await tty.press(KEYS.arrowDown);
}
const beforeEnter = lastFrame();
assert.ok(
  beforeEnter.includes("Renomear branch atual") || beforeEnter.includes("Rename current branch"),
  "Deve ter a opção de renomear na lista"
);

await tty.press(KEYS.enter);
const renameInputFrame = lastFrame();
assert.ok(renameInputFrame.includes("feature-old"), "Campo de novo nome deve iniciar preenchido com o nome atual");

// Apaga o nome atual e digita o novo.
for (let i = 0; i < "feature-old".length; i += 1) {
  await tty.press(KEYS.ctrlH);
}
for (const char of "feature-new") {
  await tty.press(char);
}
await tty.press(KEYS.enter);
await tty.waitForOutput(
  (out) => out.includes("Branch renomeada") || out.includes("Branch renamed"),
  5000
);

const afterRename = lastFrame();
assert.ok(
  afterRename.includes("feature-new") ||
    afterRename.includes("Branch renomeada") ||
    afterRename.includes("Branch renamed"),
  "Log deve confirmar a renomeação"
);

const allLocal = await runGit(["-C", repoPath, "branch", "--list"]);
const localBranches = await runGit(["-C", repoPath, "branch", "--list", "feature-old", "feature-new"]);
assert.ok(!localBranches.includes("feature-old"), "feature-old não deve mais existir localmente");
assert.ok(localBranches.includes("feature-new"), "feature-new deve existir localmente");

const remoteBranches = await runGit(["-C", bareRemotePath, "branch", "--list", "feature-old", "feature-new"]);
assert.ok(!remoteBranches.includes("feature-old"), "feature-old não deve mais existir no remoto");
assert.ok(remoteBranches.includes("feature-new"), "feature-new deve existir no remoto");

await tty.press(KEYS.escape);
const result = await treePromise;
assert.equal(result.confirmed, false, "Esc sem modal aberto deve cancelar a tela normalmente");
session.destroy();
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;

console.log("tui_branch_rename_test: OK");
