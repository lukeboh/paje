import assert from "node:assert/strict";
import React from "react";
import { Box, Text } from "ink";
import { render } from "ink";
import { buildParameter } from "../src/modules/git/core/parameters.js";
import { Layout } from "../src/modules/git/tui/layout.js";
import { createLogEntry } from "../src/modules/git/tui/logger.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

const tty = createFakeTTY();

const logs = [
  createLogEntry("Evento inicial"),
  createLogEntry("Falha ao autenticar", "error"),
];

const parameters = [
  {
    command: "git-sync",
    label: "Sincronizar repositórios GitLab",
    parameters: [
      buildParameter({
        name: "baseDir",
        description: "Diretório base para clonagem",
        value: "repos",
        source: "cli",
      }),
    ],
  },
];

const tree = React.createElement(
  Layout,
  {
    title: "PAJÉ - Teste TUI",
    orientation: "Use S para confirmar",
    logEntries: logs,
    parameters,
    initialLogMaximized: false,
    initialWorkspaceMaximized: false,
    helpOnBackspace: true,
    children: React.createElement(
      Box,
      null,
      React.createElement(Text, null, "Conteúdo")
    ),
  }
);

const { unmount } = render(React.createElement(React.Fragment, null, tree), {
  stdout: tty.stdout,
  stdin: tty.stdin,
});
await waitNextTick();

// Ctrl+P abre o modal de parâmetros
await tty.press(KEYS.ctrlP);
const paramFrame = stripAnsi(tty.getLastFrame());
const modalShown =
  paramFrame.includes("Parâmetros carregados") || paramFrame.includes("Loaded parameters");
assert.ok(modalShown, "Deve exibir a modal de parâmetros ao pressionar Ctrl+P");

// Ctrl+H (byte 0x08, reportado como backspace) abre a ajuda
await tty.press(KEYS.ctrlH);
const helpFrame = stripAnsi(tty.getLastFrame());
const helpShown = helpFrame.includes("Ajuda do sistema") || helpFrame.includes("System help");
assert.ok(helpShown, "Deve exibir a modal de ajuda ao pressionar Ctrl+H");

// Esc fecha a modal; Ctrl+W maximiza a área de trabalho; Esc restaura
await tty.press(KEYS.escape);
await tty.press(KEYS.ctrlW);
await tty.press(KEYS.escape);

const output = tty.getOutput();
assert.ok(output.includes("PAJÉ - Teste TUI"), "Deve renderizar o título no layout");
assert.ok(output.includes("Use S para confirmar"), "Deve renderizar a orientação");
assert.ok(output.includes("Evento inicial"), "Deve renderizar entradas do log");
assert.ok(output.includes("Falha ao autenticar"), "Deve renderizar mensagens de erro");
assert.ok(/\[(31|91)m/.test(output), "Deve colorir erro em vermelho");

const finalFrame = stripAnsi(tty.getLastFrame());
assert.ok(finalFrame.includes("Conteúdo"), "Esc deve restaurar painel maximizado e manter área de trabalho");

unmount();

console.log("tui_render_test: OK");
