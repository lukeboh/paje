import pino from "pino";
import pinoPretty from "pino-pretty";
import { appendLogRecord } from "../tui/logStore.js";
import { resolveLogFilePath } from "../logger.js";
import type { LogEntry, LogLevel, LogTransport } from "./loggerBroker.js";

const PRETTY_TIMESTAMP_FORMAT = "yyyy-mm-dd HH:MM:ss";
const PRETTY_IGNORE = "pid,hostname";

const createPrettyConsoleTransport = (): pino.Logger =>
  pino(
    { level: "debug", base: null },
    pinoPretty({
      colorize: true,
      sync: true,
      translateTime: PRETTY_TIMESTAMP_FORMAT,
      ignore: PRETTY_IGNORE,
      destination: 1,
    })
  );

const createPrettyFileTransport = (): pino.Logger =>
  pino(
    { level: "debug", base: null },
    pinoPretty({
      colorize: false,
      sync: true,
      translateTime: PRETTY_TIMESTAMP_FORMAT,
      ignore: PRETTY_IGNORE,
      destination: resolveLogFilePath(),
    })
  );

export const createConsoleTransport = (name: string, minLevel: LogLevel): LogTransport => {
  const pinoInst = createPrettyConsoleTransport();
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      pinoInst[entry.level](entry.message);
    },
  };
};

export const createFileTransport = (name: string, minLevel: LogLevel): LogTransport => {
  const pinoInst = createPrettyFileTransport();
  return {
    name,
    minLevel,
    log: (entry: LogEntry) => {
      pinoInst[entry.level](entry.message);
    },
  };
};

export type PanelLogLevel = "debug" | "info" | "warn" | "error";
export type PanelLogAppend = (message: string, level?: PanelLogLevel) => void;

export const createPanelTransport = (
  name: string,
  minLevel: LogLevel,
  append: PanelLogAppend
): LogTransport => ({
  name,
  minLevel,
  log: (entry: LogEntry) => {
    append(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`, entry.level);
  },
});

export const createGlobalPanelTransport = (name: string, minLevel: LogLevel): LogTransport => ({
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
});
