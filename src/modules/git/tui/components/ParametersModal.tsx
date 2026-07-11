import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CommandParameters, ParameterDescriptor, ParameterSource } from "../../core/parameters.js";
import { t } from "../../../../i18n/index.js";

export type ParametersModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  parameters: CommandParameters[];
};

type SourceBadge = { label: string; color?: string };

type ModalLine = {
  key: string;
  content: React.ReactNode;
};

const resolveSourceBadge = (source: ParameterSource): SourceBadge => {
  switch (source) {
    case "env":
      return { label: t("parametersModal.source.env"), color: "green" };
    case "resolved":
      return { label: t("parametersModal.source.resolved"), color: "red" };
    case "default":
      return { label: t("parametersModal.source.default"), color: "blue" };
    case "cli":
      return { label: t("parametersModal.source.cli") };
    case "prompt":
    default:
      return { label: t("parametersModal.source.prompt") };
  }
};

const sortParameters = (parameters: ParameterDescriptor[]): ParameterDescriptor[] => {
  const indexed = parameters.map((param, index) => ({ param, index }));
  indexed.sort((a, b) => {
    if (a.param.name === "envFile" && b.param.name !== "envFile") {
      return -1;
    }
    if (a.param.name !== "envFile" && b.param.name === "envFile") {
      return 1;
    }
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.param);
};

const formatParameterLine = (param: ParameterDescriptor): React.ReactNode => {
  const badge = resolveSourceBadge(param.source);
  const value = param.value ? param.value : "-";
  return (
    <Text>
      {`  ${param.name} [`}
      <Text color={badge.color}>{badge.label}</Text>
      {`]: ${value}`}
    </Text>
  );
};

const buildLines = (groups: CommandParameters[]): ModalLine[] => {
  if (groups.length === 0) {
    return [{ key: "empty", content: <Text>{t("parametersModal.empty")}</Text> }];
  }
  const lines: ModalLine[] = [];
  groups.forEach((group) => {
    const title = `${group.label} (${group.command})`;
    lines.push({ key: `title-${group.command}`, content: <Text>{`• ${title}`}</Text> });
    if (group.parameters.length === 0) {
      lines.push({
        key: `empty-${group.command}`,
        content: <Text dimColor>{`  ${t("parametersModal.emptyGroup")}`}</Text>,
      });
    }
    sortParameters(group.parameters).forEach((param, index) => {
      lines.push({ key: `${group.command}-${param.name}-${index}`, content: formatParameterLine(param) });
      if (param.description) {
        lines.push({
          key: `${group.command}-${param.name}-desc-${index}`,
          content: <Text dimColor>{`    ${param.description}`}</Text>,
        });
      }
    });
    lines.push({ key: `spacer-${group.command}`, content: <Text> </Text> });
  });
  return lines;
};

export const ParametersModal: React.FC<ParametersModalProps> = ({ isOpen, width, height, parameters }) => {
  const backgroundColor = "#2C2C2C";
  const [scrollOffset, setScrollOffset] = useState(0);
  const lines = useMemo(() => buildLines(parameters), [parameters]);
  const headerHeight = 2;
  const contentHeight = Math.max(1, height - headerHeight - 2 - 1);
  const maxOffset = Math.max(0, lines.length - contentHeight);

  useEffect(() => {
    setScrollOffset(0);
  }, [isOpen, parameters]);

  useInput(
    (_input, key) => {
      if (!isOpen) {
        return;
      }
      if (key.upArrow) {
        setScrollOffset((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((current) => Math.min(maxOffset, current + 1));
        return;
      }
      if (key.pageUp) {
        setScrollOffset((current) => Math.max(0, current - contentHeight));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((current) => Math.min(maxOffset, current + contentHeight));
      }
    },
    { isActive: isOpen }
  );

  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box flexDirection="column">
        <Text color="cyan" backgroundColor={backgroundColor}>
          {t("parametersModal.title")}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {t("parametersModal.hint")}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} height={contentHeight}>
        {visibleLines.map((line) => (
          <Text key={line.key} backgroundColor={backgroundColor}>
            {line.content}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
