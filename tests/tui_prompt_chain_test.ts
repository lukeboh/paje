import assert from "node:assert/strict";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { createFakeTTY, KEYS, stripAnsi } from "./tui_test_utils.js";

// Regression test for a race condition in createPromptResolver (tuiSession.tsx):
// resolving a prompt's promise happened before its Ink instance was unmounted.
// Chaining two prompts back-to-back with no I/O in between (as
// promptValidBaseUrl -> promptForm does in gitCommand.ts) let the second
// prompt's render() land on the still-live instance from the first prompt,
// which was then unmounted out from under it a tick later — killing input
// listeners and leaving the second prompt's promise unresolved forever.

const tty = createFakeTTY();
const originalStdout = process.stdout;
const originalStdin = process.stdin;
Object.defineProperty(process, "stdout", { value: tty.stdout, configurable: true });
Object.defineProperty(process, "stdin", { value: tty.stdin, configurable: true });

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};

try {
  const session = createTuiSession("test");

  const runner = (async () => {
    const first = await session.promptInput({ title: "T1", message: "Field One" });
    const second = await session.promptInput({ title: "T2", message: "Field Two" });
    return { first, second };
  })();

  await tty.waitForOutput((out) => stripAnsi(out).includes("Field One"));
  await tty.press(KEYS.enter);

  const sawSecondPrompt = await tty.waitForOutput((out) => stripAnsi(out).includes("Field Two"), 1000);
  assert.ok(sawSecondPrompt, "Second chained prompt must render after the first resolves");

  await tty.press(KEYS.enter);

  const result = await withTimeout(runner, 2000, "chained prompts to resolve");
  assert.strictEqual(result.first, "");
  assert.strictEqual(result.second, "");
} finally {
  Object.defineProperty(process, "stdout", { value: originalStdout, configurable: true });
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
}

console.log("tui_prompt_chain_test: OK");
