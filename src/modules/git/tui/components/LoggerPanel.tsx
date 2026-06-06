import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { LogEntry, LogLevel } from "../logger.js";

export type LoggerPanelProps = {
  entries: LogEntry[];
  height: number;
};

type LevelStyle = {
  badgeColor?: string;
  textColor?: string;
  badgeBold?: boolean;
  dimColor?: boolean;
};

const LEVEL_STYLES: Record<LogLevel, LevelStyle> = {
  debug: { dimColor: true },
  info: { badgeColor: "cyan" },
  warn: { badgeColor: "yellow", textColor: "yellow" },
  error: { badgeColor: "red", textColor: "red", badgeBold: true },
};

type LogLine = {
  id: string;
  timestamp: string;
  badge: string;
  text: string;
  style: LevelStyle;
};

const splitMessage = (message: string): { badge: string; text: string } => {
  // Messages from createGlobalPanelTransport arrive as "[LEVEL] actual text"
  const bracketEnd = message.indexOf("] ");
  if (bracketEnd >= 0) {
    return { badge: message.slice(0, bracketEnd + 2), text: message.slice(bracketEnd + 2) };
  }
  return { badge: "", text: message };
};

const LoggerPanelComponent: React.FC<LoggerPanelProps> = ({ entries, height }) => {
  const lines = useMemo((): LogLine[] => {
    if (height <= 0) return [];
    return entries.slice(-height).map((entry) => {
      const { badge, text } = splitMessage(entry.message);
      return { id: entry.id, timestamp: entry.timestamp, badge, text, style: LEVEL_STYLES[entry.level] };
    });
  }, [entries, height]);

  return (
    <Box flexDirection="column" width="100%" height={height}>
      {lines.map((line) => (
        <Box key={line.id} flexDirection="row">
          <Text dimColor>{`[${line.timestamp}] `}</Text>
          {line.badge ? (
            <Text color={line.style.badgeColor} bold={line.style.badgeBold} dimColor={line.style.dimColor}>
              {line.badge}
            </Text>
          ) : null}
          <Text color={line.style.textColor} dimColor={line.style.dimColor}>
            {line.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

const isSameLogState = (prev: LoggerPanelProps, next: LoggerPanelProps): boolean => {
  if (prev.height !== next.height) return false;
  if (prev.entries.length !== next.entries.length) return false;
  const prevLast = prev.entries[prev.entries.length - 1];
  const nextLast = next.entries[next.entries.length - 1];
  return prevLast?.id === nextLast?.id;
};

export const LoggerPanel = React.memo(LoggerPanelComponent, isSameLogState);
