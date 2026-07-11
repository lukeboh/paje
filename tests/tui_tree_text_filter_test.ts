import assert from "node:assert/strict";
import { renderRepositoryTree } from "../src/modules/git/tui.app.js";
import { filterTreeByText } from "../src/modules/git/treeBuilder.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Funcionalidade coberta: filtro da árvore por digitação.
// - Digitar caracteres imprimíveis filtra a árvore em tempo real (label e
//   path_with_namespace, case-insensitive), mantendo os ancestrais visíveis.
// - Um indicador com a consulta e a contagem aparece acima da lista.
// - Backspace apaga o último caractere; Esc limpa o filtro sem cancelar a
//   tela; um segundo Esc (sem filtro) cancela normalmente.

const makeProject = (id: number, name: string, path: string): GitLabTreeNode => ({
  id: `project-${id}`,
  type: "project",
  label: name,
  selected: false,
  project: {
    id,
    name,
    path_with_namespace: path,
    ssh_url_to_repo: `git@git.exemplo.com:${path}.git`,
    http_url_to_repo: `https://git.exemplo.com/${path}.git`,
  },
});

const buildNodes = (): GitLabTreeNode[] => [
  {
    id: "group-1",
    type: "group",
    label: "eleitoral",
    selected: false,
    children: [
      makeProject(1, "cadastro-eleitor", "eleitoral/cadastro-eleitor"),
      makeProject(2, "urna-digital", "eleitoral/urna-digital"),
    ],
  },
  {
    id: "group-2",
    type: "group",
    label: "devops",
    selected: false,
    children: [makeProject(3, "pipeline-tools", "devops/pipeline-tools")],
  },
];

// --- Parte 1: unidade — filterTreeByText ---

const nodes = buildNodes();

const byText = filterTreeByText(nodes, "urna");
assert.equal(byText.length, 1, "Somente o grupo com descendente correspondente deve permanecer");
assert.equal(byText[0].label, "eleitoral", "O ancestral do item correspondente deve permanecer visível");
assert.equal(byText[0].children?.length, 1, "Apenas o projeto correspondente deve permanecer no grupo");
assert.equal(byText[0].children?.[0].label, "urna-digital");

const byPath = filterTreeByText(nodes, "DEVOPS/pipe");
assert.equal(byPath.length, 1, "A busca deve casar com path_with_namespace (case-insensitive)");
assert.equal(byPath[0].label, "devops");

const byGroup = filterTreeByText(nodes, "eleitoral");
assert.equal(byGroup[0].children?.length, 2, "Grupo correspondente deve manter toda a subárvore");

assert.equal(filterTreeByText(nodes, "").length, 2, "Consulta vazia não filtra nada");
assert.equal(filterTreeByText(nodes, "inexistente").length, 0, "Sem correspondência, árvore vazia");

// --- Parte 2: integração — TUI reage à digitação ---

const tty = createFakeTTY();
let resolvedResult: { confirmed: boolean } | null = null;

const treePromise = renderRepositoryTree(buildNodes(), () => undefined, undefined, {
  renderOptions: {
    stdout: tty.stdout,
    stdin: tty.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  },
}).then((result) => {
  resolvedResult = result;
  return result;
});

await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 150));

const lastFrame = (): string => stripAnsi(tty.getLastFrame());

assert.ok(lastFrame().includes("urna-digital"), "Árvore completa deve exibir todos os projetos");
assert.ok(lastFrame().includes("pipeline-tools"), "Árvore completa deve exibir todos os projetos");

// Digita "urna" → apenas o projeto correspondente permanece
await tty.press("u");
await tty.press("r");
await tty.press("n");
await tty.press("a");
const filtered = lastFrame();
assert.ok(filtered.includes("urna-digital"), "Projeto correspondente deve permanecer visível");
assert.ok(!filtered.includes("pipeline-tools"), "Projetos não correspondentes devem sumir");
assert.ok(!filtered.includes("cadastro-eleitor"), "Projetos não correspondentes devem sumir");
assert.ok(
  filtered.includes('"urna"') && (filtered.includes("Filtro:") || filtered.includes("Filter:")),
  "Indicador do filtro deve exibir a consulta digitada"
);

// Backspace apaga o último caractere → "urn" ainda casa com urna-digital
await tty.press(KEYS.ctrlH); // byte 0x08 = backspace
const afterBackspace = lastFrame();
assert.ok(
  afterBackspace.includes('"urn"'),
  "Backspace deve apagar o último caractere da consulta"
);
assert.ok(
  !afterBackspace.includes("Ajuda do sistema") && !afterBackspace.includes("System help"),
  "Backspace com filtro ativo não pode abrir a ajuda"
);

// Esc limpa o filtro sem cancelar a tela
await tty.press(KEYS.escape);
const cleared = lastFrame();
assert.ok(cleared.includes("pipeline-tools"), "Esc deve limpar o filtro e restaurar a árvore completa");
assert.equal(resolvedResult, null, "Esc com filtro ativo não pode cancelar a tela");

// Segundo Esc (sem filtro) cancela a tela normalmente
await tty.press(KEYS.escape);
const result = await treePromise;
assert.equal(result.confirmed, false, "Esc sem filtro deve cancelar a tela");

console.log("tui_tree_text_filter_test: OK");
