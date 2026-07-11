import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Box, Text, render } from "ink";
import { buildParameter } from "../src/modules/git/core/parameters.js";
import { Layout } from "../src/modules/git/tui/layout.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressões cobertas:
// 1. Ctrl+E abre o editor de env.yaml; Esc fecha; Ctrl+E reabre.
// 2. Esc durante a edição de um valor cancela apenas a edição — o modal
//    permanece aberto (antes, o Layout fechava o modal e descartava as
//    alterações pendentes).
// 3. Ctrl+P/Ctrl+H com o editor aberto NÃO trocam de modal (descartariam
//    edições pendentes silenciosamente).
// 4. Ctrl+S grava as alterações no env.yaml preservando comentários.
// 5. Ctrl+C encerra mesmo com modal aberto (bug pré-existente).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-edit-params-"));
const envFile = path.join(tmpDir, "env.yaml");
fs.writeFileSync(
  envFile,
  ["# comentario preservado", 'base-dir: "repos"', "verbose: false", ""].join("\n")
);

const parameters = [
  {
    command: "git-sync",
    label: "Sincronizar repositórios",
    parameters: [
      buildParameter({
        name: "baseDir",
        description: "Diretório base para clonagem",
        value: "repos",
        source: "env" as const,
      }),
      buildParameter({
        name: "verbose",
        description: "Logs detalhados",
        value: "false",
        source: "default" as const,
      }),
    ],
  },
];

const tty = createFakeTTY();
let ctrlCCalls = 0;

const tree = React.createElement(Layout, {
  title: "PAJÉ - Teste EditParams",
  orientation: "orientação",
  parameters,
  envFilePath: envFile,
  onCtrlC: () => {
    ctrlCCalls += 1;
  },
  children: React.createElement(Box, null, React.createElement(Text, null, "Conteúdo")),
});

const { unmount } = render(React.createElement(React.Fragment, null, tree), {
  stdout: tty.stdout,
  stdin: tty.stdin,
  exitOnCtrlC: false,
});
await waitNextTick();

const lastFrame = (): string => stripAnsi(tty.getLastFrame());
const editorOpen = (frame: string): boolean =>
  frame.includes("Editar env.yaml") || frame.includes("Edit env.yaml");
const editingHint = (frame: string): boolean =>
  frame.includes("Digite o valor") || frame.includes("Type value");

// 1. Ctrl+E abre o editor
await tty.press(KEYS.ctrlE);
assert.ok(editorOpen(lastFrame()), "Ctrl+E deve abrir o editor de parâmetros do env.yaml");

// 3. Ctrl+P/Ctrl+H não devem trocar de modal com o editor aberto
await tty.press(KEYS.ctrlP);
assert.ok(editorOpen(lastFrame()), "Ctrl+P com o editor aberto não deve trocar de modal");
await tty.press(KEYS.ctrlH);
assert.ok(editorOpen(lastFrame()), "Ctrl+H com o editor aberto não deve trocar de modal");

// 2. Enter entra em modo edição; Esc cancela apenas a edição
await tty.press(KEYS.enter);
assert.ok(editingHint(lastFrame()), "Enter deve iniciar a edição do parâmetro selecionado");

await tty.press(KEYS.escape);
assert.ok(
  editorOpen(lastFrame()) && !editingHint(lastFrame()),
  "Esc durante a edição deve cancelar apenas a edição, mantendo o modal aberto"
);

// 4. Edita, confirma e salva
await tty.press(KEYS.enter);
assert.ok(editingHint(lastFrame()), "Enter deve reabrir a edição após o cancelamento");
await tty.press("x");
await tty.press("y");
await tty.press("z");
await tty.press(KEYS.enter);
const framePending = lastFrame();
assert.ok(
  framePending.includes("pendente") || framePending.includes("pending"),
  "Confirmar a edição deve marcar o parâmetro como pendente"
);

await tty.press(KEYS.ctrlS);
const frameSaved = lastFrame();
assert.ok(
  frameSaved.includes("Parâmetros salvos") || frameSaved.includes("Parameters saved"),
  "Ctrl+S deve salvar e exibir confirmação"
);

const savedContent = fs.readFileSync(envFile, "utf-8");
assert.ok(savedContent.includes("# comentario preservado"), "Comentários do env.yaml devem ser preservados");
assert.ok(savedContent.includes('base-dir: "reposxyz"'), "Valor editado deve ser gravado na chave kebab-case existente");
assert.ok(savedContent.includes("verbose: false"), "Chaves não editadas devem permanecer intactas");

// 1b. Esc fecha o modal (fora do modo edição) e Ctrl+E reabre
await tty.press(KEYS.escape);
assert.ok(!editorOpen(lastFrame()), "Esc fora do modo edição deve fechar o editor");
await tty.press(KEYS.ctrlE);
assert.ok(editorOpen(lastFrame()), "Ctrl+E deve reabrir o editor");

// 5. Ctrl+C funciona com modal aberto
await tty.press(KEYS.ctrlC);
assert.equal(ctrlCCalls, 1, "Ctrl+C deve funcionar mesmo com modal aberto");

unmount();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("tui_edit_params_modal_test: OK");
