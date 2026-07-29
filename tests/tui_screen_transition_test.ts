import assert from "node:assert/strict";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { renderLoadingScreen, renderRepositoryTree } from "../src/modules/git/tui.app.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressão coberta: a tela de "carregando repositórios" (renderLoadingScreen),
// um prompt aninhado no meio do carregamento (ex.: autenticação básica) e a
// árvore de repositórios (renderRepositoryTree) precisam compartilhar a mesma
// instância persistente de Ink (via TuiSession.mountScreen/releaseScreen) —
// nenhuma transição entre elas pode emitir um clear de tela inteira, e
// stop()/release() de uma tela já substituída por outra deve ser no-op (não
// pode apagar a tela seguinte que já assumiu).

const countClears = (output: string): number => output.split("[2J").length - 1;

const makeProject = (id: number, name: string): GitLabTreeNode => ({
  id: `project-${id}`,
  type: "project",
  label: name,
  selected: false,
  project: {
    id,
    name,
    path_with_namespace: `grupo/${name}`,
    ssh_url_to_repo: `git@git.exemplo.com:grupo/${name}.git`,
    http_url_to_repo: `https://git.exemplo.com/grupo/${name}.git`,
  },
});

const nodes: GitLabTreeNode[] = [
  {
    id: "group-1",
    type: "group",
    label: "grupo",
    selected: false,
    children: [makeProject(1, "repo-1"), makeProject(2, "repo-2")],
  },
];

const tty = createFakeTTY(80, 24);
const session = createTuiSession("test", {
  renderOptions: { stdout: tty.stdout, stdin: tty.stdin, exitOnCtrlC: false, patchConsole: false },
});

// 1. Tela de carregamento monta.
const loadingHandle = renderLoadingScreen({ message: "Carregando repositórios..." }, session);
await tty.waitForOutput((out) => stripAnsi(out).includes("Carregando repositórios"));
assert.equal(countClears(tty.getOutput()), 0, "Montar a tela de carregamento não pode emitir clear de tela inteira");

// 2. Um prompt aninhado (ex.: autenticação básica) substitui a tela de
// carregamento antes que loadingHandle.stop() seja chamado — como acontece
// hoje quando core.loadTree precisa de senha no meio do carregamento.
const authPromise = session.promptInput({ title: "Auth", message: "Password" });
await tty.waitForOutput((out) => stripAnsi(out).includes("Password"));
assert.equal(countClears(tty.getOutput()), 0, "Substituir o loading pelo prompt de auth não pode emitir clear de tela inteira");

await tty.press(KEYS.enter);
await authPromise;

// 3. loadingHandle.stop() roda DEPOIS que o prompt aninhado já resolveu (como
// no fluxo real, dentro do .finally() de core.loadTree) — deve ser um no-op,
// já que o prompt de auth já liberou a própria tela.
loadingHandle.stop();
await waitNextTick();

// 4. A árvore monta em seguida.
const treePromise = renderRepositoryTree(nodes, () => undefined, session, {});
await tty.waitForOutput((out) => stripAnsi(out).includes("repo-1"));

assert.equal(countClears(tty.getOutput()), 0, "Nenhuma transição de tela pode emitir clear de tela inteira (ESC[2J)");
assert.ok(stripAnsi(tty.getLastFrame()).includes("repo-1"), "A árvore deve estar visível após a cadeia de transições");

await tty.press(KEYS.escape);
await treePromise;

session.destroy();

console.log("tui_screen_transition_test: OK");
