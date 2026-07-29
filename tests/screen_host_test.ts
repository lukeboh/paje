import assert from "node:assert/strict";
import React from "react";
import { Text } from "ink";
import { createScreenHost } from "../src/modules/git/tui/screenHost.js";
import { createFakeTTY, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressão coberta: ao trocar de tela, o Ink não pode perder a memória do
// frame anterior e escrever o novo do zero (o que obriga o terminal a rolar/
// reacomodar e é percebido como piscada/reconstrução total). ScreenHost
// mantém uma única instância de Ink viva e troca apenas a subtree montada —
// a transição deve usar o burst incremental de "apagar linhas" do Ink, nunca
// um clear de tela inteira nem uma escrita desconectada (sem nenhum apagar).

const ERASE_BURST = /(?:\[2K\[1A)+\[2K\[G/;

const tty = createFakeTTY(80, 24);
const host = createScreenHost({ stdout: tty.stdout, stdin: tty.stdin });

const key1 = host.mount(React.createElement(Text, null, "Tela um"));
await tty.waitForOutput((out) => stripAnsi(out).includes("Tela um"));
const outputAfterFirst = tty.getOutput();
assert.ok(!outputAfterFirst.includes("[2J"), "Primeira montagem não deve emitir clear de tela inteira");

const boundary = outputAfterFirst.length;
const key2 = host.mount(React.createElement(Text, null, "Tela dois"));
await tty.waitForOutput((out) => stripAnsi(out).includes("Tela dois"));
const acrossTransition = tty.getOutput().slice(boundary);

assert.ok(!acrossTransition.includes("[2J"), "Troca de tela não pode emitir clear de tela inteira (ESC[2J)");
assert.ok(
  ERASE_BURST.test(acrossTransition),
  "Troca de tela deve usar o burst incremental de apagar linhas do Ink, não uma escrita desconectada"
);
assert.ok(!stripAnsi(tty.getLastFrame()).includes("Tela um"), "A tela anterior não deve mais aparecer após a troca");

// release() com uma chave já superada (a da primeira tela) deve ser no-op —
// a tela atual (a segunda) continua exibida.
host.release(key1);
await waitNextTick();
assert.ok(stripAnsi(tty.getLastFrame()).includes("Tela dois"), "release() de uma chave superada não pode afetar a tela atual");

// release() com a chave atual limpa a tela.
host.release(key2);
await waitNextTick();
assert.ok(!stripAnsi(tty.getLastFrame()).includes("Tela dois"), "release() da chave atual deve limpar a tela");

host.destroy();

console.log("screen_host_test: OK");
