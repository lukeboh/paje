import React from "react";
import { Box, Text, useInput } from "ink";
import { t } from "../../../../i18n/index.js";

export type ExcludeModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  label: string;
  pattern: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ExcludeModal: React.FC<ExcludeModalProps> = ({
  isOpen,
  width,
  height,
  label,
  pattern,
  onConfirm,
  onCancel,
}) => {
  const backgroundColor = "#2C2C2C";

  useInput(
    (_input, key) => {
      if (!isOpen) {
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        onConfirm();
      }
    },
    { isActive: isOpen }
  );

  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor="red" paddingX={1}>
      <Box flexDirection="column">
        <Text color="red" backgroundColor={backgroundColor}>
          {t("excludeModal.title")}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {t("excludeModal.hint")}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text backgroundColor={backgroundColor}>{t("excludeModal.message", { label })}</Text>
        <Text backgroundColor={backgroundColor} color="yellow">
          {pattern}
        </Text>
      </Box>
    </Box>
  );
};
