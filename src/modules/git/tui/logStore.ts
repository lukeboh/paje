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

// A burst of rapid entries (e.g. raw git progress lines during a clone,
// arriving every few ms) used to trigger one full-frame Ink re-render per
// line — each one erases and rewrites the whole screen, and at that
// frequency only the log panel's content actually changes between erases,
// which reads as that region flickering. Throttling to one notify per
// window (leading edge immediate, trailing edge coalescing anything that
// arrived during the window) keeps updates responsive without redrawing
// faster than a human can read them.
const NOTIFY_THROTTLE_MS = 80;

class LogStore {
  private entries: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private minLevel: LogLevel = "warn";
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyPending = false;

  append(message: string, level: LogLevel = "info"): void {
    this.appendEntry(createLogEntry(message, level));
  }

  appendEntry(entry: LogEntry): void {
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    this.entries = [...this.entries, entry];
    this.scheduleNotify();
  }

  replace(entries: LogEntry[]): void {
    this.entries = [...entries];
    this.scheduleNotify();
  }

  clear(): void {
    this.entries = [];
    this.scheduleNotify();
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

  private scheduleNotify(): void {
    if (this.throttleTimer) {
      this.notifyPending = true;
      return;
    }
    this.notify();
    this.armThrottleWindow();
  }

  // Keeps re-arming its own window for as long as activity keeps arriving —
  // a plain "leading notify + one trailing catch-up" would go back to
  // "ready" the instant the trailing notify fires, so a steady stream of
  // entries spaced close to the window length (e.g. git progress lines
  // every ~40ms against an 80ms window) would slip through at nearly full
  // rate instead of being capped to one notify per window.
  private armThrottleWindow(): void {
    this.throttleTimer = setTimeout(() => {
      if (this.notifyPending) {
        this.notifyPending = false;
        this.notify();
        this.armThrottleWindow();
        return;
      }
      this.throttleTimer = null;
    }, NOTIFY_THROTTLE_MS);
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
