import assert from "node:assert/strict";
import React from "react";
import { Box, Text, render } from "ink";
import { PassThrough } from "node:stream";
import { buildParameter } from "../src/modules/git/core/parameters.js";
import { Layout } from "../src/modules/git/tui/layout.js";
import { createLogEntry } from "../src/modules/git/tui/logger.js";

const normalizeOutput = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

const stdout = new PassThrough();
(stdout as { columns?: number; rows?: number; isTTY?: boolean }).columns = 80;
(stdout as { columns?: number; rows?: number; isTTY?: boolean }).rows = 24;
(stdout as { columns?: number; rows?: number; isTTY?: boolean }).isTTY = true;

const stdin = new PassThrough();
(
  stdin as {
    isTTY?: boolean;
    setRawMode?: (value: boolean) => void;
    ref?: () => void;
    unref?: () => void;
  }
).isTTY = true;
(
  stdin as {
    isTTY?: boolean;
    setRawMode?: (value: boolean) => void;
    ref?: () => void;
    unref?: () => void;
  }
).setRawMode = () => undefined;
(
  stdin as {
    isTTY?: boolean;
    setRawMode?: (value: boolean) => void;
    ref?: () => void;
    unref?: () => void;
  }
).ref = () => undefined;
(
  stdin as {
    isTTY?: boolean;
    setRawMode?: (value: boolean) => void;
    ref?: () => void;
    unref?: () => void;
  }
).unref = () => undefined;

let output = "";
stdout.on("data", (chunk) => {
  output += chunk.toString();
});

const waitNextTick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const waitForOutput = async (predicate: (value: string) => boolean, timeoutMs = 300): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(output)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const pressKey = (keyValue: string): void => {
  const data = Buffer.from(keyValue, "utf8");
  stdin.write(data);
  stdin.emit("data", data);
  stdin.emit("keypress", keyValue, { name: keyValue, sequence: keyValue });
};

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
    children: React.createElement(
      Box,
      null,
      React.createElement(Text, null, "Conteúdo")
    ),
  }
);

const { unmount } = render(React.createElement(React.Fragment, null, tree), {
  stdout: stdout as unknown as NodeJS.WriteStream,
  stdin: stdin as unknown as NodeJS.ReadStream,
});
await waitNextTick();

pressKey("p");
await waitForOutput((value) => value.includes("Parâmetros carregados") || value.includes("Loaded parameters"));
pressKey("h");
await waitForOutput((value) => value.includes("Ajuda do sistema") || value.includes("System help"));

pressKey("w");
await waitNextTick();
pressKey("\u001B");
await waitNextTick();

assert.ok(output.includes("PAJÉ - Teste TUI"), "Deve renderizar o título no layout");
assert.ok(output.includes("Use S para confirmar"), "Deve renderizar a orientação");
assert.ok(output.includes("Evento inicial"), "Deve renderizar entradas do log");
assert.ok(output.includes("Falha ao autenticar"), "Deve renderizar mensagens de erro");
const modalShown =
  output.includes("Parâmetros carregados") ||
  output.includes("P/Esc para fechar") ||
  output.includes("Loaded parameters") ||
  output.includes("P/Esc to close");
assert.ok(modalShown, "Deve exibir a modal de parâmetros ao pressionar P");
assert.ok(/\u001b\[(31|91)m/.test(output), "Deve colorir erro em vermelho");
const normalizedAfterEsc = normalizeOutput(output);
assert.ok(normalizedAfterEsc.includes("Conteúdo"), "Esc deve restaurar painel maximizado e manter área de trabalho");

unmount();

console.log("tui_render_test: OK");
