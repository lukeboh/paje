import assert from "node:assert/strict";
import React from "react";
import { Text } from "ink";
import { renderMenu, type MenuItem } from "../src/modules/git/tui/menu.app.js";
import { createScreenHost } from "../src/modules/git/tui/screenHost.js";
import { createFakeTTY, KEYS, stripAnsi } from "./tui_test_utils.js";

// Regressão coberta: renderMenu não tinha nenhuma cobertura de teste própria
// (apenas o componente MenuDashboard era testado isoladamente). Ao receber um
// ScreenHost compartilhado (como cli.ts passa entre o menu e cada comando),
// renderMenu deve montar/liberar através dele em vez de criar sua própria
// instância de Ink — permitindo que a tela seguinte (o comando escolhido)
// assuma sem um clear de tela inteira nem uma reconstrução desconectada.

const countClears = (output: string): number => output.split("[2J").length - 1;

const items: MenuItem[] = [
  { label: "Git Sync", command: "git-sync", shortcut: "Ctrl+S", description: "Sincroniza repositórios" },
  { label: "Git Server Store", command: "git-server-store", shortcut: "Ctrl+G", description: "Gerencia servidores" },
];

const tty = createFakeTTY(80, 24);
const host = createScreenHost({ stdout: tty.stdout, stdin: tty.stdin, exitOnCtrlC: false, patchConsole: false });

const menuPromise = renderMenu(items, [], undefined, host);
await tty.waitForOutput((out) => stripAnsi(out).includes("Git Sync"));
assert.equal(countClears(tty.getOutput()), 0, "Montar o menu não pode emitir clear de tela inteira");

await tty.press(KEYS.enter);
const selection = await menuPromise;
assert.equal(selection?.command, "git-sync", "Enter deve selecionar o item destacado");

// Simula a próxima tela (o comando escolhido) assumindo o mesmo host.
const boundary = tty.getOutput().length;
host.mount(React.createElement(Text, null, "Tela do comando"));
await tty.waitForOutput((out) => stripAnsi(out).includes("Tela do comando"));
const acrossTransition = tty.getOutput().slice(boundary);

assert.ok(
  !acrossTransition.includes("[2J"),
  "Transição do menu para a tela do comando não pode emitir clear de tela inteira"
);
assert.ok(
  !stripAnsi(tty.getLastFrame()).includes("Git Sync"),
  "O menu não deve mais aparecer depois que a próxima tela assumiu o host"
);

host.destroy();

console.log("tui_render_menu_host_test: OK");
