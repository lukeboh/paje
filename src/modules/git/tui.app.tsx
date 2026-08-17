import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { PajeLogger } from "./logger.js";
import type { CommandParameters } from "./core/parameters.js";
import { Layout } from "./tui/layout.js";
import { useLayoutMetrics, useModalStateController } from "./tui/layoutContext.js";
import { appendLogEntry } from "./tui/logStore.js";
import type { GitLabTreeNode, RepoSyncStatus, RepoSyncState } from "./types.js";
import type { TuiSession } from "./tuiSession.js";
import { filterTreeBySelection, filterTreeByText, recomputeTreeSelection, removeTreeNodes } from "./treeBuilder.js";
import { t } from "../../i18n/index.js";
import { checkoutBranch, createBranchAndPush, listLocalBranches, renameBranch, resolveRepoStatus } from "./core/gitBranchService.js";
import { readLocalRepoInfo } from "./gitRepoScanner.js";
import { splitFilterPatterns } from "./patternFilter.js";
import { writeEnvYamlUpdates } from "./persistence.js";

export type TuiSelectionMode = "all" | "single";

export type TuiSelectionResult = {
  confirmed: boolean;
  mode?: TuiSelectionMode;
  selectedNodeId?: string;
  nodes: GitLabTreeNode[];
};

type FlatTreeItem = {
  id: string;
  depth: number;
  label: string;
  serverName?: string;
  serverColor?: string;
  status?: RepoSyncStatus;
  progress?: string;
  selected: boolean;
  partiallySelected: boolean;
};

type ProgressSnapshot = {
  text?: string;
};

export type LoadingScreenOptions = {
  title?: string;
  message: string;
  orientation?: string;
  parameters?: CommandParameters[];
  spinnerFrames?: string[];
  intervalMs?: number;
};

export type LoadingScreenHandle = {
  stop: () => void;
};

const STATUS_COLOR: Record<RepoSyncState, string> = {
  SYNCED: "green",
  BEHIND: "red",
  AHEAD: "blue",
  REMOTE: "yellow",
  EMPTY: "magenta",
  LOCAL: "red",
  UNCOMMITTED: "red",
  DIVERGED: "red",
};

const SERVER_COLOR_PALETTE = ["cyan", "magenta", "yellow", "blue", "green", "white", "red"] as const;

const resolveServerColorMap = (nodes: GitLabTreeNode[]): Map<string, string> => {
  const seen = new Set<string>();
  const visit = (node: GitLabTreeNode): void => {
    const name = node.project?.pajeServerName;
    if (name) {
      seen.add(name);
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  const map = new Map<string, string>();
  Array.from(seen).forEach((name, index) => {
    map.set(name, SERVER_COLOR_PALETTE[index % SERVER_COLOR_PALETTE.length]);
  });
  return map;
};

const findParamValue = (groups: CommandParameters[] | undefined, name: string): string => {
  for (const group of groups ?? []) {
    const found = group.parameters.find((param) => param.name === name);
    if (found) {
      return found.value;
    }
  }
  return "";
};

const BRANCH_COLOR: Record<string, string> = {
  main: "cyan",
  master: "magenta",
  stable: "green",
  develop: "yellow",
  desenvolvimento: "yellow",
  feature: "magenta",
};

const resolveBranchColor = (branch: string): string | undefined => {
  const normalized = branch.trim().toLowerCase();
  if (normalized.startsWith("develop")) {
    return BRANCH_COLOR.develop;
  }
  if (normalized.startsWith("desenvolv")) {
    return BRANCH_COLOR.desenvolvimento;
  }
  if (normalized.startsWith("main")) {
    return BRANCH_COLOR.main;
  }
  if (normalized.startsWith("master")) {
    return BRANCH_COLOR.master;
  }
  if (normalized.startsWith("stable")) {
    return BRANCH_COLOR.stable;
  }
  if (normalized.startsWith("feature")) {
    return BRANCH_COLOR.feature;
  }
  return undefined;
};

const renderStatusLabel = (status: RepoSyncStatus): { branch: string; branchColor?: string; state: string; stateColor?: string } => {
  const state = status.state.toLowerCase();
  const delta = status.delta ? ` ${status.delta}` : "";
  const branchColor = resolveBranchColor(status.branch);
  const stateColor = STATUS_COLOR[status.state];
  return {
    branch: status.branch,
    branchColor,
    state: `${state}${delta}`,
    stateColor,
  };
};

const flattenTree = (
  items: GitLabTreeNode[],
  progressMap: Map<string, ProgressSnapshot>,
  depth = 0,
  serverColorMap?: Map<string, string>
): FlatTreeItem[] => {
  const output: FlatTreeItem[] = [];
  items.forEach((node) => {
    const serverName = node.project?.pajeServerName;
    output.push({
      id: node.id,
      depth,
      label: node.label,
      serverName,
      serverColor: serverName ? serverColorMap?.get(serverName) : undefined,
      status: node.status,
      progress: progressMap.get(node.id)?.text,
      selected: node.selected ?? false,
      partiallySelected: node.partiallySelected ?? false,
    });
    if (node.children && node.children.length > 0) {
      output.push(...flattenTree(node.children, progressMap, depth + 1, serverColorMap));
    }
  });
  return output;
};


const TreeRowComponent: React.FC<{ item: FlatTreeItem; selected: boolean }> = (
  { item, selected }: { item: FlatTreeItem; selected: boolean }
) => {
  const indicator = item.partiallySelected ? "[~]" : item.selected ? "[x]" : "[ ]";
  const indent = "  ".repeat(item.depth);
  const statusLabel = item.status ? renderStatusLabel(item.status) : null;
  const progressLabel = item.progress ? item.progress : "";
  const textColor = selected ? "white" : undefined;
  const backgroundColor = selected ? "blue" : undefined;
  const hasInfo = Boolean(item.serverName || statusLabel);

  return (
    <Box flexDirection="row" width="100%">
      <Text color={textColor} backgroundColor={backgroundColor}>
        {indent}
        {indicator} {item.label}
      </Text>
      <Box flexGrow={1} justifyContent="flex-end">
        {hasInfo && (
          <Text color={textColor} backgroundColor={backgroundColor}>
            {" "}[
            {item.serverName && (
              <Text color={item.serverColor ?? textColor}>{item.serverName}</Text>
            )}
            {item.serverName && statusLabel && (
              <Text color={textColor}>{", "}</Text>
            )}
            {statusLabel && (
              <>
                <Text color={statusLabel.branchColor ?? textColor}>{statusLabel.branch}</Text>
                <Text color={textColor}>{", "}</Text>
                <Text color={statusLabel.stateColor ?? textColor}>{statusLabel.state}</Text>
              </>
            )}]
          </Text>
        )}
        {progressLabel && (
          <Text color={textColor} backgroundColor={backgroundColor}>
            {" "}{progressLabel}
          </Text>
        )}
      </Box>
    </Box>
  );
};

const TreeRow = React.memo(
  TreeRowComponent,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.item.id === next.item.id &&
    prev.item.depth === next.item.depth &&
    prev.item.label === next.item.label &&
    prev.item.selected === next.item.selected &&
    prev.item.partiallySelected === next.item.partiallySelected &&
    prev.item.progress === next.item.progress &&
    prev.item.serverName === next.item.serverName &&
    prev.item.serverColor === next.item.serverColor &&
    prev.item.status?.branch === next.item.status?.branch &&
    prev.item.status?.state === next.item.status?.state &&
    prev.item.status?.delta === next.item.status?.delta
);

const TreeListComponent: React.FC<{
  items: FlatTreeItem[];
  selectedIndex: number;
  scrollOffset: number;
  workspaceHeight: number;
}> = (
  {
    items,
    selectedIndex,
    scrollOffset,
    workspaceHeight,
  }: {
    items: FlatTreeItem[];
    selectedIndex: number;
    scrollOffset: number;
    workspaceHeight: number;
  }
) => {
  const visibleCount = Math.max(1, workspaceHeight);
  const visibleItems = useMemo(() => {
    return items.length > 0 ? items.slice(scrollOffset, scrollOffset + visibleCount) : [];
  }, [items, scrollOffset, visibleCount]);

  if (items.length === 0) {
    return <Text>{t("tui.tree.empty")}</Text>;
  }

  return (
    <Box flexDirection="column" width="100%">
      {visibleItems.map((item, index) => {
        const absoluteIndex = scrollOffset + index;
        return <TreeRow key={item.id} item={item} selected={absoluteIndex === selectedIndex} />;
      })}
    </Box>
  );
};

const TreeList = React.memo(
  TreeListComponent,
  (prev, next) =>
    prev.items === next.items &&
    prev.selectedIndex === next.selectedIndex &&
    prev.scrollOffset === next.scrollOffset &&
    prev.workspaceHeight === next.workspaceHeight
);

const TreeListContainerComponent: React.FC<{
  items: FlatTreeItem[];
  selectedIndex: number;
  scrollOffset: number;
  onVisibleCountChange: (value: number) => void;
  reservedLines?: number;
}> = ({ items, selectedIndex, scrollOffset, onVisibleCountChange, reservedLines = 0 }) => {
  const { workspaceHeight } = useLayoutMetrics();
  // reservedLines: rows taken by extra chrome above the list (e.g. the
  // type-to-filter indicator) — without discounting them the list overflows
  // the workspace frame.
  const availableHeight = Math.max(1, workspaceHeight - reservedLines);
  const visibleCount = availableHeight;

  useEffect(() => {
    onVisibleCountChange(visibleCount);
  }, [visibleCount, onVisibleCountChange]);

  return <TreeList items={items} selectedIndex={selectedIndex} scrollOffset={scrollOffset} workspaceHeight={availableHeight} />;
};

const TreeListContainer = React.memo(
  TreeListContainerComponent,
  (prev, next) =>
    prev.items === next.items &&
    prev.selectedIndex === next.selectedIndex &&
    prev.scrollOffset === next.scrollOffset &&
    prev.onVisibleCountChange === next.onVisibleCountChange &&
    prev.reservedLines === next.reservedLines
);

export type TuiTreeProgress = {
  updateProgress: (nodeId: string, text: string) => void;
  updateStatus: (nodeId: string, status: RepoSyncStatus) => void;
  clearProgress: (nodeId: string) => void;
};

export const renderRepositoryTree = async (
  nodes: GitLabTreeNode[],
  onToggle: (nodeId: string) => void,
  session: TuiSession,
  options?: {
    title?: string;
    footer?: string;
    header?: string;
    parameters?: CommandParameters[];
    envFilePath?: string;
    initialSelectedNodeId?: string;
    onReady?: (handlers: {
      render: () => void;
      progress: TuiTreeProgress;
      log: {
        append: (message: string, level?: "info" | "warn" | "error") => void;
        setOrientation: (message: string) => void;
      };
    }) => void;
    onConfirm?: (selection: TuiSelectionResult) => void | Promise<void>;
  }
): Promise<TuiSelectionResult> => {
  return new Promise((resolve) => {
    const screenKeyRef: { current?: number } = {};

    const App: React.FC = () => {
      const modalState = useModalStateController();
      const debugLogger = useMemo(() => new PajeLogger(), []);
      const [orientation, setOrientation] = useState(options?.footer ?? t("tui.tree.orientationDefault"));
      const [version, setVersion] = useState(0);
      const progressMapRef = useRef<Map<string, ProgressSnapshot>>(new Map());
      const initialPosRef = useRef<{ index: number; scroll: number } | null>(null);
      if (initialPosRef.current === null) {
        initialPosRef.current = { index: 0, scroll: 0 };
        const initId = options?.initialSelectedNodeId;
        if (initId) {
          const colorMap = resolveServerColorMap(nodes);
          const flatItems = flattenTree(nodes, new Map(), 0, colorMap);
          const idx = flatItems.findIndex((item) => item.id === initId);
          if (idx >= 0) {
            initialPosRef.current = { index: idx, scroll: Math.max(0, idx - 5) };
          }
        }
      }
      const [selectedIndex, setSelectedIndex] = useState(initialPosRef.current.index);
      const [scrollOffset, setScrollOffset] = useState(initialPosRef.current.scroll);
      const [showOnlySelected, setShowOnlySelected] = useState(false);
      const [textFilter, setTextFilter] = useState("");
      const [searchActive, setSearchActive] = useState(false);
      const [visibleCount, setVisibleCount] = useState(1);
      const [branchModalBranches, setBranchModalBranches] = useState<string[]>([]);
      const [branchModalCurrent, setBranchModalCurrent] = useState<string | undefined>(undefined);
      const [branchModalNodeId, setBranchModalNodeId] = useState<string | null>(null);
      const [branchModalTargetPath, setBranchModalTargetPath] = useState<string | null>(null);
      const [branchModalDefaultBranch, setBranchModalDefaultBranch] = useState<string | undefined>(undefined);
      const [excludeModalLabel, setExcludeModalLabel] = useState("");
      const [excludeModalPattern, setExcludeModalPattern] = useState("");
      const [excludeModalNodeId, setExcludeModalNodeId] = useState<string | null>(null);
      // Not persisted in state via options.parameters (a one-time snapshot
      // taken before this screen mounted) — this override is what makes
      // Ctrl+P/Ctrl+E show the new excludeFilter value right after Ctrl+D,
      // without needing to reload the whole screen. Mirrors the
      // envOverrides map Layout already keeps for EditParamsModal's saves.
      const [excludeFilterOverride, setExcludeFilterOverride] = useState<string | undefined>(undefined);
      const resolvedRef = useRef(false);
      const syncInProgressRef = useRef(false);

      const parametersSnapshot = useMemo(() => {
        const base = options?.parameters ?? [];
        if (excludeFilterOverride === undefined) {
          return base;
        }
        return base.map((group) => ({
          ...group,
          parameters: group.parameters.map((param) =>
            param.name === "excludeFilter" ? { ...param, value: excludeFilterOverride, source: "env" as const } : param
          ),
        }));
      }, [options?.parameters, excludeFilterOverride]);

      const serverColorMap = useMemo(() => resolveServerColorMap(nodes), [nodes]);

      const items = useMemo(() => {
        const selectionFiltered = showOnlySelected ? filterTreeBySelection(nodes) : nodes;
        const visibleNodes = textFilter ? filterTreeByText(selectionFiltered, textFilter) : selectionFiltered;
        return flattenTree(visibleNodes, progressMapRef.current, 0, serverColorMap);
      }, [nodes, version, showOnlySelected, textFilter, serverColorMap]);

      const updateTextFilter = useCallback((next: string) => {
        setTextFilter(next);
        setSelectedIndex(0);
        setScrollOffset(0);
      }, []);

      useEffect(() => {
        if (items.length === 0) {
          setSelectedIndex(0);
          setScrollOffset(0);
          return;
        }
        if (selectedIndex >= items.length) {
          setSelectedIndex(items.length - 1);
        }
        const maxScroll = Math.max(0, items.length - visibleCount);
        if (scrollOffset > maxScroll) {
          setScrollOffset(maxScroll);
        }
      }, [items.length, visibleCount, selectedIndex, scrollOffset]);

      useEffect(() => {
        debugLogger.info("[TUI][TREE] mount");
        return () => {
          debugLogger.info("[TUI][TREE] unmount");
        };
      }, [debugLogger]);

      const ensureVisible = useCallback(
        (nextIndex: number) => {
          if (nextIndex < scrollOffset) {
            setScrollOffset(nextIndex);
            return;
          }
          if (nextIndex >= scrollOffset + visibleCount) {
            setScrollOffset(Math.max(0, nextIndex - visibleCount + 1));
          }
        },
        [scrollOffset, visibleCount]
      );

      const commitResolve = useCallback(
        (confirmed: boolean, mode?: TuiSelectionMode) => {
          const selectedNodeId = items[selectedIndex]?.id;
          debugLogger.info(
            `[TUI][TREE] commitResolve confirmed=${confirmed} mode=${mode ?? "-"} resolved=${resolvedRef.current}`
          );
          if (!confirmed && resolvedRef.current) {
            return;
          }
          if (confirmed && options?.onConfirm) {
            if (syncInProgressRef.current) {
              return;
            }
            syncInProgressRef.current = true;
            Promise.resolve(options.onConfirm({ confirmed, mode, selectedNodeId, nodes })).finally(() => {
              syncInProgressRef.current = false;
            });
            return;
          }
          resolvedRef.current = true;
          if (screenKeyRef.current !== undefined) {
            debugLogger.info("[TUI][TREE] release screen");
            session.releaseScreen(screenKeyRef.current);
          }
          resolve({ confirmed, mode, selectedNodeId, nodes });
        },
        [nodes, debugLogger, items, selectedIndex, options]
      );

      const toggleSelected = useCallback(() => {
        const item = items[selectedIndex];
        if (!item) {
          return;
        }
        onToggle(item.id);
        setVersion((value: number) => value + 1);
      }, [items, selectedIndex, onToggle]);

      const openBranchModal = useCallback(async () => {
        const item = items[selectedIndex];
        if (!item) {
          return;
        }
        const resolveNode = (nodeList: GitLabTreeNode[]): GitLabTreeNode | undefined => {
          for (const node of nodeList) {
            if (node.id === item.id) {
              return node;
            }
            const found = node.children ? resolveNode(node.children) : undefined;
            if (found) {
              return found;
            }
          }
          return undefined;
        };
        const node = resolveNode(nodes);
        if (!node || node.type !== "project" || !node.project) {
          return;
        }
        if (!node.localPath) {
          appendLogEntry(t("branchModal.noLocalPath"), "warn");
          return;
        }
        const branches = await listLocalBranches(node.localPath).catch((error) => {
          appendLogEntry(t("branchModal.listError", { error: error.message }), "error");
          return [] as string[];
        });
        setBranchModalBranches(branches);
        setBranchModalCurrent(node.status?.branch ?? node.project.default_branch);
        setBranchModalNodeId(node.id);
        setBranchModalTargetPath(node.localPath);
        setBranchModalDefaultBranch(node.project.default_branch);
        modalState.openModal("branch");
      }, [items, selectedIndex, nodes, modalState]);

      const openExcludeModal = useCallback(() => {
        const item = items[selectedIndex];
        if (!item) {
          return;
        }
        const resolveNode = (nodeList: GitLabTreeNode[]): GitLabTreeNode | undefined => {
          for (const node of nodeList) {
            if (node.id === item.id) {
              return node;
            }
            const found = node.children ? resolveNode(node.children) : undefined;
            if (found) {
              return found;
            }
          }
          return undefined;
        };
        const node = resolveNode(nodes);
        if (!node || !node.excludePattern) {
          return;
        }
        setExcludeModalLabel(node.label);
        setExcludeModalPattern(node.excludePattern);
        setExcludeModalNodeId(node.id);
        modalState.openModal("exclude");
      }, [items, selectedIndex, nodes, modalState]);

      const cancelExclude = useCallback(() => {
        modalState.closeModal();
      }, [modalState]);

      // Persists the new pattern to env.yaml (writeEnvYamlUpdates — same
      // presentation→persistence.ts precedent EditParamsModal already uses),
      // then prunes the node from the in-memory tree right away so the
      // screen reflects it instantly instead of waiting for a reload. The
      // persisted config is what guarantees it stays gone on future loads.
      const confirmExclude = useCallback(() => {
        const nodeId = excludeModalNodeId;
        const pattern = excludeModalPattern;
        const label = excludeModalLabel;
        modalState.closeModal();
        if (!nodeId || !pattern) {
          return;
        }
        const currentValue = excludeFilterOverride ?? findParamValue(options?.parameters, "excludeFilter");
        const existingPatterns = splitFilterPatterns(currentValue);
        const mergedValue = existingPatterns.includes(pattern)
          ? existingPatterns.join(";")
          : [...existingPatterns, pattern].join(";");
        try {
          writeEnvYamlUpdates({ excludeFilter: mergedValue }, options?.envFilePath);
        } catch (error) {
          appendLogEntry(
            t("tui.tree.excludeSaveError", { message: error instanceof Error ? error.message : String(error) }),
            "error"
          );
          return;
        }
        setExcludeFilterOverride(mergedValue);
        const pruned = removeTreeNodes(nodes, new Set([nodeId]));
        nodes.length = 0;
        nodes.push(...pruned);
        nodes.forEach((root) => recomputeTreeSelection(root));
        setVersion((value: number) => value + 1);
        appendLogEntry(t("tui.tree.excluded", { label, pattern }), "info");
      }, [excludeModalNodeId, excludeModalPattern, excludeModalLabel, excludeFilterOverride, options?.parameters, options?.envFilePath, nodes, modalState]);

      const toggleSelectionFilter = useCallback(() => {
        setShowOnlySelected((value) => !value);
        setSelectedIndex(0);
        setScrollOffset(0);
        setVersion((value: number) => value + 1);
        appendLogEntry(showOnlySelected ? t("tui.tree.filterAll") : t("tui.tree.filterSelected"), "debug");
      }, [showOnlySelected]);

      useInput(
        (input: string, key: Key) => {
          const navigationKey = key as Key & { home?: boolean; end?: boolean };
          const lower = input.toLowerCase();
          if (key.ctrl && lower === "b") {
            openBranchModal();
            return;
          }
          if (key.ctrl && lower === "d") {
            openExcludeModal();
            return;
          }
          if (key.return) {
            commitResolve(true, "single");
            return;
          }
          if (key.ctrl && lower === "s") {
            commitResolve(true, "all");
            return;
          }
          if (key.upArrow) {
            const nextIndex = Math.max(0, selectedIndex - 1);
            setSelectedIndex(nextIndex);
            ensureVisible(nextIndex);
            return;
          }
          if (key.downArrow) {
            const nextIndex = Math.min(items.length - 1, selectedIndex + 1);
            setSelectedIndex(nextIndex);
            ensureVisible(nextIndex);
            return;
          }
          if (key.pageUp) {
            const nextIndex = Math.max(0, selectedIndex - visibleCount);
            setSelectedIndex(nextIndex);
            ensureVisible(nextIndex);
            return;
          }
          if (key.pageDown) {
            const nextIndex = Math.min(items.length - 1, selectedIndex + visibleCount);
            setSelectedIndex(nextIndex);
            ensureVisible(nextIndex);
            return;
          }
          if (navigationKey.home) {
            setSelectedIndex(0);
            setScrollOffset(0);
            return;
          }
          if (navigationKey.end) {
            const lastIndex = Math.max(0, items.length - 1);
            setSelectedIndex(lastIndex);
            setScrollOffset(Math.max(0, lastIndex - visibleCount + 1));
            return;
          }
          if (input === " " && !searchActive) {
            toggleSelected();
            return;
          }
          // (Ctrl+M is never usable as a shortcut: terminals send the same
          // byte as Enter, 0x0d.)
          if (key.ctrl && lower === "x") {
            toggleSelectionFilter();
            return;
          }
          if (key.ctrl && lower === "f") {
            setSearchActive(true);
            return;
          }
          // Search mode (Ctrl+F): printable characters narrow the tree as you
          // type. Esc exits search mode and clears the filter (the Layout
          // skips Esc while search mode is active); backspace erases the
          // last character.
          if (key.escape) {
            if (searchActive) {
              setSearchActive(false);
              updateTextFilter("");
            }
            return;
          }
          if (key.backspace || key.delete) {
            if (searchActive && textFilter) {
              updateTextFilter(textFilter.slice(0, -1));
            }
            return;
          }
          if (searchActive && input && !key.ctrl && !key.meta && !key.tab) {
            updateTextFilter(textFilter + input);
          }
        },
        { isActive: !modalState.modalOpen }
      );

      useEffect(() => {
        options?.onReady?.({
          render: () => setVersion((value: number) => value + 1),
          progress: {
            updateProgress: (nodeId: string, text: string) => {
              progressMapRef.current.set(nodeId, { text });
              setVersion((value: number) => value + 1);
            },
            updateStatus: (nodeId: string, status: RepoSyncStatus) => {
              const visit = (node: GitLabTreeNode): boolean => {
                if (node.id === nodeId) {
                  node.status = status;
                  return true;
                }
                return (node.children ?? []).some((child) => visit(child));
              };
              nodes.some((node) => visit(node));
              setVersion((value: number) => value + 1);
            },
            clearProgress: (nodeId: string) => {
              progressMapRef.current.delete(nodeId);
              setVersion((value: number) => value + 1);
            },
          },
          log: {
            append: (message: string, level: "info" | "warn" | "error" = "info") => {
              appendLogEntry(message, level);
            },
            setOrientation: (message: string) => setOrientation(message),
          },
        });
      }, [options, nodes]);

      const headerTitle = options?.header ?? options?.title ?? t("app.gitSyncTitle");

      return (
        <Layout
          title={headerTitle}
          orientation={orientation}
          parameters={parametersSnapshot}
          envFilePath={options?.envFilePath}
          modalState={modalState}
          escapeEnabled={modalState.modalOpen || (!searchActive && textFilter.length === 0)}
          helpOnBackspace={!searchActive && textFilter.length === 0}
          helpContext="tree"
          onHelpShortcut={(input, key) => {
            const lower = input.toLowerCase();
            if (key.ctrl && lower === "b") {
              openBranchModal();
              return;
            }
            if (key.ctrl && lower === "d") {
              openExcludeModal();
              return;
            }
            if (key.ctrl && lower === "x") {
              toggleSelectionFilter();
              return;
            }
            if (key.ctrl && lower === "f") {
              setSearchActive(true);
              return;
            }
            if (key.return) {
              commitResolve(true, "single");
              return;
            }
            if (key.upArrow) {
              const nextIndex = Math.max(0, selectedIndex - 1);
              setSelectedIndex(nextIndex);
              ensureVisible(nextIndex);
            }
            if (key.downArrow) {
              const nextIndex = Math.min(items.length - 1, selectedIndex + 1);
              setSelectedIndex(nextIndex);
              ensureVisible(nextIndex);
            }
            if (key.pageUp) {
              const nextIndex = Math.max(0, selectedIndex - visibleCount);
              setSelectedIndex(nextIndex);
              ensureVisible(nextIndex);
            }
            if (key.pageDown) {
              const nextIndex = Math.min(items.length - 1, selectedIndex + visibleCount);
              setSelectedIndex(nextIndex);
              ensureVisible(nextIndex);
            }
            if ((key as Key & { home?: boolean }).home) {
              setSelectedIndex(0);
              setScrollOffset(0);
            }
            if ((key as Key & { end?: boolean }).end) {
              const lastIndex = Math.max(0, items.length - 1);
              setSelectedIndex(lastIndex);
              setScrollOffset(Math.max(0, lastIndex - visibleCount + 1));
            }
            if (input === " " && !searchActive) {
              toggleSelected();
            }
            if (key.ctrl && lower === "s") {
              commitResolve(true, "all");
            }
          }}
          branchModal={{
            branches: branchModalBranches,
            currentBranch: branchModalCurrent,
            onConfirm: async (choice) => {
              if (!branchModalTargetPath || !branchModalNodeId) {
                return;
              }
              try {
                if (choice.isRename && choice.oldName) {
                  const repoInfo = await readLocalRepoInfo(branchModalTargetPath);
                  const renameResult = await renameBranch(branchModalTargetPath, choice.oldName, choice.name, {
                    hasRemote: Boolean(repoInfo.remoteUrl),
                  });
                  if (renameResult.remoteDeleteFailed) {
                    appendLogEntry(
                      t("branchModal.renameRemoteDeleteWarning", { oldName: choice.oldName, newName: choice.name }),
                      "warn"
                    );
                  } else {
                    appendLogEntry(
                      t("branchModal.renameSuccess", { oldName: choice.oldName, newName: choice.name }),
                      "info"
                    );
                  }
                } else if (choice.isNew) {
                  await createBranchAndPush(branchModalTargetPath, choice.name);
                } else {
                  const checkoutCommand = await checkoutBranch(branchModalTargetPath, choice.name);
                  appendLogEntry(t("branchModal.checkoutCommand", { command: checkoutCommand }), "debug");
                }
                const status = await resolveRepoStatus({
                  targetPath: branchModalTargetPath,
                  defaultBranch: branchModalDefaultBranch,
                  fetch: true,
                });
                const visit = (node: GitLabTreeNode): boolean => {
                  if (node.id === branchModalNodeId) {
                    node.status = status;
                    return true;
                  }
                  return (node.children ?? []).some((child) => visit(child));
                };
                nodes.some((node) => visit(node));
                setVersion((value: number) => value + 1);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                appendLogEntry(t("branchModal.updateError", { error: message }), "error");
              } finally {
                modalState.closeModal();
              }
            },
            onCancel: () => {
              modalState.closeModal();
            },
          }}
          excludeModal={{
            label: excludeModalLabel,
            pattern: excludeModalPattern,
            onConfirm: confirmExclude,
            onCancel: cancelExclude,
          }}
          onEscape={() => {
            debugLogger.info("[TUI][TREE] onEscape -> commitResolve(false)");
            commitResolve(false);
          }}
        >
          <Box flexDirection="column" width="100%">
            {searchActive ? (
              <Text color="yellow" wrap="truncate-end">
                {t("tui.tree.textFilterIndicator", { query: textFilter, count: String(items.length) })}
              </Text>
            ) : null}
            <TreeListContainer
              items={items}
              selectedIndex={selectedIndex}
              scrollOffset={scrollOffset}
              onVisibleCountChange={setVisibleCount}
              reservedLines={searchActive ? 1 : 0}
            />
          </Box>
        </Layout>
      );
    };

    screenKeyRef.current = session.mountScreen(<App />);
  });
};

export const renderLoadingScreen = (options: LoadingScreenOptions, session: TuiSession): LoadingScreenHandle => {
  const spinnerFrames = options.spinnerFrames ?? ["/", "-", "\\", "|"];
  const intervalMs = options.intervalMs ?? 120;

  const App: React.FC = () => {
    const modalState = useModalStateController();
    const { workspaceHeight } = useLayoutMetrics();
    const [frameIndex, setFrameIndex] = useState(0);
    const frame = spinnerFrames[frameIndex % spinnerFrames.length] ?? "";

    useEffect(() => {
      const intervalId = setInterval(() => {
        setFrameIndex((value) => value + 1);
      }, intervalMs);
      return () => clearInterval(intervalId);
    }, [intervalMs]);

    return (
      <Layout
        title={options.title ?? t("app.gitSyncTitle")}
        orientation={options.orientation ?? t("tui.loading.orientation")}
        parameters={options.parameters ?? []}
        modalState={modalState}
        helpOnBackspace
        helpContext="loading"
        onHelpShortcut={() => undefined}
      >
        <Box
          flexDirection="column"
          width="100%"
          height={workspaceHeight}
          alignItems="center"
          justifyContent="center"
        >
          <Text color="cyan">{`${frame} ${options.message}`}</Text>
        </Box>
      </Layout>
    );
  };

  const screenKey = session.mountScreen(<App />);

  return {
    stop: () => {
      session.releaseScreen(screenKey);
    },
  };
};
