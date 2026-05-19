import { GitLabGroup, GitLabProject, GitLabTreeNode, RepoSyncStatus } from "./types.js";

const resolvePathLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const segments = trimmed.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
};

export const buildGitLabTree = (
  groups: GitLabGroup[],
  projects: GitLabProject[]
): GitLabTreeNode[] => {
  const groupMap = new Map<number, GitLabTreeNode>();

  groups.forEach((group) => {
    groupMap.set(group.id, {
      id: `group-${group.id}`,
      label: resolvePathLabel(group.full_path),
      type: "group",
      groupId: group.id,
      children: [],
      selected: false,
      partiallySelected: false,
    });
  });

  const roots: GitLabTreeNode[] = [];

  groups.forEach((group) => {
    const node = groupMap.get(group.id);
    if (!node) {
      return;
    }

    if (group.parent_id && groupMap.has(group.parent_id)) {
      const parent = groupMap.get(group.parent_id);
      parent?.children?.push(node);
    } else {
      roots.push(node);
    }
  });

  projects.forEach((project) => {
    const namespaceId = project.namespace?.id;
    const displayLabel = project.pajeOriginalPathWithNamespace ?? project.path_with_namespace;
    const node: GitLabTreeNode = {
      id: `project-${project.id}`,
      label: resolvePathLabel(displayLabel),
      type: "project",
      project,
      localPath: project.pajeOriginalPathWithNamespace ?? project.path_with_namespace,
      selected: false,
      partiallySelected: false,
    };

    if (namespaceId && groupMap.has(namespaceId)) {
      groupMap.get(namespaceId)?.children?.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};

export const toggleTreeNode = (node: GitLabTreeNode, selected: boolean): void => {
  node.selected = selected;
  node.partiallySelected = false;

  if (node.children && node.children.length > 0) {
    node.children.forEach((child) => toggleTreeNode(child, selected));
  }
};

export const recomputeTreeSelection = (node: GitLabTreeNode): void => {
  if (!node.children || node.children.length === 0) {
    node.partiallySelected = false;
    return;
  }

  node.children.forEach((child) => recomputeTreeSelection(child));

  const total = node.children.length;
  const selectedCount = node.children.filter((child) => child.selected).length;
  const partialCount = node.children.filter((child) => child.partiallySelected).length;

  if (selectedCount === total) {
    node.selected = true;
    node.partiallySelected = false;
  } else if (selectedCount === 0 && partialCount === 0) {
    node.selected = false;
    node.partiallySelected = false;
  } else {
    node.selected = false;
    node.partiallySelected = true;
  }
};

export const applyInitialSelectionFromStatusMap = (
  nodes: GitLabTreeNode[],
  statusMap: Record<number, RepoSyncStatus>
): void => {
  const visit = (node: GitLabTreeNode): void => {
    if (node.type === "project" && node.project) {
      const status = statusMap[node.project.id];
      const shouldSelect = Boolean(status && status.state !== "EMPTY");
      node.selected = shouldSelect;
      node.partiallySelected = false;
    }
    node.children?.forEach((child) => visit(child));
  };
  nodes.forEach((node) => visit(node));
  nodes.forEach((node) => recomputeTreeSelection(node));
};

export const filterTreeBySelection = (nodes: GitLabTreeNode[]): GitLabTreeNode[] => {
  const visit = (node: GitLabTreeNode): GitLabTreeNode | null => {
    const filteredChildren = node.children
      ? node.children
          .map((child) => visit(child))
          .filter((child): child is GitLabTreeNode => child !== null)
      : [];
    const isMarked = Boolean(node.selected || node.partiallySelected);
    if (!isMarked && filteredChildren.length === 0) {
      return null;
    }
    return {
      ...node,
      children: filteredChildren.length > 0 ? filteredChildren : node.children ? [] : undefined,
    };
  };
  return nodes
    .map((node) => visit(node))
    .filter((node): node is GitLabTreeNode => node !== null);
};

export const collectProjectNodesFromNode = (node: GitLabTreeNode): GitLabTreeNode[] => {
  if (node.type === "project") {
    return [node];
  }
  const projects: GitLabTreeNode[] = [];
  const visit = (current: GitLabTreeNode): void => {
    if (current.type === "project") {
      projects.push(current);
      return;
    }
    current.children?.forEach((child) => visit(child));
  };
  node.children?.forEach((child) => visit(child));
  return projects;
};

export const collectProjectNodes = (nodes: GitLabTreeNode[]): GitLabTreeNode[] => {
  const projects: GitLabTreeNode[] = [];
  nodes.forEach((current) => {
    projects.push(...collectProjectNodesFromNode(current));
  });
  return projects;
};

export const collectSelectedProjects = (nodes: GitLabTreeNode[]): GitLabProject[] => {
  const projects: GitLabProject[] = [];

  const visit = (node: GitLabTreeNode): void => {
    if (node.type === "project" && node.selected && node.project) {
      projects.push(node.project);
    }
    node.children?.forEach((child) => visit(child));
  };

  nodes.forEach((node) => visit(node));
  return projects;
};
