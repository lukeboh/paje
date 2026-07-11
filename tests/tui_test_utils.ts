import { PassThrough } from "node:stream";

export type FakeTTY = {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  getOutput: () => string;
  getLastFrame: () => string;
  pressKey: (keyValue: string) => void;
  press: (keyValue: string, settleMs?: number) => Promise<void>;
  waitForOutput: (predicate: (value: string) => boolean, timeoutMs?: number) => Promise<boolean>;
};

export const KEYS = {
  ctrlB: "\u0002",
  ctrlC: "\u0003",
  ctrlE: "\u0005",
  ctrlF: "\u0006",
  ctrlH: "\u0008", // terminals send the backspace byte for Ctrl+H
  ctrlL: "\u000c",
  ctrlP: "\u0010",
  ctrlS: "\u0013",
  ctrlW: "\u0017",
  enter: "\r",
  escape: "\u001b",
  arrowDown: "\u001b[B",
  arrowUp: "\u001b[A",
} as const;

export const createFakeTTY = (columns = 80, rows = 24): FakeTTY => {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream & PassThrough;
  (stdout as unknown as { columns: number }).columns = columns;
  (stdout as unknown as { rows: number }).rows = rows;
  (stdout as unknown as { isTTY: boolean }).isTTY = true;

  const stdin = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough;
  (stdin as unknown as { isTTY: boolean }).isTTY = true;
  (stdin as unknown as { setRawMode: (value: boolean) => void }).setRawMode = () => undefined;
  (stdin as unknown as { ref: () => void }).ref = () => undefined;
  (stdin as unknown as { unref: () => void }).unref = () => undefined;

  let output = "";
  (stdout as unknown as PassThrough).on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const pressKey = (keyValue: string): void => {
    const data = Buffer.from(keyValue, "utf8");
    (stdin as unknown as PassThrough).write(data);
    stdin.emit("data", data);
    stdin.emit("keypress", keyValue, { name: keyValue, sequence: keyValue });
  };

  // Ink applies key-triggered state updates on the next render; pressing keys
  // back-to-back in the same tick would hit stale component state.
  const press = async (keyValue: string, settleMs = 120): Promise<void> => {
    pressKey(keyValue);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  };

  // The last full frame Ink rendered. In incremental mode frames are
  // separated by erase-lines bursts (ESC[2K ESC[1A ... ESC[2K ESC[G); the
  // legacy full-clear delimiter (ESC[2J) is kept for compatibility.
  // Assertions against it see current state, not stale history.
  const FRAME_DELIMITER = /(?:\u001b\[2K\u001b\[1A)+\u001b\[2K\u001b\[G|\u001b\[2J/g;
  const getLastFrame = (): string => {
    const frames = output.split(FRAME_DELIMITER);
    return frames[frames.length - 1] ?? "";
  };

  const waitForOutput = async (
    predicate: (value: string) => boolean,
    timeoutMs = 500
  ): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate(output)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return predicate(output);
  };

  return {
    stdout,
    stdin,
    getOutput: () => output,
    getLastFrame,
    pressKey,
    press,
    waitForOutput,
  };
};

export const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

export const waitNextTick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
