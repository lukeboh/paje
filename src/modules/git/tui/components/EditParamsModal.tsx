import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { CommandParameters, ParameterSource } from "../../core/parameters.js";
import { writeEnvYamlUpdates } from "../../persistence.js";
import { t } from "../../../../i18n/index.js";

export type EditParamsModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  parameters: CommandParameters[];
  envFilePath?: string;
  onClose?: () => void;
  // Reports the keys just written to disk so the caller (Layout) can merge
  // them into the `parameters` it passes back down. This modal unmounts
  // every time it closes (Layout only renders it while the modal is open),
  // so it cannot remember a save across an Esc/reopen by itself — the
  // caller must be the one holding onto that.
  onSaved?: (updates: Record<string, string>) => void;
};

type EditableItem = {
  groupLabel: string;
  name: string;
  description: string;
  value: string;
  source: ParameterSource;
  editable: boolean;
};

type SaveStatus = "idle" | "saved" | "error";

const isEditable = (name: string, source: ParameterSource): boolean => {
  if (name === "envFile") return false;
  if (source === "resolved" || source === "cli") return false;
  return true;
};

const buildEditableItems = (groups: CommandParameters[]): EditableItem[] => {
  const items: EditableItem[] = [];
  for (const group of groups) {
    for (const param of group.parameters) {
      if (param.name === "envFile") continue;
      items.push({
        groupLabel: group.label,
        name: param.name,
        description: param.description,
        value: param.value,
        source: param.source,
        editable: isEditable(param.name, param.source),
      });
    }
  }
  return items;
};

const sourceBadgeColor = (source: ParameterSource): string | undefined => {
  switch (source) {
    case "env":
      return "green";
    case "default":
      return "blue";
    case "cli":
      return "yellow";
    case "resolved":
      return "red";
    default:
      return undefined;
  }
};

export const EditParamsModal: React.FC<EditParamsModalProps> = ({
  isOpen,
  width,
  height,
  parameters,
  envFilePath,
  onClose,
  onSaved,
}) => {
  const backgroundColor = "#1E1E1E";
  const items = useMemo(() => buildEditableItems(parameters), [parameters]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setEditingIndex(null);
      setEditingValue("");
      setSaveStatus("idle");
    }
  }, [isOpen]);

  const startEditing = useCallback(() => {
    const item = items[selectedIndex];
    if (!item || !item.editable) return;
    const currentValue = pending.get(item.name) ?? item.value;
    setEditingValue(currentValue);
    setEditingIndex(selectedIndex);
    setSaveStatus("idle");
  }, [items, selectedIndex, pending]);

  const confirmEdit = useCallback(() => {
    const item = items[editingIndex!];
    if (!item) return;
    setPending((prev) => {
      const next = new Map(prev);
      next.set(item.name, editingValue);
      return next;
    });
    setEditingIndex(null);
    setEditingValue("");
  }, [items, editingIndex, editingValue]);

  const cancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditingValue("");
  }, []);

  const save = useCallback(() => {
    if (pending.size === 0) {
      setSaveStatus("saved");
      setSaveMessage(t("editParamsModal.noChanges"));
      return;
    }
    try {
      const updates: Record<string, string> = {};
      for (const [k, v] of pending.entries()) {
        updates[k] = v;
      }
      writeEnvYamlUpdates(updates, envFilePath);
      onSaved?.(updates);
      setPending(new Map());
      setSaveStatus("saved");
      setSaveMessage(
        t("editParamsModal.saved", { path: envFilePath ?? "~/.paje/env.yaml" })
      );
    } catch (err) {
      setSaveStatus("error");
      setSaveMessage(
        t("editParamsModal.saveError", { message: err instanceof Error ? err.message : String(err) })
      );
    }
  }, [pending, envFilePath, onSaved]);

  const isEditing = editingIndex !== null;
  // header: title + hint + status (3) | footer: selected item description (1)
  const headerHeight = 3;
  const footerHeight = 1;
  const contentHeight = Math.max(1, height - headerHeight - footerHeight - 2);

  const scrollOffset = useMemo(() => {
    const half = Math.floor(contentHeight / 2);
    return Math.max(0, Math.min(selectedIndex - half, items.length - contentHeight));
  }, [selectedIndex, contentHeight, items.length]);

  useInput(
    (input, key) => {
      if (!isOpen) return;

      if (isEditing) {
        if (key.return) {
          confirmEdit();
          return;
        }
        if (key.escape) {
          cancelEdit();
          return;
        }
        if (key.backspace || key.delete) {
          setEditingValue((v) => v.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setEditingValue((v) => v + input);
        }
        return;
      }

      if (key.escape) {
        onClose?.();
        return;
      }
      if (key.ctrl && input.toLowerCase() === "e") {
        onClose?.();
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (key.pageUp) {
        setSelectedIndex((i) => Math.max(0, i - contentHeight));
        return;
      }
      if (key.pageDown) {
        setSelectedIndex((i) => Math.min(items.length - 1, i + contentHeight));
        return;
      }
      if (key.return) {
        startEditing();
        return;
      }
      if (key.ctrl && input.toLowerCase() === "s") {
        save();
        return;
      }
    },
    { isActive: isOpen }
  );

  if (items.length === 0) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
      >
        <Text color="yellow">{t("editParamsModal.title")}</Text>
        <Text dimColor>{t("editParamsModal.noParams")}</Text>
      </Box>
    );
  }

  const visibleItems = items.slice(scrollOffset, scrollOffset + contentHeight);
  const selectedItem = items[selectedIndex];

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      <Box flexDirection="column">
        <Text wrap="truncate-end" color="yellow" backgroundColor={backgroundColor}>
          {t("editParamsModal.title")}
          {pending.size > 0 ? (
            <Text color="magenta">{`  [${t("editParamsModal.pendingCount", { count: String(pending.size) })}]`}</Text>
          ) : null}
        </Text>
        <Text wrap="truncate-end" dimColor backgroundColor={backgroundColor}>
          {isEditing ? t("editParamsModal.hintEditing") : t("editParamsModal.hint")}
        </Text>
        {saveStatus !== "idle" ? (
          <Text wrap="truncate-end" color={saveStatus === "saved" ? "green" : "red"} backgroundColor={backgroundColor}>
            {saveMessage}
          </Text>
        ) : (
          <Text backgroundColor={backgroundColor}> </Text>
        )}
      </Box>

      <Box flexDirection="column" height={contentHeight}>
        {visibleItems.map((item, relIdx) => {
          const absIdx = scrollOffset + relIdx;
          const isSelected = absIdx === selectedIndex;
          const isCurrentlyEditing = absIdx === editingIndex;
          const hasPending = pending.has(item.name);
          // Once saved, the up-to-date value/source come straight from
          // `item` — Layout merges saved overrides into the `parameters`
          // prop it passes down (see onSaved above), so there is no separate
          // "just saved" state to track here.
          const displayValue = hasPending ? pending.get(item.name)! : item.value;
          const badgeColor = sourceBadgeColor(item.source);

          const prefix = isSelected ? "> " : "  ";
          const bgColor = isSelected ? "#2E3440" : backgroundColor;

          if (isCurrentlyEditing) {
            return (
              <Text key={`${item.name}-${absIdx}`} wrap="truncate-end" backgroundColor={bgColor}>
                <Text color="cyan">{`${prefix}${item.name}: `}</Text>
                <Text backgroundColor="#003366" color="white">{` ${editingValue}`}</Text>
                <Text color="cyan">{"_"}</Text>
              </Text>
            );
          }

          return (
            <Text key={`${item.name}-${absIdx}`} wrap="truncate-end" backgroundColor={bgColor}>
              <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                {prefix}
                {item.name}
                {" ["}
              </Text>
              <Text color={hasPending ? "magenta" : badgeColor}>
                {hasPending ? t("editParamsModal.pendingBadge") : item.source}
              </Text>
              <Text color={isSelected ? "white" : undefined} bold={isSelected}>
                {"]: "}
              </Text>
              {!item.editable ? (
                <Text dimColor>
                  {item.source === "cli"
                    ? t("editParamsModal.cliLocked")
                    : t("editParamsModal.resolvedLocked")}
                </Text>
              ) : (
                <Text color={hasPending ? "magenta" : isSelected ? "cyan" : "white"}>
                  {displayValue || t("editParamsModal.emptyValue")}
                </Text>
              )}
            </Text>
          );
        })}
      </Box>

      <Text wrap="truncate-end" dimColor backgroundColor={backgroundColor}>
        {selectedItem?.description ? ` ${selectedItem.description}` : " "}
      </Text>
    </Box>
  );
};
