import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { LogEntry, LogLevel } from "../logger.js";

export type LoggerPanelProps = {
  entries: LogEntry[];
  height: number;
};

// Raw ANSI codes instead of Ink <Text color>: chalk disables colors when it
// cannot detect a real TTY, which would silently strip level colors (and is
// untestable). Manual codes render identically in every terminal.
const LEVEL_ANSI_COLOR: Record<LogLevel, number | null> = {
  debug: 90,
  info: null,
  warn: 33,
  error: 31,
};

const applyAnsiColor = (text: string, colorCode: number): string => {
  return `\u001b[${colorCode}m${text}\u001b[0m`;
};

const LoggerPanelComponent: React.FC<LoggerPanelProps> = ({ entries, height }) => {
  const visibleEntries = useMemo(() => {
    if (height <= 0) {
      return [];
    }
    return entries.slice(-height);
  }, [entries, height]);

  const lines = useMemo(() => {
    return visibleEntries.map((entry) => {
      const line = `[${entry.timestamp}] ${entry.message}`;
      const colorCode = LEVEL_ANSI_COLOR[entry.level];
      return {
        id: entry.id,
        output: colorCode === null ? line : applyAnsiColor(line, colorCode),
      };
    });
  }, [visibleEntries]);

  return (
    <Box flexDirection="column" width="100%" height={height}>
      {lines.map((line) => (
        // truncate-end keeps every entry on exactly one terminal row; a
        // wrapped line would push the panel beyond its frame height.
        <Text key={line.id} wrap="truncate-end">
          {line.output}
        </Text>
      ))}
    </Box>
  );
};

const isSameLogState = (prev: LoggerPanelProps, next: LoggerPanelProps): boolean => {
  if (prev.height !== next.height) {
    return false;
  }
  if (prev.entries.length !== next.entries.length) {
    return false;
  }
  const prevLast = prev.entries[prev.entries.length - 1];
  const nextLast = next.entries[next.entries.length - 1];
  return prevLast?.id === nextLast?.id;
};

export const LoggerPanel = React.memo(LoggerPanelComponent, isSameLogState);
