import React, { useMemo } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { t } from "../../../../i18n/index.js";

export type HelpContext = "menu" | "tree" | "loading";

export type HelpShortcut = {
  id: string;
  key: string;
  description: string;
  contexts: HelpContext[];
};

type HelpGroup = {
  id: string;
  title: string;
  shortcuts: HelpShortcut[];
};

export type HelpModalProps = {
  isOpen: boolean;
  width: number;
  height: number;
  context: HelpContext;
  logMaximized: boolean;
  workspaceMaximized: boolean;
  onClose: () => void;
  onShortcut: (input: string, key: Key, shortcut: HelpShortcut) => void;
};

type ModalLine = {
  key: string;
  content: React.ReactNode;
  enabled: boolean;
};

const splitShortcutKey = (value: string): string[] =>
  value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

const resolveShortcutKey = (input: string, key: Key): string | null => {
  if (key.ctrl) {
    const lower = input.toLowerCase();
    const ctrlMap: Record<string, string> = {
      c: "Ctrl+C",
      s: "Ctrl+S",
      g: "Ctrl+G",
      h: "Ctrl+H",
      p: "Ctrl+P",
      e: "Ctrl+E",
      f: "Ctrl+F",
      l: "Ctrl+L",
      w: "Ctrl+W",
      b: "Ctrl+B",
      x: "Ctrl+X",
    };
    if (ctrlMap[lower]) {
      return ctrlMap[lower];
    }
  }
  // Terminals send byte 0x08 for Ctrl+H, which Ink reports as key.backspace.
  if (key.backspace) {
    return "Ctrl+H";
  }
  if (key.return) {
    return "Enter";
  }
  if (key.escape) {
    return "Esc";
  }
  if (key.tab) {
    return "Tab";
  }
  if (key.pageUp) {
    return "PgUp";
  }
  if (key.pageDown) {
    return "PgDn";
  }
  if ((key as Key & { home?: boolean }).home) {
    return "Home";
  }
  if ((key as Key & { end?: boolean }).end) {
    return "End";
  }
  if (key.upArrow) {
    return "↑";
  }
  if (key.downArrow) {
    return "↓";
  }
  if (key.leftArrow) {
    return "←";
  }
  if (key.rightArrow) {
    return "→";
  }
  if (input === " ") {
    return "Espaço";
  }
  if (input && input.length === 1) {
    return input.toUpperCase();
  }
  return null;
};

const matchesShortcut = (shortcutKey: string, inputKey: string): boolean => {
  if (shortcutKey === inputKey) {
    return true;
  }
  return splitShortcutKey(shortcutKey).includes(inputKey);
};

const buildGroups = (options: { logMaximized: boolean; workspaceMaximized: boolean }): HelpGroup[] => {
  const logState = options.logMaximized ? t("helpModal.state.maximized") : t("helpModal.state.default");
  const workspaceState = options.workspaceMaximized ? t("helpModal.state.maximized") : t("helpModal.state.default");

  return [
    {
      id: "global",
      title: t("helpModal.groups.global"),
      shortcuts: [
        { id: "help", key: "Ctrl+H", description: t("helpModal.shortcuts.help"), contexts: ["menu", "tree", "loading"] },
        { id: "parameters", key: "Ctrl+P", description: t("helpModal.shortcuts.parameters"), contexts: ["menu", "tree", "loading"] },
        { id: "edit-params", key: "Ctrl+E", description: t("helpModal.shortcuts.editParams"), contexts: ["tree"] },
        {
          id: "workspace",
          key: "Ctrl+W",
          description: t("helpModal.shortcuts.workspace", { state: workspaceState }),
          contexts: ["menu", "tree", "loading"],
        },
        {
          id: "log",
          key: "Ctrl+L",
          description: t("helpModal.shortcuts.log", { state: logState }),
          contexts: ["menu", "tree", "loading"],
        },
        { id: "escape", key: "Esc", description: t("helpModal.shortcuts.escape"), contexts: ["menu", "tree", "loading"] },
        { id: "exit", key: "Ctrl+C", description: t("helpModal.shortcuts.ctrlC"), contexts: ["menu", "tree", "loading"] },
      ],
    },
    {
      id: "menu",
      title: t("helpModal.groups.menu"),
      shortcuts: [
        { id: "menu-select-git-sync", key: "Ctrl+S", description: t("helpModal.shortcuts.menu.gitSync"), contexts: ["menu"] },
        {
          id: "menu-select-git-server",
          key: "Ctrl+G",
          description: t("helpModal.shortcuts.menu.gitServerStore"),
          contexts: ["menu"],
        },
        { id: "menu-nav-horizontal", key: "←/→", description: t("helpModal.shortcuts.menu.navHorizontal"), contexts: ["menu"] },
        { id: "menu-nav-vertical", key: "↑/↓", description: t("helpModal.shortcuts.menu.navVertical"), contexts: ["menu"] },
        { id: "menu-tab", key: "Tab", description: t("helpModal.shortcuts.menu.tab"), contexts: ["menu"] },
        { id: "menu-confirm", key: "Enter", description: t("helpModal.shortcuts.menu.confirm"), contexts: ["menu"] },
        { id: "menu-shortcut-1", key: "1", description: t("helpModal.shortcuts.menu.slot1"), contexts: ["menu"] },
        { id: "menu-shortcut-2", key: "2", description: t("helpModal.shortcuts.menu.slot2"), contexts: ["menu"] },
      ],
    },
    {
      id: "tree",
      title: t("helpModal.groups.tree"),
      shortcuts: [
        { id: "tree-nav-vertical", key: "↑/↓", description: t("helpModal.shortcuts.tree.navVertical"), contexts: ["tree"] },
        { id: "tree-nav-page", key: "PgUp/PgDn", description: t("helpModal.shortcuts.tree.navPage"), contexts: ["tree"] },
        { id: "tree-nav-edge", key: "Home/End", description: t("helpModal.shortcuts.tree.navEdge"), contexts: ["tree"] },
        { id: "tree-toggle", key: "Espaço", description: t("helpModal.shortcuts.tree.toggle"), contexts: ["tree"] },
        { id: "tree-confirm", key: "Ctrl+S", description: t("helpModal.shortcuts.tree.confirm"), contexts: ["tree"] },
        { id: "tree-confirm-single", key: "Enter", description: t("helpModal.shortcuts.tree.confirmSingle"), contexts: ["tree"] },
        { id: "tree-search", key: "Ctrl+F", description: t("helpModal.shortcuts.tree.search"), contexts: ["tree"] },
        { id: "tree-filter", key: "Ctrl+X", description: t("helpModal.shortcuts.tree.filter"), contexts: ["tree"] },
        { id: "tree-branch", key: "Ctrl+B", description: t("helpModal.shortcuts.tree.branch"), contexts: ["tree"] },
      ],
    },
  ];
};

const buildLines = (groups: HelpGroup[], context: HelpContext): ModalLine[] => {
  const lines: ModalLine[] = [];
  groups.forEach((group) => {
    lines.push({ key: `group-${group.id}`, content: <Text>{group.title}</Text>, enabled: true });
    group.shortcuts.forEach((shortcut) => {
      const enabled = shortcut.contexts.includes(context);
      lines.push({
        key: `shortcut-${group.id}-${shortcut.id}`,
        enabled,
        content: (
          <Text>
            {`  ${shortcut.key} — ${shortcut.description}`}
          </Text>
        ),
      });
    });
    lines.push({ key: `spacer-${group.id}`, content: <Text>{" "}</Text>, enabled: true });
  });
  return lines;
};

export const HelpModal: React.FC<HelpModalProps> = ({
  isOpen,
  width,
  height,
  context,
  logMaximized,
  workspaceMaximized,
  onClose,
  onShortcut,
}) => {
  const backgroundColor = "#2C2C2C";
  const headerHeight = 2;
  const contentHeight = Math.max(1, height - headerHeight - 2 - 1);
  const groups = useMemo(() => buildGroups({ logMaximized, workspaceMaximized }), [logMaximized, workspaceMaximized]);
  const lines = useMemo(() => buildLines(groups, context), [groups, context]);

  useInput(
    (input, key) => {
      if (!isOpen) {
        return;
      }
      if (key.escape) {
        onClose();
        return;
      }
      const resolvedKey = resolveShortcutKey(input, key);
      if (!resolvedKey) {
        return;
      }
      const match = groups
        .flatMap((group) => group.shortcuts)
        .find((shortcut) => matchesShortcut(shortcut.key, resolvedKey));
      if (!match || !match.contexts.includes(context)) {
        return;
      }
      onClose();
      setTimeout(() => onShortcut(resolvedKey, key, match), 0);
    },
    { isActive: isOpen }
  );

  const visibleLines = lines.slice(0, contentHeight);

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
          {t("helpModal.title")}
        </Text>
        <Text dimColor backgroundColor={backgroundColor}>
          {t("helpModal.hint")}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} height={contentHeight}>
        {visibleLines.map((line) => (
          <Text key={line.key} backgroundColor={backgroundColor} dimColor={!line.enabled}>
            {line.content}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
