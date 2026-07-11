import pino from "pino";
import pinoPretty from "pino-pretty";
import path from "node:path";
import { ensurePajeDirs, resolvePajePaths } from "./persistence.js";

export type LogLevel = "info" | "warn" | "error";

export const resolveLogFilePath = (): string => {
  const paths = resolvePajePaths();
  ensurePajeDirs(paths);
  const date = new Date().toISOString().slice(0, 10);
  return path.join(paths.logsDir, `git-sync-${date}.log`);
};

// A single shared pino instance per log file: each pino destination (SonicBoom)
// holds an open fd and process exit listeners, so per-component instances
// (Layout, menu, prompts) would leak fds and trigger MaxListeners warnings
// that corrupt the Ink UI when printed to stderr.
const sharedFileLoggers = new Map<string, pino.Logger>();

const getSharedFileLogger = (filePath: string): pino.Logger => {
  let logger = sharedFileLoggers.get(filePath);
  if (!logger) {
    logger = pino(
      { level: "info", base: null },
      pinoPretty({
        colorize: false,
        sync: true,
        translateTime: "yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname",
        destination: filePath,
      })
    );
    sharedFileLoggers.set(filePath, logger);
  }
  return logger;
};

export class PajeLogger {
  private readonly pinoInst: pino.Logger;

  constructor() {
    this.pinoInst = getSharedFileLogger(resolveLogFilePath());
  }

  info(message: string): void {
    this.pinoInst.info(message);
  }

  warn(message: string): void {
    this.pinoInst.warn(message);
  }

  error(message: string): void {
    this.pinoInst.error(message);
  }
}
