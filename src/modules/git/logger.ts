import pino from "pino";
import path from "node:path";
import { ensurePajeDirs, resolvePajePaths } from "./persistence.js";

export type LogLevel = "info" | "warn" | "error";

export const resolveLogFilePath = (): string => {
  const paths = resolvePajePaths();
  ensurePajeDirs(paths);
  const date = new Date().toISOString().slice(0, 10);
  return path.join(paths.logsDir, `git-sync-${date}.log`);
};

// Thin wrapper used by TUI components for internal debug logging.
// Writes JSON-structured lines to the daily log file via pino.
export class PajeLogger {
  private readonly pinoInst: pino.Logger;

  constructor() {
    const filePath = resolveLogFilePath();
    const dest = pino.destination({ dest: filePath, sync: true });
    this.pinoInst = pino(
      { level: "info", base: null, timestamp: pino.stdTimeFunctions.isoTime },
      dest
    );
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
