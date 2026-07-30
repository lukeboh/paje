import assert from "node:assert/strict";
import React from "react";
import { Box, Text, render } from "ink";
import { Layout } from "../src/modules/git/tui/layout.js";
import { createFakeTTY, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressão: a barra de orientação não tinha wrap="truncate-end" — uma
// mensagem mais longa que a largura do terminal quebrava linha (padrão do
// Ink) e estourava a altura de 1 linha reservada para a barra, vazando
// visualmente para o painel de Log logo abaixo (encontrado ao testar as
// novas descrições — mais longas — do formulário de escolha de autenticação
// do git-server-store).

const tty = createFakeTTY(80, 24);
const longMessage = "A".repeat(200);
const { unmount } = render(
  React.createElement(Layout, {
    title: "Teste",
    orientation: longMessage,
    parameters: [],
    children: React.createElement(Box, null, React.createElement(Text, null, "conteúdo")),
  }),
  { stdout: tty.stdout, stdin: tty.stdin } as any
);
await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 100));

const frame = stripAnsi(tty.getLastFrame());
const lines = frame.split("\n");

const logTitleLine = lines.find((line) => line.trim() === "│ Log" || line.includes("│ Log "));
assert.ok(logTitleLine, "O painel de Log deve continuar aparecendo intacto, na sua própria linha");

const orientationLine = lines.find((line) => line.includes("AAAAAAAAAAAAAAAAAAAA"));
assert.ok(orientationLine, "A barra de orientação deve exibir a mensagem (ainda que truncada)");
assert.ok(!orientationLine!.includes("Log"), "A mensagem de orientação não pode vazar para o painel de Log abaixo");

unmount();
console.log("tui_orientation_bar_truncate_test: OK");
