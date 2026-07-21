import * as vscode from "vscode";
import type { GitLabTreeNode, RepoSyncStatus } from "../../src/modules/git/types.js";
import { describeTreeNode } from "./treeAdapter.js";

export class PajeTreeProvider implements vscode.TreeDataProvider<GitLabTreeNode> {
  private nodes: GitLabTreeNode[] = [];
  private readonly emitter = new vscode.EventEmitter<GitLabTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  setNodes(nodes: GitLabTreeNode[]): void {
    this.nodes = nodes;
    this.refresh();
  }

  getNodes(): GitLabTreeNode[] {
    return this.nodes;
  }

  refresh(node?: GitLabTreeNode): void {
    this.emitter.fire(node);
  }

  applyStatus(projectId: number, status: RepoSyncStatus): void {
    const visit = (node: GitLabTreeNode): boolean => {
      if (node.type === "project" && node.project?.id === projectId) {
        node.status = status;
        return true;
      }
      return (node.children ?? []).some((child) => visit(child));
    };
    if (this.nodes.some((node) => visit(node))) {
      this.refresh();
    }
  }

  getChildren(element?: GitLabTreeNode): GitLabTreeNode[] {
    if (!element) {
      return this.nodes;
    }
    return element.children ?? [];
  }

  getTreeItem(node: GitLabTreeNode): vscode.TreeItem {
    const descriptor = describeTreeNode(node);
    const item = new vscode.TreeItem(
      descriptor.label,
      descriptor.isProject
        ? vscode.TreeItemCollapsibleState.None
        : descriptor.hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
    );
    item.id = descriptor.id;
    item.description = descriptor.description || undefined;
    item.tooltip = descriptor.tooltip;
    item.contextValue = descriptor.contextValue;
    item.iconPath = descriptor.iconColorId
      ? new vscode.ThemeIcon(descriptor.iconId, new vscode.ThemeColor(descriptor.iconColorId))
      : new vscode.ThemeIcon(descriptor.iconId);
    item.checkboxState = descriptor.checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    return item;
  }
}
