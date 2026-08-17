import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderRepositoryTree } from "../src/modules/git/tui.app.js";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { buildParameter } from "../src/modules/git/core/parameters.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Funcionalidade coberta: ação Ctrl+D na árvore (excludeFilter).
// - Ctrl+D no item destacado abre um modal de confirmação mostrando o
//   padrão que será adicionado a excludeFilter (grupo: full_path + "/**",
//   projeto: path_with_namespace exato).
// - Enter confirma: grava o padrão em env.yaml (preservando o que já
//   existia) e remove o item — e toda a subárvore, se for um grupo — da
//   árvore exibida, sem precisar recarregar.
// - Esc cancela: fecha o modal sem alterar env.yaml nem a árvore.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-tree-exclude-"));
const envFile = path.join(tmpDir, "env.yaml");
fs.writeFileSync(envFile, ["# comentario preservado", 'base-dir: "repos"', ""].join("\n"));

const makeProject = (id: number, name: string, pathWithNamespace: string): GitLabTreeNode => ({
  id: `project-${id}`,
  type: "project",
  label: name,
  selected: false,
  excludePattern: pathWithNamespace,
  project: {
    id,
    name,
    path_with_namespace: pathWithNamespace,
    ssh_url_to_repo: `git@git.exemplo.com:${pathWithNamespace}.git`,
    http_url_to_repo: `https://git.exemplo.com/${pathWithNamespace}.git`,
  },
});

const buildNodes = (): GitLabTreeNode[] => [
  {
    id: "group-eleitoral",
    type: "group",
    label: "eleitoral",
    selected: false,
    excludePattern: "eleitoral/**",
    children: [
      makeProject(1, "cadastro-eleitor", "eleitoral/cadastro-eleitor"),
      makeProject(2, "urna-digital", "eleitoral/urna-digital"),
    ],
  },
  {
    id: "group-devops",
    type: "group",
    label: "devops",
    selected: false,
    excludePattern: "devops/**",
    children: [makeProject(3, "pipeline-tools", "devops/pipeline-tools")],
  },
];

const parameters = [
  {
    command: "git-sync",
    label: "Sincronizar repositórios",
    parameters: [
      buildParameter({ name: "excludeFilter", description: "Filtro de exclusão", value: "", source: "default" as const }),
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

let resolvedResult: { confirmed: boolean } | null = null;
const treePromise = renderRepositoryTree(buildNodes(), () => undefined, session, {
  parameters,
  envFilePath: envFile,
}).then((result) => {
  resolvedResult = result;
  return result;
});

await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 150));

const lastFrame = (): string => stripAnsi(tty.getLastFrame());

assert.ok(lastFrame().includes("eleitoral"), "Árvore completa deve exibir o grupo eleitoral");
assert.ok(lastFrame().includes("devops"), "Árvore completa deve exibir o grupo devops");

// Cursor começa no primeiro item (grupo "eleitoral"). Ctrl+D abre o modal
// de confirmação mostrando o padrão que será adicionado.
await tty.press(KEYS.ctrlD);
const withModalOpen = lastFrame();
assert.ok(
  withModalOpen.includes("eleitoral/**"),
  "Modal deve mostrar o padrão exato que será adicionado a excludeFilter"
);

// Esc cancela: nada muda.
await tty.press(KEYS.escape);
const afterCancel = lastFrame();
assert.ok(afterCancel.includes("eleitoral"), "Cancelar não deve remover o grupo da árvore");
const envAfterCancel = fs.readFileSync(envFile, "utf-8");
assert.ok(!envAfterCancel.includes("exclude-filter"), "Cancelar não deve gravar excludeFilter em env.yaml");

// Ctrl+D de novo no mesmo item, agora confirmando com Enter.
await tty.press(KEYS.ctrlD);
await tty.press(KEYS.enter);
const afterConfirm = lastFrame();
assert.ok(!afterConfirm.includes("eleitoral"), "Confirmar deve remover o grupo excluído da árvore");
assert.ok(!afterConfirm.includes("cadastro-eleitor"), "Confirmar deve remover os projetos do grupo excluído (cascata)");
assert.ok(!afterConfirm.includes("urna-digital"), "Confirmar deve remover os projetos do grupo excluído (cascata)");
assert.ok(afterConfirm.includes("devops") && afterConfirm.includes("pipeline-tools"), "Grupos não excluídos devem continuar visíveis");

const envAfterConfirm = fs.readFileSync(envFile, "utf-8");
assert.ok(
  envAfterConfirm.includes("eleitoral/**"),
  "env.yaml deve ganhar o padrão eleitoral/** em exclude-filter"
);
assert.ok(
  envAfterConfirm.includes('base-dir: "repos"'),
  "Gravar excludeFilter não pode apagar outras chaves já existentes no env.yaml"
);

// Cursor agora está no grupo "devops" (único restante). Ctrl+D + Enter
// exclui também, e o novo padrão se soma ao que já foi salvo.
await tty.press(KEYS.ctrlD);
await tty.press(KEYS.enter);
const envAfterSecondConfirm = fs.readFileSync(envFile, "utf-8");
assert.ok(
  envAfterSecondConfirm.includes("eleitoral/**") && envAfterSecondConfirm.includes("devops/**"),
  "Excluir um segundo item deve somar ao excludeFilter existente, não sobrescrever"
);

await tty.press(KEYS.escape);
const result = await treePromise;
assert.equal(result.confirmed, false, "Esc sem modal aberto deve cancelar a tela normalmente");
session.destroy();

console.log("tui_tree_exclude_test: OK");
