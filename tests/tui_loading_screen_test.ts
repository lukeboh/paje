import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { renderLoadingScreen } from "../src/modules/git/tui.app.js";
import { createTuiSession } from "../src/modules/git/tuiSession.js";

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

const session = createTuiSession("test", {
  renderOptions: {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
  },
});

const handle = renderLoadingScreen(
  {
    title: "PAJÉ - Teste Loading",
    message: "Carregando repositórios...",
    orientation: "Aguarde enquanto consultamos os servidores",
  },
  session
);

await waitNextTick();
await waitForOutput((value) => value.includes("Carregando repositórios"));

const normalized = normalizeOutput(output);
assert.ok(normalized.includes("PAJÉ - Teste Loading"), "Deve renderizar o título do loading");
assert.ok(normalized.includes("Carregando repositórios"), "Deve renderizar mensagem do loading");
assert.ok(normalized.includes("Aguarde enquanto consultamos os servidores"), "Deve renderizar orientação do loading");

handle.stop();
session.destroy();

console.log("tui_loading_screen_test: OK");
