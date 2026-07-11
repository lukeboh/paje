import assert from "node:assert/strict";
import React from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { MenuDashboard, type MenuItem, MENU_ORIENTATION_MESSAGE } from "../src/modules/git/tui/menu.app.js";

const stdout = new PassThrough();
(stdout as { columns?: number; rows?: number; isTTY?: boolean }).columns = 120;
(stdout as { columns?: number; rows?: number; isTTY?: boolean }).rows = 30;
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

const normalizeOutput = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

const items: MenuItem[] = [
  {
    label: "Sincronizar repositórios GitLab",
    command: "git-sync",
    description: "Sincroniza projetos e repositórios.",
    shortcut: "S",
  },
  {
    label: "Registrar servidor GitLab",
    command: "git-server-store",
    description: "Registra servidor e token.",
    shortcut: "G",
  },
];

const tree = React.createElement(MenuDashboard, { items, selectedIndex: 0 });

const { unmount } = render(React.createElement(React.Fragment, null, tree), {
  stdout: stdout as unknown as NodeJS.WriteStream,
  stdin: stdin as unknown as NodeJS.ReadStream,
});
await waitNextTick();

const normalized = normalizeOutput(output);

assert.ok(normalized.includes("Sincronizar repositórios GitLab"), "Deve renderizar o cartão S");
assert.ok(normalized.includes("Registrar servidor GitLab"), "Deve renderizar o cartão G");
assert.ok(normalized.includes("Sincroniza projetos e repositórios."), "Deve renderizar a descrição selecionada");
assert.ok(MENU_ORIENTATION_MESSAGE.includes("Ctrl+S"), "Mensagem de orientação deve citar atalhos");
assert.ok(MENU_ORIENTATION_MESSAGE.includes("Esc"), "Mensagem de orientação deve citar Esc");

unmount();

console.log("tui_menu_dashboard_test: OK");
