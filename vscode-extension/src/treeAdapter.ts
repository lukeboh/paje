import type { GitLabTreeNode, RepoSyncState } from "../../src/modules/git/types.js";

// Pure mapping from PAJÉ tree nodes to display descriptors — no dependency on
// the "vscode" module so the logic is testable from the main suite.

export type VsCodeNodeDescriptor = {
  id: string;
  label: string;
  isProject: boolean;
  hasChildren: boolean;
  checked: boolean;
  description: string;
  tooltip: string;
  localPath?: string;
  iconId: string;
  iconColorId?: string;
  contextValue: "pajeProject" | "pajeGroup";
};

// Codicon + theme color per repository state, mirroring the TUI palette.
export const STATE_PRESENTATION: Record<RepoSyncState, { iconId: string; iconColorId: string }> = {
  SYNCED: { iconId: "check", iconColorId: "charts.green" },
  BEHIND: { iconId: "arrow-down", iconColorId: "charts.red" },
  AHEAD: { iconId: "arrow-up", iconColorId: "charts.blue" },
  DIVERGED: { iconId: "git-compare", iconColorId: "charts.red" },
  REMOTE: { iconId: "cloud", iconColorId: "charts.yellow" },
  EMPTY: { iconId: "circle-slash", iconColorId: "charts.purple" },
  LOCAL: { iconId: "folder-active", iconColorId: "charts.red" },
  UNCOMMITTED: { iconId: "edit", iconColorId: "charts.red" },
};

const countProjects = (node: GitLabTreeNode): number => {
  if (node.type === "project") {
    return 1;
  }
  return (node.children ?? []).reduce((total, child) => total + countProjects(child), 0);
};

export const describeTreeNode = (node: GitLabTreeNode): VsCodeNodeDescriptor => {
  const hasChildren = Boolean(node.children && node.children.length > 0);

  if (node.type === "project") {
    const status = node.status;
    const presentation = status ? STATE_PRESENTATION[status.state] : undefined;
    const statusText = status
      ? `${status.branch} · ${status.state.toLowerCase()}${status.delta ? ` ${status.delta}` : ""}`
      : "";
    const tooltipParts = [
      node.project?.path_with_namespace ?? node.label,
      node.project?.pajeServerName ? `Servidor: ${node.project.pajeServerName}` : "",
      node.localPath ? `Local: ${node.localPath}` : "",
      statusText,
    ].filter(Boolean);
    return {
      id: node.id,
      label: node.label,
      isProject: true,
      hasChildren: false,
      checked: Boolean(node.selected),
      description: statusText,
      tooltip: tooltipParts.join("\n"),
      localPath: node.localPath,
      iconId: presentation?.iconId ?? "repo",
      iconColorId: presentation?.iconColorId,
      contextValue: "pajeProject",
    };
  }

  const projects = countProjects(node);
  return {
    id: node.id,
    label: node.label,
    isProject: false,
    hasChildren,
    checked: Boolean(node.selected),
    description: `${projects}`,
    tooltip: node.label,
    iconId: "folder",
    contextValue: "pajeGroup",
  };
};
