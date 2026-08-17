import assert from "node:assert/strict";
import React from "react";
import { Box, Text, render } from "ink";
import { Layout } from "../src/modules/git/tui/layout.js";
import { createFakeTTY, KEYS, stripAnsi, waitNextTick } from "./tui_test_utils.js";

// Regressão: o modal de ajuda (Ctrl+H) tinha dois problemas que, juntos,
// podiam deixar atalhos reais (ex.: o Ctrl+D da árvore) impossíveis de ver:
// 1. Renderizava TODOS os grupos de atalhos (global, menu, árvore), mesmo os
//    que não se aplicam à tela atual — só ficavam "apagados" (dimColor), mas
//    ainda ocupavam linhas. Corrigido: só grupos com pelo menos um atalho
//    aplicável ao contexto atual aparecem.
// 2. O modal tinha altura fixa e nenhuma forma de rolar — ↑/↓ eram tratados
//    como tentativas de executar um atalho (fechando a ajuda e reaplicando a
//    tecla na tela de trás), nunca como navegação dentro do próprio modal.
//    Corrigido: essas teclas (e PgUp/PgDn) agora rolam a lista, como em todo
//    outro modal do app (ParametersModal, BranchModal).

const renderLayout = async (helpContext: "menu" | "tree", rows = 24) => {
  const tty = createFakeTTY(80, rows);
  const element = React.createElement(Layout, {
    title: "PAJÉ - Teste Help",
    orientation: "orientação",
    helpContext,
    helpOnBackspace: true,
    children: React.createElement(Box, null, React.createElement(Text, null, "Conteúdo")),
  });
  const { unmount } = render(React.createElement(React.Fragment, null, element), {
    stdout: tty.stdout,
    stdin: tty.stdin,
  });
  await waitNextTick();
  await tty.press(KEYS.ctrlH);
  return { tty, unmount };
};

// --- Parte 1: filtrar por contexto libera espaço suficiente num terminal
// de tamanho normal (mesmo comportamento verificado manualmente via tmux) ---

{
  const { tty, unmount } = await renderLayout("tree", 40);
  const frame = stripAnsi(tty.getLastFrame());
  assert.ok(
    frame.includes("Repository tree") || frame.includes("Árvore de repositórios"),
    "Contexto árvore deve mostrar o grupo de atalhos da árvore"
  );
  assert.ok(frame.includes("Ctrl+D"), "Num terminal de tamanho normal, o Ctrl+D deve aparecer sem precisar rolar");
  assert.ok(
    !frame.includes("Main menu") && !frame.includes("Menu principal"),
    "Contexto árvore não deve desperdiçar espaço mostrando o grupo do menu principal (inaplicável)"
  );
  unmount();
}

{
  const { tty, unmount } = await renderLayout("menu", 40);
  const frame = stripAnsi(tty.getLastFrame());
  assert.ok(
    frame.includes("Main menu") || frame.includes("Menu principal"),
    "Contexto menu deve mostrar o grupo de atalhos do menu principal"
  );
  assert.ok(
    !frame.includes("Repository tree") && !frame.includes("Árvore de repositórios"),
    "Contexto menu não deve mostrar o grupo de atalhos da árvore (inaplicável)"
  );
  assert.ok(!frame.includes("Ctrl+D"), "Contexto menu não deve mostrar o atalho Ctrl+D, que só existe na árvore");
  unmount();
}

// --- Parte 2: mesmo num terminal pequeno, onde nem a lista filtrada cabe
// inteira, rolar com PgDn/PgUp alcança o conteúdo que ficaria fora da tela ---

{
  const { tty, unmount } = await renderLayout("tree", 24);
  const before = stripAnsi(tty.getLastFrame());
  assert.ok(
    !before.includes("Ctrl+D"),
    "Pré-condição do teste: num terminal pequeno, o fim da lista ainda começa fora da tela"
  );

  await tty.press(KEYS.pageDown);
  await tty.press(KEYS.pageDown);
  const afterPageDown = stripAnsi(tty.getLastFrame());
  assert.ok(afterPageDown.includes("Ctrl+D"), "PgDn deve rolar até revelar o Ctrl+D, fora da primeira tela");

  await tty.press(KEYS.pageUp);
  await tty.press(KEYS.pageUp);
  const afterPageUp = stripAnsi(tty.getLastFrame());
  assert.ok(
    afterPageUp.includes("Global shortcuts") || afterPageUp.includes("Atalhos globais"),
    "PgUp deve rolar de volta para o topo da lista"
  );
  unmount();
}

console.log("tui_help_modal_context_test: OK");
