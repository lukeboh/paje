import React from "react";
import { Box, Text, useInput } from "ink";
import { t } from "../../../../i18n/index.js";

export type ConfirmModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  title: string;
  message: string;
  detail?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// Generic Enter-confirms/Esc-cancels modal — same shape ExcludeModal already
// used for a single specific case (excluding a tree node); this version
// takes its text as props so bulk branch operations (and anything else
// needing a plain confirmation) can reuse it instead of each growing its own
// near-identical modal.
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  width,
  height,
  title,
  message,
  detail,
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
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="column">
        <Text color="cyan" backgroundColor={backgroundColor}>
          {title}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {t("confirmModal.hint")}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text backgroundColor={backgroundColor}>{message}</Text>
        {detail ? (
          <Text backgroundColor={backgroundColor} color="yellow">
            {detail}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
};
