import assert from "node:assert/strict";
import React from "react";
import { Text, useInput } from "ink";
import { createScreenHost } from "../src/modules/git/tui/screenHost.js";
import { createFakeTTY, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressão coberta (BUG-23): entre release() de uma tela e o mount() da
// próxima, o Root comita um frame nulo e todos os useInput desmontam. Sem o
// RawModeKeeper, o contador interno de raw mode do Ink chegava a 0 nesse gap
// e o Ink desmontava o pipeline de entrada inteiro (setRawMode(false),
// listener 'readable' removido, stdin.unref()) para remontá-lo na tela
// seguinte. No POSIX o liga-desliga é inócuo; no Windows ele obriga o libuv a
// cancelar e reiniciar a thread leitora bloqueante do console — operação não
// confiável que deixava o teclado permanentemente morto após a transição
// loading → árvore. O keeper mantém o contador ≥ 1 pela vida do host, então
// stdin.setRawMode(false) NUNCA pode acontecer entre telas, o listener
// 'readable' nunca é removido e o input continua vivo depois do gap.

const tty = createFakeTTY(80, 24);

const rawModeCalls: boolean[] = [];
(tty.stdin as unknown as { setRawMode: (value: boolean) => void }).setRawMode = (value: boolean) => {
  rawModeCalls.push(value);
};

const received: string[] = [];

const InputScreen: React.FC<{ label: string }> = ({ label }) => {
  useInput((input) => {
    received.push(input);
  });
  return React.createElement(Text, null, label);
};

const host = createScreenHost({ stdout: tty.stdout, stdin: tty.stdin });

const key1 = host.mount(React.createElement(InputScreen, { label: "Tela um" }));
await tty.waitForOutput((out) => stripAnsi(out).includes("Tela um"));
// O output aparece no commit, mas os passive effects (useEffect do keeper e
// do useInput) descarregam um tick depois — sem este settle a asserção corre
// na frente do próprio setRawMode(true).
await new Promise((resolve) => setTimeout(resolve, 50));
assert.ok(rawModeCalls.includes(true), "Montar a primeira tela deve ligar o raw mode");

// Simula o gap loading → árvore: release() sem mount() imediato, com tempo
// de sobra para o React comitar o frame nulo e desmontar todos os useInput.
host.release(key1);
await waitNextTick();
await new Promise((resolve) => setTimeout(resolve, 50));

assert.ok(
  !rawModeCalls.includes(false),
  "Nenhum setRawMode(false) pode acontecer no gap entre telas — é o liga-desliga que mata o teclado no Windows"
);
assert.ok(
  (tty.stdin as unknown as { listenerCount: (event: string) => number }).listenerCount("readable") >= 1,
  "O listener 'readable' do Ink deve continuar instalado durante o gap entre telas"
);

// A tela seguinte deve continuar recebendo teclado normalmente após o gap.
host.mount(React.createElement(InputScreen, { label: "Tela dois" }));
await tty.waitForOutput((out) => stripAnsi(out).includes("Tela dois"));
// Mesmo settle da primeira montagem: o handler do useInput só se registra
// quando os passive effects descarregam, um tick após o output aparecer.
await new Promise((resolve) => setTimeout(resolve, 50));
await tty.press("x");
assert.ok(received.includes("x"), "A tela montada após o gap deve continuar recebendo input");

host.destroy();

console.log("screen_host_raw_mode_test: OK");
