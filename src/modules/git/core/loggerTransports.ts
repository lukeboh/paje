import { appendLogRecord } from "../tui/logStore.js";
import { PajeLogger } from "../logger.js";
import type { LogEntry, LogLevel, LogTransport } from "./loggerBroker.js";

// The console transport MUST go through console.log/console.error: Ink patches
// the console to render output above the UI, so writing straight to fd 1 would
// corrupt the frame whenever a TUI is mounted.
export const createConsoleTransport = (name: string, minLevel: LogLevel): LogTransport => {
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
      if (entry.level === "error") {
        console.error(line);
        return;
      }
      console.log(line);
    },
  };
};

export const createFileTransport = (name: string, minLevel: LogLevel): LogTransport => {
  const logger = new PajeLogger();
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      if (entry.level === "debug") {
        logger.info(`[DEBUG] ${entry.message}`);
        return;
      }
      if (entry.level === "info") {
        logger.info(entry.message);
        return;
      }
      if (entry.level === "warn") {
        logger.warn(entry.message);
        return;
      }
      logger.error(entry.message);
    },
  };
};

export type PanelLogLevel = "debug" | "info" | "warn" | "error";
export type PanelLogAppend = (message: string, level?: PanelLogLevel) => void;

export const createPanelTransport = (
  name: string,
  minLevel: LogLevel,
  append: PanelLogAppend
): LogTransport => {
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      append(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`, entry.level);
    },
  };
};

export const createGlobalPanelTransport = (name: string, minLevel: LogLevel): LogTransport => {
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      appendLogRecord({
        id: `${entry.timestamp}-${Math.random().toString(16).slice(2)}`,
        message: `[${entry.level.toUpperCase()}] ${entry.message}`,
        level: entry.level,
        timestamp: entry.timestamp,
      });
    },
  };
};
