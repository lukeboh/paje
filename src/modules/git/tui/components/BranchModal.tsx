import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { t } from "../../../../i18n/index.js";

export type BranchChoice = {
  name: string;
  isNew?: boolean;
  isRename?: boolean;
  oldName?: string;
};

export type BranchModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  branches: string[];
  currentBranch?: string;
  onConfirm: (choice: BranchChoice) => void;
  onCancel: () => void;
};

type ModalLine = {
  key: string;
  content: React.ReactNode;
  selectable: boolean;
  choice?: BranchChoice;
  startsRename?: boolean;
};

type InputMode = "list" | "create" | "rename";

const normalizeBranch = (value?: string): string => (value ?? "").trim();

const buildLines = (branches: string[], currentBranch?: string): ModalLine[] => {
  const normalized = normalizeBranch(currentBranch);
  const lines: ModalLine[] = [];
  const sorted = [...branches].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  if (sorted.length === 0) {
    lines.push({
      key: "empty",
      content: <Text dimColor>{t("branchModal.empty")}</Text>,
      selectable: false,
    });
  } else {
    sorted.forEach((branch, index) => {
      const isCurrent = normalized.length > 0 && branch === normalized;
      const label = isCurrent ? t("branchModal.current", { branch }) : branch;
      lines.push({
        key: `branch-${index}-${branch}`,
        content: <Text>{label}</Text>,
        selectable: true,
        choice: { name: branch },
      });
    });
  }

  lines.push({
    key: "divider",
    content: <Text dimColor>{" "}</Text>,
    selectable: false,
  });
  lines.push({
    key: "create",
    content: <Text>{t("branchModal.createOption")}</Text>,
    selectable: true,
    choice: { name: "", isNew: true },
  });
  if (normalized.length > 0) {
    lines.push({
      key: "rename",
      content: <Text>{t("branchModal.renameOption")}</Text>,
      selectable: true,
      startsRename: true,
    });
  }

  return lines;
};

export const BranchModal: React.FC<BranchModalProps> = ({
  isOpen,
  width,
  height,
  branches,
  currentBranch,
  onConfirm,
  onCancel,
}) => {
  const backgroundColor = "#2C2C2C";
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<InputMode>("list");
  const [inputValue, setInputValue] = useState("");
  const headerHeight = 2;
  const contentHeight = Math.max(1, height - headerHeight - 2);
  const lines = useMemo(() => buildLines(branches, currentBranch), [branches, currentBranch]);
  const selectableIndexes = useMemo(
    () => lines.map((line, index) => (line.selectable ? index : -1)).filter((index) => index >= 0),
    [lines]
  );

  const clampSelectedIndex = (nextIndex: number): number => {
    if (selectableIndexes.length === 0) {
      return 0;
    }
    if (!selectableIndexes.includes(nextIndex)) {
      const fallback = selectableIndexes.find((index) => index >= nextIndex) ?? selectableIndexes[0];
      return fallback ?? 0;
    }
    return nextIndex;
  };

  const ensureVisible = (nextIndex: number): void => {
    if (nextIndex < scrollOffset) {
      setScrollOffset(nextIndex);
      return;
    }
    if (nextIndex >= scrollOffset + contentHeight) {
      setScrollOffset(Math.max(0, nextIndex - contentHeight + 1));
    }
  };

  const maxOffset = Math.max(0, lines.length - contentHeight);

  useEffect(() => {
    setScrollOffset(0);
    setSelectedIndex(clampSelectedIndex(0));
    setMode("list");
    setInputValue("");
  }, [isOpen, branches, currentBranch]);

  useInput(
    (input, key) => {
      if (!isOpen) {
        return;
      }
      if (mode !== "list") {
        if (key.escape) {
          setMode("list");
          setInputValue("");
          return;
        }
        if (key.return) {
          const trimmed = inputValue.trim();
          if (trimmed.length === 0) {
            return;
          }
          if (mode === "rename") {
            onConfirm({ name: trimmed, isRename: true, oldName: normalizeBranch(currentBranch) });
          } else {
            onConfirm({ name: trimmed, isNew: true });
          }
          return;
        }
        if (key.backspace || key.delete) {
          setInputValue((current) => current.slice(0, -1));
          return;
        }
        if (key.ctrl || key.meta) {
          return;
        }
        if (input) {
          setInputValue((current) => `${current}${input}`);
        }
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }
      if (key.upArrow) {
        const currentIndex = clampSelectedIndex(selectedIndex);
        const currentPos = selectableIndexes.indexOf(currentIndex);
        const nextPos = Math.max(0, currentPos - 1);
        const nextIndex = selectableIndexes[nextPos] ?? currentIndex;
        setSelectedIndex(nextIndex);
        ensureVisible(nextIndex);
        return;
      }
      if (key.downArrow) {
        const currentIndex = clampSelectedIndex(selectedIndex);
        const currentPos = selectableIndexes.indexOf(currentIndex);
        const nextPos = Math.min(selectableIndexes.length - 1, currentPos + 1);
        const nextIndex = selectableIndexes[nextPos] ?? currentIndex;
        setSelectedIndex(nextIndex);
        ensureVisible(nextIndex);
        return;
      }
      if (key.pageUp) {
        const nextIndex = clampSelectedIndex(Math.max(0, selectedIndex - contentHeight));
        setSelectedIndex(nextIndex);
        ensureVisible(nextIndex);
        return;
      }
      if (key.pageDown) {
        const nextIndex = clampSelectedIndex(Math.min(lines.length - 1, selectedIndex + contentHeight));
        setSelectedIndex(nextIndex);
        ensureVisible(nextIndex);
        return;
      }
      if (key.return) {
        const line = lines[selectedIndex];
        if (line?.startsRename) {
          setMode("rename");
          setInputValue(normalizeBranch(currentBranch));
          return;
        }
        const choice = line?.choice;
        if (!choice) {
          return;
        }
        if (choice.isNew) {
          setMode("create");
          setInputValue("");
          return;
        }
        onConfirm(choice);
      }
    },
    { isActive: isOpen }
  );

  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);
  const inputHint =
    mode === "rename" ? t("branchModal.hintRename") : mode === "create" ? t("branchModal.hintCreate") : t("branchModal.hint");
  const inputLabel = mode === "rename" ? t("branchModal.newNameLabel") : t("branchModal.newBranchLabel");

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
          {t("branchModal.title")}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {inputHint}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} height={contentHeight}>
        {mode !== "list" ? (
          <Box flexDirection="column">
            <Text>{inputLabel}</Text>
            <Box marginTop={1} borderStyle="round" borderColor="cyan">
              <Text> {inputValue}</Text>
            </Box>
          </Box>
        ) : (
          visibleLines.map((line, index) => {
            const absoluteIndex = scrollOffset + index;
            const isSelected = absoluteIndex === selectedIndex && line.selectable;
            return (
              <Text key={line.key} backgroundColor={backgroundColor} color={isSelected ? "cyan" : undefined}>
                {isSelected ? "> " : "  "}
                {line.content}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
};
