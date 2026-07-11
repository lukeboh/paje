import { useEffect, useMemo, useRef, useState } from "react";
import { createLogEntry, type LogEntry, type LogLevel } from "./logger.js";
import { t } from "../../../i18n/index.js";

export type LogListener = (entries: LogEntry[]) => void;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class LogStore {
  private entries: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private minLevel: LogLevel = "warn";

  append(message: string, level: LogLevel = "info"): void {
    this.appendEntry(createLogEntry(message, level));
  }

  appendEntry(entry: LogEntry): void {
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    this.entries = [...this.entries, entry];
    this.notify();
  }

  replace(entries: LogEntry[]): void {
    this.entries = [...entries];
    this.notify();
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.entries;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

const logStore = new LogStore();

export const appendLogEntry = (message: string, level: LogLevel = "info"): void => {
  logStore.append(message, level);
};

export const appendLogRecord = (entry: LogEntry): void => {
  logStore.appendEntry(entry);
};

export const clearLogEntries = (): void => {
  logStore.clear();
};

export const setLogLevel = (level: LogLevel): void => {
  logStore.setMinLevel(level);
};

export const getLogLevel = (): LogLevel => logStore.getMinLevel();

export const getLogEntries = (): LogEntry[] => logStore.getEntries();

export const subscribeLogEntries = (listener: LogListener): (() => void) => {
  return logStore.subscribe(listener);
};

export const useLogEntries = (): LogEntry[] => {
  const [entries, setEntries] = useState<LogEntry[]>(() => logStore.getEntries());
  const initRef = useRef(false);

  useEffect(() => {
    return logStore.subscribe((next) => setEntries(next));
  }, []);

  useEffect(() => {
    if (initRef.current) {
      return;
    }
    initRef.current = true;
    if (logStore.getEntries().length === 0) {
      appendLogEntry(t("app.description"));
    }
  }, []);

  return useMemo(() => entries, [entries]);
};
