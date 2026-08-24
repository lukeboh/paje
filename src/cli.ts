import { Command } from "commander";
import { buildInitialParameters, configureGitSyncCommand, configureSshKeyStoreCommand } from "./modules/git/gitCommand";
import { renderMenu, type MenuItem } from "./modules/git/tui/menu.app";
import { appendLogEntry, setLogLevel } from "./modules/git/tui/logStore.js";
import { createScreenHost, type ScreenHost } from "./modules/git/tui/screenHost.js";
import { createSessionForCommand } from "./cliSession";
import { setLocale, t } from "./i18n/index.js";
import { PajeLogger } from "./modules/git/logger";
import { APP_VERSION } from "./version.js";

const buildMenuItems = (): MenuItem[] => [
  {
    label: t("menu.items.gitSync.label"),
    command: "git-sync",
    shortcut: "Ctrl+S",
    description: t("menu.items.gitSync.description"),
  },
  {
    label: t("menu.items.gitServerStore.label"),
    command: "git-server-store",
    shortcut: "Ctrl+G",
    description: t("menu.items.gitServerStore.description"),
  },
];

const resolveLocaleArg = (args: string[]): string | undefined => {
  const index = args.findIndex((arg) => arg === "--locale" || arg.startsWith("--locale="));
  if (index === -1) {
    return undefined;
  }
  const arg = args[index];
  if (arg.includes("=")) {
    const [, value] = arg.split("=");
    return value?.trim();
  }
  const candidate = args[index + 1];
  if (!candidate || candidate.startsWith("-")) {
    return undefined;
  }
  return candidate.trim();
};

const HELP_FLAGS = new Set(["--help", "-h", "--version", "-V"]);
const hasCommandArg = (args: string[]): boolean =>
  args.some((arg) => HELP_FLAGS.has(arg) || !arg.startsWith("-"));

const runMenu = async (
  locale: string | undefined,
  suppressInitialEscapeMs: number | undefined,
  appendLog: ((message: string) => void) | undefined,
  host: ScreenHost
) => {
  const parameters = buildInitialParameters(locale);
  const selection = await renderMenu(buildMenuItems(), parameters, { suppressInitialEscapeMs, appendLog }, host);
  return { selection };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const debugLogger = new PajeLogger();
  process.on("beforeExit", (code) => {
    debugLogger.info(`[TUI][CLI] beforeExit code=${code}`);
  });
  process.on("exit", (code) => {
    debugLogger.info(`[TUI][CLI] exit code=${code}`);
  });
  process.on("SIGINT", () => {
    debugLogger.info("[TUI][CLI] SIGINT received");
  });
  setLocale(resolveLocaleArg(args));

  const baseProgram = new Command();

  baseProgram
    .name("paje")
    .description(t("app.description"))
    .version(APP_VERSION)
    .option("--locale <locale>", t("cli.command.gitSync.options.locale"))
    .option("-v, --verbose", t("cli.command.gitSync.options.verbose"), false);

  configureGitSyncCommand(baseProgram);
  configureSshKeyStoreCommand(baseProgram);
  if (!hasCommandArg(args)) {
    baseProgram.parseOptions(process.argv);
    const options = baseProgram.opts<{ verbose?: boolean }>();
    setLogLevel(options.verbose ? "debug" : "info");
    let suppressInitialEscapeMs = 0;
    let justReturnedFromCommand = false;
    const appendMenuLog = options.verbose
      ? (message: string): void => {
          appendLogEntry(message, "debug");
        }
      : undefined;
    // Shared across the whole interactive loop — the menu and every command's
    // screens mount through this single persistent Ink instance, so moving
    // between them never disconnects one frame from the next.
    const host = createScreenHost();
    try {
      while (true) {
        debugLogger.info(
          `[TUI][CLI] runMenu start suppressInitialEscapeMs=${suppressInitialEscapeMs} justReturnedFromCommand=${justReturnedFromCommand}`
        );
        try {
          const { selection } = await runMenu(resolveLocaleArg(args), suppressInitialEscapeMs, appendMenuLog, host);
          debugLogger.info(
            `[TUI][CLI] runMenu result selection=${selection?.command ?? "null"} suppressInitialEscapeMs=${suppressInitialEscapeMs}`
          );
          if (!selection) {
            if (justReturnedFromCommand) {
              debugLogger.info("[TUI][CLI] selection null after command -> reloop");
              justReturnedFromCommand = false;
              suppressInitialEscapeMs = 0;
              continue;
            }
            debugLogger.info("[TUI][CLI] selection null -> exit");
            return;
          }
          const program = new Command();
          program
            .name("paje")
            .description(t("app.description"))
            .version(APP_VERSION)
            .option("--locale <locale>", t("cli.command.gitSync.options.locale"));
          const session = createSessionForCommand(selection.command, host);
          configureGitSyncCommand(program, session);
          configureSshKeyStoreCommand(program, session);
          await program.parseAsync(["node", "cli.ts", selection.command]);
          justReturnedFromCommand = true;
          suppressInitialEscapeMs = 300;
          debugLogger.info("[TUI][CLI] command finished -> return to menu");
        } catch (error) {
          debugLogger.info(`[TUI][CLI] runMenu error=${String(error)}`);
          throw error;
        }
      }
    } finally {
      host.destroy();
    }
  }

  await baseProgram.parseAsync(process.argv);
};

main();
