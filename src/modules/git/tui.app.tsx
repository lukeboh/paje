import fs from "node:fs";
import path from "node:path";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { PajeLogger } from "./logger.js";
import type { CommandParameters } from "./core/parameters.js";
import { Layout } from "./tui/layout.js";
import { useLayoutMetrics, useModalStateController } from "./tui/layoutContext.js";
import { appendLogEntry } from "./tui/logStore.js";
import type { GitLabTreeNode, RepoSyncStatus, RepoSyncState } from "./types.js";
import type { TuiSession } from "./tuiSession.js";
import { collectProjectNodes, filterTreeBySelection, filterTreeByText, recomputeTreeSelection, removeTreeNodes } from "./treeBuilder.js";
import { t } from "../../i18n/index.js";
import {
  checkBranchAvailability,
  checkoutBranch,
  checkoutDefaultBranchBulk,
  checkoutOrCreateBranchBulk,
  createBranchAndPush,
  listLocalBranches,
  renameBranch,
  resolveRepoStatus,
  type BulkBranchResult,
} from "./core/gitBranchService.js";
import { hasGitDir, readLocalRepoInfo } from "./gitRepoScanner.js";
import { splitFilterPatterns } from "./patternFilter.js";
import { writeCdTarget, writeEnvYamlUpdates } from "./persistence.js";

export type TuiSelectionMode = "all" | "single";

export type TuiSelectionResult = {
  confirmed: boolean;
  mode?: TuiSelectionMode;
  selectedNodeId?: string;
  nodes: GitLabTreeNode[];
  // Absolute path of the highlighted repo, set only when the user exited
  // via Ctrl+Q — the caller (gitCommand.ts) reads this to terminate the
  // whole process; the shell that invoked PAJÉ then does the actual cd
  // (see writeCdTarget in persistence.ts).
  exitToDirectory?: string;
};

type FlatTreeItem = {
  id: string;
  depth: number;
  label: string;
  serverName?: string;
  serverColor?: string;
  status?: RepoSyncStatus;
  archived?: boolean;
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

// Groups have no localPath of their own (only project nodes do) — derive
// one from any descendant project's already-resolved localPath, walking up
// as many directory levels as the segments separating that project from
// this group. Reuses whatever baseDir/conflict-suffix resolution already
// produced for that specific project instead of recomputing it (a group
// can contain projects from servers with different pajeBaseDir).
const resolveGroupLocalPath = (groupNode: GitLabTreeNode): string | null => {
  const fullPath = groupNode.excludePattern?.replace(/\/\*\*$/, "");
  if (!fullPath) {
    return null;
  }
  const findProjectWithPath = (node: GitLabTreeNode): GitLabTreeNode | undefined => {
    if (node.type === "project" && node.localPath && node.project) {
      return node;
    }
    for (const child of node.children ?? []) {
      const found = findProjectWithPath(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  const projectNode = findProjectWithPath(groupNode);
  if (!projectNode?.localPath || !projectNode.project) {
    return null;
  }
  const groupSegments = fullPath.split("/").filter(Boolean).length;
  const projectSegments = projectNode.project.path_with_namespace.split("/").filter(Boolean).length;
  const stepsUp = projectSegments - groupSegments;
  if (stepsUp <= 0) {
    return null;
  }
  let result = projectNode.localPath;
  for (let i = 0; i < stepsUp; i += 1) {
    result = path.dirname(result);
  }
  return result;
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
      archived: node.project?.archived,
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
  const hasInfo = Boolean(item.serverName || statusLabel || item.archived);

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
            {item.archived && (
              <Text color="gray">{t("tui.tree.archivedTag")}</Text>
            )}
            {item.archived && (item.serverName || statusLabel) && (
              <Text color={textColor}>{", "}</Text>
            )}
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
    prev.item.archived === next.item.archived &&
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
      const [bulkTargetNodes, setBulkTargetNodes] = useState<GitLabTreeNode[]>([]);
      const [bulkCheckoutBranch, setBulkCheckoutBranch] = useState("");
      const [confirmModalConfig, setConfirmModalConfig] = useState<{
        title: string;
        message: string;
        detail?: string;
        onConfirm: () => void;
        onCancel: () => void;
      } | null>(null);
      const resolvedRef = useRef(false);
      const syncInProgressRef = useRef(false);
      // Bulk branch operations (Ctrl+K/Ctrl+R) mutate working trees the same
      // way a sync does — this guards them against running concurrently with
      // a sync, or with each other, without needing to touch syncInProgressRef
      // itself (kept separate so neither guard has to know about the other's
      // internals, just check the flag).
      const branchOpInProgressRef = useRef(false);

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
            if (syncInProgressRef.current || branchOpInProgressRef.current) {
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

      // Mirrors commitResolve's teardown exactly (same resolvedRef guard,
      // same session.releaseScreen, a single resolve() call) rather than
      // inventing a second cleanup path — this is the plain Esc/cancel exit
      // with one extra field set, not a different kind of exit.
      const commitExitToDirectory = useCallback(
        (targetPath: string) => {
          if (resolvedRef.current) {
            return;
          }
          resolvedRef.current = true;
          if (screenKeyRef.current !== undefined) {
            session.releaseScreen(screenKeyRef.current);
          }
          resolve({ confirmed: true, nodes, exitToDirectory: targetPath });
        },
        [nodes]
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

      const openExitAtDirectory = useCallback(async () => {
        if (syncInProgressRef.current || branchOpInProgressRef.current) {
          return;
        }
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
        let resolvedTargetPath: string | null = null;
        if (node?.type === "project" && node.localPath && (await hasGitDir(node.localPath))) {
          resolvedTargetPath = node.localPath;
        } else if (node?.type === "group") {
          const groupPath = resolveGroupLocalPath(node);
          if (groupPath && fs.existsSync(groupPath)) {
            resolvedTargetPath = groupPath;
          }
        }
        if (!resolvedTargetPath) {
          appendLogEntry(t("tui.tree.exitAtDirectoryInvalid"), "warn");
          return;
        }
        const targetPath = resolvedTargetPath;
        setConfirmModalConfig({
          title: t("tui.tree.exitAtDirectoryConfirmTitle"),
          message: t("tui.tree.exitAtDirectoryConfirmMessage", { path: targetPath }),
          onConfirm: () => {
            modalState.closeModal();
            writeCdTarget(targetPath);
            commitExitToDirectory(targetPath);
          },
          onCancel: () => modalState.closeModal(),
        });
        modalState.openModal("confirm");
      }, [items, selectedIndex, nodes, modalState, commitExitToDirectory]);

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

      // Shared target-gathering for both bulk operations: only checkbox-
      // selected project nodes, never an implicit fallback to the highlighted
      // one — these mutate working trees across potentially many repos, so
      // "nothing marked" silently becoming "one arbitrary target" would be
      // surprising. If nothing is marked, this warns and the caller bails out
      // without opening any modal.
      const collectBulkTargets = useCallback((): GitLabTreeNode[] => {
        return collectProjectNodes(nodes).filter(
          (node): node is GitLabTreeNode & { localPath: string } => Boolean(node.selected && node.localPath && node.project)
        );
      }, [nodes]);

      // Shared result handling for both bulk operations: logs one line per
      // target by status, refreshes the tree node's status for anything that
      // actually ended up on a (possibly new) branch, single re-render at the
      // end. Relies on checkoutOrCreateBranchBulk/checkoutDefaultBranchBulk
      // preserving input order in their result array to zip back to nodes by
      // index instead of needing a separate id/path lookup.
      const applyBulkResults = useCallback(
        async (results: BulkBranchResult[], targetNodes: GitLabTreeNode[]) => {
          for (let index = 0; index < results.length; index += 1) {
            const result = results[index];
            const node = targetNodes[index];
            if (!node) {
              continue;
            }
            switch (result.status) {
              case "checked-out":
                appendLogEntry(t("tui.tree.bulkCheckedOut", { label: result.target.label }), "info");
                break;
              case "created":
                appendLogEntry(t("tui.tree.bulkCreated", { label: result.target.label }), "info");
                break;
              case "skipped": {
                const skipKey =
                  result.reason === "no-default-branch"
                    ? "tui.tree.bulkSkippedNoDefaultBranch"
                    : result.reason === "not-cloned"
                      ? "tui.tree.bulkSkippedNotCloned"
                      : "tui.tree.bulkSkippedBranchMissing";
                appendLogEntry(t(skipKey, { label: result.target.label }), "warn");
                break;
              }
              case "failed":
                appendLogEntry(
                  t("tui.tree.bulkFailed", { label: result.target.label, error: result.message ?? "" }),
                  "error"
                );
                break;
            }
            if ((result.status === "checked-out" || result.status === "created") && node.localPath) {
              const status = await resolveRepoStatus({
                targetPath: node.localPath,
                defaultBranch: node.project?.default_branch,
                fetch: true,
              });
              node.status = status;
            }
          }
          setVersion((value: number) => value + 1);
        },
        []
      );

      const runBulkCheckout = useCallback(
        async (targetNodes: GitLabTreeNode[], branch: string, createIfMissing: boolean) => {
          branchOpInProgressRef.current = true;
          try {
            const targets = targetNodes.map((node) => ({ targetPath: node.localPath as string, label: node.label }));
            const results = await checkoutOrCreateBranchBulk(targets, branch, createIfMissing);
            await applyBulkResults(results, targetNodes);
          } finally {
            branchOpInProgressRef.current = false;
          }
        },
        [applyBulkResults]
      );

      const confirmBulkCheckoutBranch = useCallback(
        async (branch: string) => {
          modalState.closeModal();
          const targets = bulkTargetNodes.map((node) => ({ targetPath: node.localPath as string, label: node.label }));
          const { withoutBranch } = await checkBranchAvailability(targets, branch);
          if (withoutBranch.length === 0) {
            await runBulkCheckout(bulkTargetNodes, branch, false);
            setBulkTargetNodes([]);
            return;
          }
          const missingNodes = bulkTargetNodes.filter((node) =>
            withoutBranch.some((target) => target.targetPath === node.localPath)
          );
          setBulkCheckoutBranch(branch);
          setConfirmModalConfig({
            title: t("tui.tree.bulkCreateConfirmTitle"),
            message: t("tui.tree.bulkCreateConfirmMessage", { branch, count: String(missingNodes.length) }),
            detail: missingNodes.map((node) => node.label).join(", "),
            onConfirm: () => {
              modalState.closeModal();
              void runBulkCheckout(bulkTargetNodes, branch, true).finally(() => setBulkTargetNodes([]));
            },
            onCancel: () => {
              modalState.closeModal();
              void runBulkCheckout(bulkTargetNodes, branch, false).finally(() => setBulkTargetNodes([]));
            },
          });
          modalState.openModal("confirm");
        },
        [bulkTargetNodes, modalState, runBulkCheckout]
      );

      const openBulkCheckout = useCallback(() => {
        if (branchOpInProgressRef.current || syncInProgressRef.current) {
          return;
        }
        const targetNodes = collectBulkTargets();
        if (targetNodes.length === 0) {
          appendLogEntry(t("tui.tree.bulkNoSelection"), "warn");
          return;
        }
        setBulkTargetNodes(targetNodes);
        setBulkCheckoutBranch("");
        modalState.openModal("text-input");
      }, [collectBulkTargets, modalState]);

      const runBulkReturnToDefault = useCallback(
        async (targetNodes: GitLabTreeNode[]) => {
          branchOpInProgressRef.current = true;
          try {
            const results = await checkoutDefaultBranchBulk(
              targetNodes.map((node) => ({
                targetPath: node.localPath as string,
                label: node.label,
                defaultBranch: node.project?.default_branch,
              }))
            );
            await applyBulkResults(results, targetNodes);
          } finally {
            branchOpInProgressRef.current = false;
          }
        },
        [applyBulkResults]
      );

      const openBulkReturnToDefault = useCallback(() => {
        if (branchOpInProgressRef.current || syncInProgressRef.current) {
          return;
        }
        const targetNodes = collectBulkTargets();
        if (targetNodes.length === 0) {
          appendLogEntry(t("tui.tree.bulkNoSelection"), "warn");
          return;
        }
        setConfirmModalConfig({
          title: t("tui.tree.bulkReturnConfirmTitle"),
          message: t("tui.tree.bulkReturnConfirmMessage", { count: String(targetNodes.length) }),
          onConfirm: () => {
            modalState.closeModal();
            void runBulkReturnToDefault(targetNodes);
          },
          onCancel: () => {
            modalState.closeModal();
          },
        });
        modalState.openModal("confirm");
      }, [collectBulkTargets, modalState, runBulkReturnToDefault]);

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
          if (key.ctrl && lower === "k") {
            openBulkCheckout();
            return;
          }
          if (key.ctrl && lower === "r") {
            openBulkReturnToDefault();
            return;
          }
          if (key.ctrl && lower === "q") {
            void openExitAtDirectory();
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
          // Checked before the search-query append below (RU-08: checkbox
          // selection must keep working over a filtered list) — Space always
          // toggles, even while searching, so it never reaches that branch.
          if (input === " ") {
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
            if (key.ctrl && lower === "k") {
              openBulkCheckout();
              return;
            }
            if (key.ctrl && lower === "r") {
              openBulkReturnToDefault();
              return;
            }
            if (key.ctrl && lower === "q") {
              void openExitAtDirectory();
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
            if (input === " ") {
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
          confirmModal={confirmModalConfig ?? undefined}
          textInputModal={{
            title: t("tui.tree.bulkCheckoutTitle"),
            label: t("tui.tree.bulkCheckoutLabel"),
            initialValue: bulkCheckoutBranch,
            onConfirm: (value) => {
              void confirmBulkCheckoutBranch(value);
            },
            onCancel: () => {
              modalState.closeModal();
              setBulkTargetNodes([]);
            },
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
