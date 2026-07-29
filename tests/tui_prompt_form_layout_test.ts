import assert from "node:assert/strict";
import { createTuiSession } from "../src/modules/git/tuiSession.js";
import { createFakeTTY, KEYS, stripAnsi } from "./tui_test_utils.js";

// Regression coverage for the promptForm layout redesign:
// 1. A field value longer than its input box is never silently cut off —
//    it truncates from the START (a leading "…"), keeping the END visible,
//    since typing always appends there (that's where the active cursor is).
// 2. The focused field's description gets a dedicated, prominent side panel
//    instead of sharing a single crowded line with keybinding hints in the
//    orientation bar; it updates as focus moves between fields, and shows
//    an explicit fallback when a field has no description.
// 3. On a narrow terminal, the panel doesn't squeeze the inputs — it stacks
//    below the field list instead of beside it, but the description is
//    still shown somewhere.

const withPatchedStdio = async <T,>(
  tty: ReturnType<typeof createFakeTTY>,
  fn: () => Promise<T>
): Promise<T> => {
  const originalStdout = process.stdout;
  const originalStdin = process.stdin;
  Object.defineProperty(process, "stdout", { value: tty.stdout, configurable: true });
  Object.defineProperty(process, "stdin", { value: tty.stdin, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "stdout", { value: originalStdout, configurable: true });
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  }
};

const longUrl = "https://git.tse.jus.br/very/long/path/that/does/not/fit/in/one/single/box/at/all";

// --- Parte 1: terminal largo — painel lateral, truncamento, fallback ---

{
  const tty = createFakeTTY(100, 24);
  await withPatchedStdio(tty, async () => {
    const session = createTuiSession("test");

    const formPromise = session.promptForm<{ baseUrl: string; serverName: string }>({
      title: "Git Server",
      fields: [
        {
          name: "baseUrl",
          label: "Server base URL",
          defaultValue: longUrl,
          description: "URL do servidor. Aceita GitLab ou GitHub.",
        },
        {
          name: "serverName",
          label: "Server name",
          defaultValue: "GIT-TSE",
        },
      ],
    });

    await tty.waitForOutput((out) => stripAnsi(out).includes("Server base URL"));
    const frame1 = stripAnsi(tty.getLastFrame());

    assert.ok(frame1.includes("…"), "Valor mais largo que a caixa deve mostrar reticências indicando texto oculto");
    assert.ok(
      frame1.includes("does/not/fit/in/one/single/box/at/all"),
      "O final do valor (onde o usuário está digitando) deve permanecer visível"
    );
    assert.ok(
      !frame1.includes("https://git.tse.jus.br/very/long"),
      "O início do valor deve ficar oculto atrás das reticências, não o fim"
    );
    assert.ok(frame1.includes("About this field"), "Painel de descrição do campo focado deve aparecer");
    // A descrição pode quebrar em múltiplas linhas dentro do painel estreito
    // (bordas/quebra de linha entre palavras) — verifica fragmentos curtos em
    // vez da frase inteira, que poderia ficar dividida entre duas linhas.
    assert.ok(
      frame1.includes("URL do servidor") && frame1.includes("GitLab") && frame1.includes("GitHub"),
      "Painel deve mostrar a descrição do campo atualmente focado"
    );

    await tty.press(KEYS.tab);
    const frame2 = stripAnsi(tty.getLastFrame());
    assert.ok(frame2.includes("Server name"), "Painel deve atualizar para o campo recém-focado");
    // A frase de fallback também pode quebrar entre linhas no painel estreito.
    assert.ok(
      (frame2.includes("No additional description") && frame2.includes("this field")) ||
        (frame2.includes("Sem descrição adicional") && frame2.includes("este campo")),
      "Campo sem descrição deve mostrar um texto de fallback explícito, não ficar em branco"
    );

    await tty.press(KEYS.escape);
    const result = await formPromise;
    assert.equal(result, null, "Esc deve cancelar o formulário");
  });
}

// --- Parte 2: terminal estreito — sem painel lateral, mas descrição visível ---

{
  const tty = createFakeTTY(50, 24);
  await withPatchedStdio(tty, async () => {
    const session = createTuiSession("test");

    const formPromise = session.promptForm<{ baseUrl: string }>({
      title: "Git Server",
      fields: [
        {
          name: "baseUrl",
          label: "Server base URL",
          defaultValue: "https://gitlab.com",
          description: "URL do servidor.",
        },
      ],
    });

    await tty.waitForOutput((out) => stripAnsi(out).includes("Server base URL"));
    const frame = stripAnsi(tty.getLastFrame());
    assert.ok(
      frame.includes("URL do servidor."),
      "Mesmo em terminal estreito (painel lateral desativado), a descrição do campo deve continuar visível"
    );

    await tty.press(KEYS.escape);
    await formPromise;
  });
}

console.log("tui_prompt_form_layout_test: OK");
