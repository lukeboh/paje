import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { t } from "../../../../i18n/index.js";

export type TextInputModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  title: string;
  label: string;
  initialValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

// Plain single-field text prompt — same hand-rolled char-by-char input
// BranchModal already uses for its "+ Criar nova branch" sub-state, lifted
// out as its own modal for flows that need just a name (e.g. the bulk
// checkout branch name) without a branch list around it.
export const TextInputModal: React.FC<TextInputModalProps> = ({
  isOpen,
  width,
  height,
  title,
  label,
  initialValue,
  onConfirm,
  onCancel,
}) => {
  const backgroundColor = "#2C2C2C";
  const [value, setValue] = useState(initialValue ?? "");

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue ?? "");
    }
  }, [isOpen, initialValue]);

  useInput(
    (input, key) => {
      if (!isOpen) {
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          onConfirm(trimmed);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setValue((current) => current.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta) {
        return;
      }
      if (input) {
        setValue((current) => `${current}${input}`);
      }
    },
    { isActive: isOpen }
  );

  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="column">
        <Text color="cyan" backgroundColor={backgroundColor}>
          {title}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {t("textInputModal.hint")}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text backgroundColor={backgroundColor}>{label}</Text>
        <Box marginTop={1} borderStyle="round" borderColor="cyan">
          <Text> {value}</Text>
        </Box>
      </Box>
    </Box>
  );
};
