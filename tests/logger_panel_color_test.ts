import assert from "node:assert/strict";
import React from "react";
import { render } from "ink";
import { LoggerPanel } from "../src/modules/git/tui/components/LoggerPanel.js";
import { createLogEntry } from "../src/modules/git/tui/logger.js";
import { createFakeTTY, waitNextTick } from "./tui_test_utils.js";

// Regressões cobertas:
// 1. Colorização por nível usa ANSI manual (chalk desliga cores fora de TTY
//    real, o que apagava as cores silenciosamente).
// 2. Entradas longas são truncadas em uma única linha física — antes quebravam
//    em múltiplas linhas e estouravam a altura do painel (quebra do leiaute).

const tty = createFakeTTY();

const longTail = "FIMDALINHA";
const entries = [
  createLogEntry("linha info"),
  createLogEntry("aviso amarelo", "warn"),
  createLogEntry("erro vermelho", "error"),
  createLogEntry("depuracao cinza", "debug"),
  createLogEntry(`inicio-longo ${"x".repeat(200)} ${longTail}`, "warn"),
];

const { unmount } = render(React.createElement(LoggerPanel, { entries, height: 6 }), {
  stdout: tty.stdout,
  stdin: tty.stdin,
  patchConsole: false,
});
await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 100));
unmount();

const output = tty.getOutput();

assert.ok(/\[31m/.test(output), "Erro deve ser colorido em vermelho (31)");
assert.ok(/\[33m/.test(output), "Aviso deve ser colorido em amarelo (33)");
assert.ok(/\[90m/.test(output), "Debug deve ser colorido em cinza (90)");
assert.ok(output.includes("linha info"), "Entrada info deve ser renderizada");

assert.ok(output.includes("inicio-longo"), "Início da entrada longa deve aparecer");
assert.ok(
  !output.includes(longTail),
  "Entrada mais larga que o terminal deve ser truncada em uma única linha (sem quebra)"
);

console.log("logger_panel_color_test: OK");
