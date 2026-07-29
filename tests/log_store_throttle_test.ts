import assert from "node:assert/strict";
import { appendLogEntry, clearLogEntries, getLogEntries, setLogLevel, subscribeLogEntries } from "../src/modules/git/tui/logStore.js";

// Regressão coberta: uma rajada de entradas de log muito rápidas (ex.: saída
// crua de progresso do git durante um clone, chegando a cada poucos ms) fazia
// o painel de log notificar — e portanto o Ink redesenhar o frame inteiro —
// uma vez por linha. Nessa frequência, só o conteúdo do log muda de fato
// entre um redesenho e outro, o que é percebido como aquela região da tela
// piscando. O store agora agrupa notificações dentro de uma janela curta,
// sem perder nenhuma entrada (o snapshot entregue sempre reflete todas as
// entradas já anexadas).

setLogLevel("debug");
clearLogEntries();

let notifyCount = 0;
const unsubscribe = subscribeLogEntries(() => {
  notifyCount += 1;
});

// Rajada bem mais rápida que a janela de agrupamento (~80ms).
for (let i = 0; i < 40; i++) {
  appendLogEntry(`linha ${i}`, "info");
  await new Promise((resolve) => setTimeout(resolve, 8));
}
await new Promise((resolve) => setTimeout(resolve, 150));

assert.ok(
  notifyCount < 40,
  `Uma rajada de 40 entradas rápidas deve gerar bem menos que 40 notificações (obteve ${notifyCount})`
);
assert.ok(notifyCount > 0, "A rajada ainda precisa gerar pelo menos uma notificação");

const entries = getLogEntries();
assert.strictEqual(entries.length, 40, "Nenhuma entrada pode ser perdida ao agrupar notificações");
assert.strictEqual(entries[entries.length - 1]?.message, "linha 39", "A última entrada deve estar presente no snapshot final");

// Depois de um período ocioso, o agrupamento não pode "prender" a próxima
// notificação — uma única entrada isolada ainda deve notificar prontamente.
const countBeforeIdleAppend = notifyCount;
appendLogEntry("linha isolada após pausa", "info");
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(
  notifyCount > countBeforeIdleAppend,
  "Uma entrada isolada após um período ocioso deve notificar sem esperar a janela inteira"
);

unsubscribe();
setLogLevel("warn");
clearLogEntries();

console.log("log_store_throttle_test: OK");
