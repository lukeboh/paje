import assert from "node:assert/strict";
import React from "react";
import { Box, Text, render } from "ink";
import { Layout } from "../src/modules/git/tui/layout.js";
import { renderRepositoryTree } from "../src/modules/git/tui.app.js";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import type { GitLabTreeNode } from "../src/modules/git/types.js";
import { createFakeTTY, KEYS, waitNextTick } from "./tui_test_utils.js";

// Regressão coberta: piscada da tela inteira a cada atualização.
// Quando o frame ocupa a altura total do terminal, o Ink abandona o modo
// incremental e emite clearTerminal (ESC[2J) a cada render — a TUI inteira
// pisca a cada tecla, de forma acentuada via SSH. O Layout deve permanecer
// abaixo desse limite para que NENHUM clear de tela inteira seja emitido
// durante a interação.

const countClears = (output: string): number => output.split("[2J").length - 1;

// --- Parte 1: Layout genérico ---

{
  const tty = createFakeTTY(80, 24);
  const tree = React.createElement(Layout, {
    title: "PAJÉ - Teste flicker",
    orientation: "orientação",
    parameters: [],
    helpOnBackspace: true,
    children: React.createElement(Box, null, React.createElement(Text, null, "Conteúdo")),
  });
  const { unmount } = render(React.createElement(React.Fragment, null, tree), {
    stdout: tty.stdout,
    stdin: tty.stdin,
    patchConsole: false,
  });
  await waitNextTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  await tty.press(KEYS.ctrlP);
  await tty.press(KEYS.escape);
  await tty.press(KEYS.ctrlW);
  await tty.press(KEYS.ctrlW);
  await tty.press(KEYS.ctrlL);
  await tty.press(KEYS.ctrlL);
  unmount();

  assert.equal(
    countClears(tty.getOutput()),
    0,
    "Nenhum clear de tela inteira (ESC[2J) pode ser emitido durante a interação com o Layout"
  );
}

// --- Parte 2: árvore de repositórios (tela real do git-sync) ---

{
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
      children: Array.from({ length: 30 }, (_, index) => makeProject(index + 1, `repo-${index + 1}`)),
    },
  ];

  const tty = createFakeTTY(80, 24);
  const session = createTuiSession("test", {
    renderOptions: {
      stdout: tty.stdout,
      stdin: tty.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  });
  const treePromise = renderRepositoryTree(nodes, () => undefined, session, {});
  await waitNextTick();
  await new Promise((resolve) => setTimeout(resolve, 150));

  await tty.press(KEYS.arrowDown);
  await tty.press(KEYS.arrowDown);
  await tty.press(" ");
  await tty.press("r");
  await tty.press(KEYS.escape);
  await tty.press(KEYS.escape);
  await treePromise;

  assert.equal(
    countClears(tty.getOutput()),
    0,
    "Nenhum clear de tela inteira (ESC[2J) pode ser emitido ao navegar, selecionar e filtrar a árvore"
  );
  session.destroy();
}

console.log("tui_no_flicker_test: OK");
