import pino from "pino";
import { formatTimestamp } from "../tui/logger.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type LogTransport = {
  name: string;
  minLevel: LogLevel;
  log: (entry: LogEntry) => void;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Maps pino numeric levels to our LogLevel.
const normalizePinoLevel = (level: number): LogLevel => {
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  return "debug";
};

type PinoJsonEntry = {
  level: number;
  time: string | number;
  msg: string;
};

// Receives the serialised JSON lines written by pino and distributes them
// to all registered LogTransport instances after level filtering.
class BrokerStream {
  private readonly transports: LogTransport[] = [];

  hasTransport(name: string): boolean {
    return this.transports.some((t) => t.name === name);
  }

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  updateLevel(name: string, minLevel: LogLevel): void {
    const t = this.transports.find((item) => item.name === name);
    if (t) t.minLevel = minLevel;
  }

  write(chunk: string | Buffer): boolean {
    let obj: PinoJsonEntry;
    try {
      obj = JSON.parse(chunk.toString()) as PinoJsonEntry;
    } catch {
      return true;
    }

    const level = normalizePinoLevel(obj.level);
    const date = typeof obj.time === "string" ? new Date(obj.time) : new Date(obj.time);
    const entry: LogEntry = {
      level,
      message: obj.msg,
      timestamp: formatTimestamp(date),
    };
    const levelNum = LEVEL_ORDER[level];

    for (const transport of this.transports) {
      if (levelNum >= LEVEL_ORDER[transport.minLevel]) {
        transport.log(entry);
      }
    }
    return true;
  }

  // Required by the Node.js Writable duck-type used by pino.
  end(): void {}
}

export class LoggerBroker {
  private readonly stream: BrokerStream;
  private readonly pinoLogger: pino.Logger;

  constructor() {
    this.stream = new BrokerStream();
    this.pinoLogger = pino(
      { level: "debug", base: null, timestamp: pino.stdTimeFunctions.isoTime },
      this.stream
    );
  }

  hasTransport(name: string): boolean {
    return this.stream.hasTransport(name);
  }

  addTransport(transport: LogTransport): void {
    if (this.hasTransport(transport.name)) return;
    this.stream.addTransport(transport);
  }

  setTransportLevel(name: string, minLevel: LogLevel): void {
    this.stream.updateLevel(name, minLevel);
  }

  log(level: LogLevel, message: string): void {
    this.pinoLogger[level](message);
  }

  debug(message: string): void {
    this.log("debug", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }
}
