export type GitLabGroup = {
  id: number;
  name: string;
  full_path: string;
  parent_id?: number | null;
};

export type GitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  default_branch?: string;
  visibility?: "public" | "internal" | "private";
  archived?: boolean;
  namespace?: {
    id: number;
    full_path: string;
  };
  pajeOriginalPathWithNamespace?: string;
  pajeServerName?: string;
  pajeHttpUrl?: string;
  pajeBaseDir?: string;
  pajeUserEmail?: string;
};

export type RepoSyncState =
  | "SYNCED"
  | "BEHIND"
  | "AHEAD"
  | "REMOTE"
  | "EMPTY"
  | "LOCAL"
  | "UNCOMMITTED"
  | "DIVERGED";

export type RepoSyncStatus = {
  branch: string;
  state: RepoSyncState;
  delta?: string;
};

export type GitLabTreeNodeType = "group" | "project";

export type GitLabTreeNode = {
  id: string;
  label: string;
  type: GitLabTreeNodeType;
  groupId?: number;
  project?: GitLabProject;
  localPath?: string;
  children?: GitLabTreeNode[];
  selected?: boolean;
  partiallySelected?: boolean;
  status?: RepoSyncStatus;
};

export type GitRepositoryTarget = {
  id: number;
  name: string;
  pathWithNamespace: string;
  sshUrl: string;
  httpUrl?: string;
  localPath: string;
  defaultBranch?: string;
  branch?: string;
  gitUserName?: string;
  gitUserEmail?: string;
};

export type ParallelSyncOptions = {
  concurrency?: number | "auto";
  shallow?: boolean;
  dryRun?: boolean;
  logger?: (message: string, level?: "info" | "warn" | "error") => void;
};

export type GitLabServerConfig = {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
};
