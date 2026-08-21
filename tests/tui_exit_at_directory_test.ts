import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Funcionalidade coberta: Ctrl+Q ("sair no diretório do repositório
// destacado") — opera no nó destacado (não em massa, diferente de
// Ctrl+K/Ctrl+R), exige um projeto com clone git real, pede confirmação e,
// ao confirmar, grava o path em ~/.paje/cd-target (consumido depois por uma
// função de shell instalada pelo instalador) e resolve a tela com
// exitToDirectory setado. HOME é sobrescrito para um diretório temporário
// (mesmo padrão de tests/git_sync_cache_refresh_test.ts) para verificar o
// arquivo gravado sem tocar no ~/.paje real.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-exit-dir-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { renderRepositoryTree } = await import("../src/modules/git/tui.app.js");
const { createTuiSession } = await import("../src/modules/git/tuiSession.js");
const { runGit } = await import("../src/modules/git/parallelSync.js");
const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
const { createFakeTTY, KEYS, stripAnsi, waitNextTick } = await import("./tui_test_utils.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-exit-dir-repos-"));

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

const repoValido = path.join(tmpDir, "repo-valido");
await runGit(["clone", bareRemotePath, repoValido]);

const repoSemClone = path.join(tmpDir, "repo-sem-clone");
fs.mkdirSync(repoSemClone, { recursive: true });

// Repositório clonado de verdade DENTRO de uma pasta de grupo — usado pra
// testar Ctrl+Q num nó de grupo (pasta que só contém subpastas/repos, sem
// ser ela mesma um repositório): o grupo não tem localPath próprio, então a
// resolução precisa derivar a pasta a partir deste descendente.
const grupoComRepoDir = path.join(tmpDir, "grupo-com-repo");
const repoAninhado = path.join(grupoComRepoDir, "repo-aninhado");
await runGit(["clone", bareRemotePath, repoAninhado]);

const nodes = [
  {
    id: "group-1",
    type: "group" as const,
    label: "grupo",
    selected: false,
    children: [],
  },
  {
    id: "project-1",
    type: "project" as const,
    label: "repo-sem-clone",
    selected: false,
    localPath: repoSemClone,
    project: {
      id: 1,
      name: "repo-sem-clone",
      path_with_namespace: "grupo/repo-sem-clone",
      ssh_url_to_repo: `file://${bareRemotePath}`,
      http_url_to_repo: `file://${bareRemotePath}`,
      default_branch: "main",
    },
  },
  {
    id: "project-2",
    type: "project" as const,
    label: "repo-valido",
    selected: false,
    localPath: repoValido,
    project: {
      id: 2,
      name: "repo-valido",
      path_with_namespace: "grupo/repo-valido",
      ssh_url_to_repo: `file://${bareRemotePath}`,
      http_url_to_repo: `file://${bareRemotePath}`,
      default_branch: "main",
    },
  },
  {
    id: "group-2",
    type: "group" as const,
    label: "grupo-com-repo",
    selected: false,
    excludePattern: "grupo-com-repo/**",
    children: [
      {
        id: "project-3",
        type: "project" as const,
        label: "repo-aninhado",
        selected: false,
        localPath: repoAninhado,
        project: {
          id: 3,
          name: "repo-aninhado",
          path_with_namespace: "grupo-com-repo/repo-aninhado",
          ssh_url_to_repo: `file://${bareRemotePath}`,
          http_url_to_repo: `file://${bareRemotePath}`,
          default_branch: "main",
        },
      },
    ],
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

let resolvedResult: { confirmed: boolean; exitToDirectory?: string } | null = null;
const treePromise = renderRepositoryTree(nodes, () => undefined, session, {}).then((result) => {
  resolvedResult = result;
  return result;
});

await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 150));

const lastFrame = (): string => stripAnsi(tty.getLastFrame());
const paths = resolvePajePaths();

// --- Cursor no grupo (índice 0): Ctrl+Q deve avisar e não abrir modal ---
await tty.press(KEYS.ctrlQ);
await new Promise((resolve) => setTimeout(resolve, 100));
const afterGroupAttempt = lastFrame();
assert.ok(
  afterGroupAttempt.includes("Selecione um repositório já clonado ou uma pasta existente") ||
    afterGroupAttempt.includes("Select an already cloned repository"),
  "Ctrl+Q num grupo deve avisar, não abrir modal"
);
assert.ok(
  !afterGroupAttempt.includes("Sair e mudar de diretório") && !afterGroupAttempt.includes("Exit and change directory"),
  "Nenhum modal de saída deve abrir para um nó de grupo"
);
assert.ok(!fs.existsSync(paths.cdTargetFile), "cd-target não deve ser criado por uma tentativa inválida");

// --- Cursor no projeto sem clone real (índice 1): mesmo aviso ---
await tty.press(KEYS.arrowDown);
await tty.press(KEYS.ctrlQ);
await new Promise((resolve) => setTimeout(resolve, 100));
const afterNoCloneAttempt = lastFrame();
assert.ok(
  afterNoCloneAttempt.includes("Selecione um repositório já clonado ou uma pasta existente") ||
    afterNoCloneAttempt.includes("Select an already cloned repository"),
  "Ctrl+Q num projeto sem .git real deve avisar, não abrir modal"
);
assert.ok(!fs.existsSync(paths.cdTargetFile), "cd-target ainda não deve existir");

// --- Cursor no projeto com clone real (índice 2): abre confirmação ---
await tty.press(KEYS.arrowDown);
await tty.press(KEYS.ctrlQ);
await new Promise((resolve) => setTimeout(resolve, 100));
const confirmFrame = lastFrame();
assert.ok(
  confirmFrame.includes("Sair e mudar de diretório") || confirmFrame.includes("Exit and change directory"),
  "Ctrl+Q num projeto com clone real deve pedir confirmação"
);
const containsPath = (frame: string, targetPath: string): boolean => {
  const cleanFrame = frame.replace(/[^a-zA-Z0-9_:\\\/\.\-]/g, "").toLowerCase();
  const cleanTarget = targetPath.replace(/[^a-zA-Z0-9_:\\\/\.\-]/g, "").toLowerCase();
  return cleanFrame.includes(cleanTarget);
};

assert.ok(containsPath(confirmFrame, repoValido), "Confirmação deve citar o path do repositório destacado");

// --- Esc cancela: tela continua aberta, nada é gravado ---
await tty.press(KEYS.escape);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(resolvedResult, null, "Esc no modal de confirmação não deve resolver a tela");
assert.ok(!fs.existsSync(paths.cdTargetFile), "Esc não deve gravar cd-target");

// --- Cursor no grupo com repositório aninhado (índice 3): também abre
// confirmação, mesmo sem ser ele mesmo um clone git — deriva a pasta a
// partir do descendente ---
await tty.press(KEYS.arrowDown);
await tty.press(KEYS.ctrlQ);
await new Promise((resolve) => setTimeout(resolve, 100));
const groupConfirmFrame = lastFrame();
assert.ok(
  groupConfirmFrame.includes("Sair e mudar de diretório") || groupConfirmFrame.includes("Exit and change directory"),
  "Ctrl+Q num grupo com repositório aninhado deve pedir confirmação, não avisar"
);
assert.ok(
  containsPath(groupConfirmFrame, grupoComRepoDir),
  "Confirmação deve citar a pasta do grupo derivada do repositório aninhado"
);
await tty.press(KEYS.escape);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(resolvedResult, null, "Esc no modal do grupo também não deve resolver a tela");
assert.ok(!fs.existsSync(paths.cdTargetFile), "Esc no grupo não deve gravar cd-target");

// Volta o cursor pro repositório válido (índice 2) pra continuar o fluxo de confirmação abaixo.
await tty.press(KEYS.arrowUp);

// --- Reabre e confirma: grava cd-target e resolve com exitToDirectory ---
await tty.press(KEYS.ctrlQ);
await new Promise((resolve) => setTimeout(resolve, 100));
await tty.press(KEYS.enter);
await new Promise((resolve) => setTimeout(resolve, 200));

const result = await treePromise;
assert.equal(result.confirmed, true, "Confirmar deve resolver a tela com confirmed=true");
assert.equal(result.exitToDirectory, repoValido, "exitToDirectory deve ser o path do repositório destacado");
assert.ok(fs.existsSync(paths.cdTargetFile), "cd-target deve ter sido gravado");
assert.equal(fs.readFileSync(paths.cdTargetFile, "utf-8"), repoValido, "cd-target deve conter o path exato");

session.destroy();
process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;

console.log("tui_exit_at_directory_test: OK");
