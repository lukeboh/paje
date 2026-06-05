import inquirer from "inquirer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { setLocale, t } from "../../i18n/index.js";
import { GitLabApi } from "./gitlabApi.js";
import { resolveGitSyncConfig } from "./core/gitSyncConfig.js";
import { buildParameter, type CommandParameters, type ParameterSource } from "./core/parameters.js";
import {
  resolveEnvBooleanWithSource,
  resolveEnvNumberWithSource,
  resolveEnvStringArrayWithSource,
  resolveEnvStringWithSource,
  resolveEnvValueWithSource,
  type EnvResolution,
} from "./core/envResolver.js";
import {
  applyInitialSelectionFromStatusMap,
  buildGitLabTree,
  collectProjectNodesFromNode,
  collectSelectedProjects,
  recomputeTreeSelection,
  toggleTreeNode,
} from "./treeBuilder.js";
import { renderLoadingScreen, renderRepositoryTree, type TuiSelectionResult, type TuiTreeProgress } from "./tui.js";
import {
  getAheadBehind,
  getStatusPorcelain,
  hasGitDir,
  listLocalDirectories,
  readLocalRepoInfo,
} from "./gitRepoScanner.js";
import { TuiSession } from "./tuiSession.js";
import {
  GitLabGroup,
  GitLabProject,
  GitLabTreeNode,
  ParallelSyncOptions,
  RepoSyncStatus,
  RepoSyncState,
} from "./types.js";
import { parallelSync, runGit, type ProgressEvent, type SyncResult, resolveConcurrency } from "./parallelSync.js";
import { LoggerBroker } from "./core/loggerBroker.js";
import {
  createConsoleTransport,
  createFileTransport,
  createGlobalPanelTransport,
} from "./core/loggerTransports.js";
import { resolveLocalPathConflicts, resolveProjectLocalPath } from "./gitPathUtils.js";
import {
  addHostToKnownHosts,
  getIdentityFileForHost,
  getSshConfigPath,
  listSshPublicKeys,
  resolveSshIdentityPath,
  upsertSshConfigHost,
  generatePajeKeyPair,
  isHostInKnownHosts,
  readPublicKey,
  sanitizePublicKey,
  registerKeyInGitLab,
  sshKeyExists,
  ensureGitLabSshKey,
  ensureGitLabPersonalAccessToken,
  validatePersonalAccessToken,
  rotatePersonalAccessToken,
  loadGitCredentials,
  ensurePajeKeyPair,
  loadEnvConfig,
  type EnvConfig,
  type EnvConfigValue,
  type SshKeyInfo,
} from "./sshManager.js";
import { readGitServers, writeGitServers } from "./persistence.js";
import { type GitServerEntry, createGitSyncCore, resolveRepoStatus, resolveParallels } from "./core/gitSyncService.js";

const buildServerPrefix = (server: GitServerEntry): string => {
  const normalizedName = server.name?.trim() || t("cli.sync.defaultServerLabel");
  return `[${normalizedName}]`;
};

const mergeServerList = (servers: GitServerEntry[]): GitServerEntry[] => {
  return servers.map((server) => ({
    ...server,
    id: normalizeBaseUrl(server.baseUrl),
    baseUrl: normalizeBaseUrl(server.baseUrl),
  }));
};

const buildServersHeader = (servers: GitServerEntry[]): string => {
  if (servers.length === 0) {
    return "GitLab";
  }
  const details = servers
    .map((server) => `${server.name} (${server.baseUrl})`)
    .join(" | ");
  const suffix = servers.length === 1 ? t("cli.sync.serverSingle") : t("cli.sync.serverPlural");
  return t("cli.sync.serversHeader", { count: servers.length, suffix, details });
};

const mergeGroupsByPath = (
  entries: Array<{ server: GitServerEntry; groups: GitLabGroup[] }>
): { groups: GitLabGroup[]; idMapByServer: Map<string, Map<number, number>> } => {
  const byPath = new Map<string, GitLabGroup>();
  const idMapByServer = new Map<string, Map<number, number>>();
  let nextId = 1;

  entries.forEach(({ server, groups }) => {
    const localMap = new Map<number, number>();
    groups.forEach((group) => {
      const normalizedPath = group.full_path;
      const existing = byPath.get(normalizedPath);
      if (existing) {
        localMap.set(group.id, existing.id);
        return;
      }
      localMap.set(group.id, nextId);
      nextId += 1;
    });
    idMapByServer.set(server.id, localMap);

    groups.forEach((group) => {
      const normalizedPath = group.full_path;
      if (byPath.has(normalizedPath)) {
        return;
      }
      const mappedId = localMap.get(group.id) ?? nextId;
      const mappedParent = group.parent_id ? localMap.get(group.parent_id) ?? null : null;
      byPath.set(normalizedPath, {
        ...group,
        id: mappedId,
        full_path: normalizedPath,
        parent_id: mappedParent,
      });
    });
  });

  return { groups: Array.from(byPath.values()), idMapByServer };
};

const mergeProjectsByPath = (
  entries: Array<{ server: GitServerEntry; projects: GitLabProject[] }>,
  idMapByServer: Map<string, Map<number, number>>
): { projects: GitLabProject[]; projectIdMapByServer: Map<string, Map<number, number>> } => {
  const byPath = new Map<string, GitLabProject>();
  const projectIdMapByServer = new Map<string, Map<number, number>>();
  let nextProjectId = 1;

  entries.forEach(({ server, projects }) => {
    const groupMap = idMapByServer.get(server.id);
    const localMap = new Map<number, number>();
    projects.forEach((project) => {
      localMap.set(project.id, nextProjectId);
      nextProjectId += 1;
    });
    projectIdMapByServer.set(server.id, localMap);

    projects.forEach((project) => {
      const normalizedPath = `${server.name}/${project.path_with_namespace}`;
      if (byPath.has(normalizedPath)) {
        return;
      }
      const mappedNamespace = project.namespace
        ? {
            ...project.namespace,
            id: groupMap?.get(project.namespace.id) ?? project.namespace.id,
            full_path: project.namespace.full_path,
          }
        : project.namespace;
      const mappedId = localMap.get(project.id) ?? nextProjectId;
      byPath.set(normalizedPath, {
        ...project,
        id: mappedId,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        namespace: mappedNamespace,
        pajeOriginalPathWithNamespace: project.path_with_namespace,
        pajeServerName: server.name,
      });
    });
  });

  return { projects: Array.from(byPath.values()), projectIdMapByServer };
};
type GitSyncCliOptions = {
  baseDir?: string;
  verbose?: boolean;
  serverName?: string;
  baseUrl?: string;
  useBasicAuth?: boolean;
  username?: string;
  password?: string;
  userEmail?: string;
  keyLabel?: string;
  passphrase?: string;
  publicKeyPath?: string;
  envFile?: string;
  locale?: string;
  prepareLocalDirs?: boolean;
  noSummary?: boolean;
  noPublicRepos?: boolean;
  noArchivedRepos?: boolean;
  filter?: string;
  syncRepos?: string;
  dryRun?: boolean;
  parallels?: string;
};

const parseBooleanFlag = (value?: string | boolean): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === "true";
};

type RepoSummary = {
  total: number;
  publicCount: number;
  archivedCount: number;
  byStatus: Record<RepoSyncState, number>;
};

export type TreePrintNode = {
  label: string;
  status?: RepoSyncStatus;
  children?: TreePrintNode[];
};

const STATUS_COLOR: Record<RepoSyncState, string> = {
  SYNCED: "green",
  BEHIND: "red",
  AHEAD: "blue",
  DIVERGED: "magenta",
  REMOTE: "orange",
  EMPTY: "magenta",
  LOCAL: "red",
  UNCOMMITTED: "red",
};

const ANSI_COLOR: Record<string, string> = {
  green: "\u001b[32m",
  red: "\u001b[31m",
  blue: "\u001b[34m",
  orange: "\u001b[33m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
  yellow: "\u001b[33m",
  reset: "\u001b[0m",
};

const BRANCH_COLOR: Record<string, string> = {
  main: "cyan",
  master: "magenta",
  stable: "green",
  develop: "yellow",
};

const colorize = (value: string, color?: string): string => {
  if (!color) {
    return value;
  }
  return `${ANSI_COLOR[color] ?? ""}${value}${ANSI_COLOR.reset}`;
};

const resolveBranchColor = (branch: string): string | undefined => {
  const normalized = branch.trim().toLowerCase();
  if (normalized.startsWith("develop")) {
    return BRANCH_COLOR.develop;
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
  return undefined;
};

const createSummary = (): RepoSummary => ({
  total: 0,
  publicCount: 0,
  archivedCount: 0,
  byStatus: {
    SYNCED: 0,
    BEHIND: 0,
    AHEAD: 0,
    DIVERGED: 0,
    REMOTE: 0,
    EMPTY: 0,
    LOCAL: 0,
    UNCOMMITTED: 0,
  },
});

const renderSummaryLines = (summary: RepoSummary): string[] => {
  const entries: Array<[string, number]> = [
    [t("cli.summary.repositoriesIdentified"), summary.total],
    [t("cli.summary.public"), summary.publicCount],
    [t("cli.summary.archived"), summary.archivedCount],
    [t("cli.summary.synced"), summary.byStatus.SYNCED],
    [t("cli.summary.behind"), summary.byStatus.BEHIND],
    [t("cli.summary.ahead"), summary.byStatus.AHEAD],
    [t("cli.summary.diverged"), summary.byStatus.DIVERGED],
    [t("cli.summary.remote"), summary.byStatus.REMOTE],
    [t("cli.summary.empty"), summary.byStatus.EMPTY],
    [t("cli.summary.local"), summary.byStatus.LOCAL],
    [t("cli.summary.uncommitted"), summary.byStatus.UNCOMMITTED],
  ];
  const labelWidth = Math.max(...entries.map(([label]) => label.length)) + 2;
  const formatLine = (label: string, value: number): string => `${label.padEnd(labelWidth)}${value}`;
  return [
    t("cli.summary.header"),
    ...entries.map(([label, value]) => formatLine(label, value)),
  ];
};

export const formatRepoStatus = (status: RepoSyncStatus): string => {
  const state = status.state.toLowerCase();
  const delta = status.delta ? ` ${status.delta}` : "";
  const branchColor = resolveBranchColor(status.branch);
  const stateColor = STATUS_COLOR[status.state];
  const branchLabel = colorize(status.branch, branchColor);
  const stateLabel = colorize(`${state}${delta}`, stateColor);
  return `[${branchLabel}, ${stateLabel}]`;
};

export const renderTreeLines = (rootLabel: string, nodes: TreePrintNode[]): string[] => {
  const lines: string[] = [rootLabel];
  const walk = (items: TreePrintNode[], prefix: string): void => {
    items.forEach((node, index) => {
      const isLast = index === items.length - 1;
      const suffix = node.status ? ` ${formatRepoStatus(node.status)}` : "";
      lines.push(`${prefix}+ ${node.label}${suffix}`);
      if (node.children && node.children.length > 0) {
        const nextPrefix = `${prefix}${isLast ? "  " : "| "}`;
        walk(node.children, nextPrefix);
      }
    });
  };
  walk(nodes, "");
  return lines;
};

export const buildHierarchyTree = (
  projects: GitLabProject[],
  statuses: Record<number, RepoSyncStatus>,
  localPaths: string[] = [],
  localStatuses: Record<string, RepoSyncStatus> = {}
): TreePrintNode[] => {
  const root: TreePrintNode = { label: "__root__", children: [] };
  const ensureChild = (parent: TreePrintNode, label: string): TreePrintNode => {
    const existing = parent.children?.find((child) => child.label === label);
    if (existing) {
      return existing;
    }
    const created: TreePrintNode = { label, children: [] };
    parent.children = parent.children ?? [];
    parent.children.push(created);
    return created;
  };

  projects.forEach((project) => {
    const displayPath = project.pajeOriginalPathWithNamespace ?? project.path_with_namespace;
    const segments = displayPath.split("/").filter(Boolean);
    let cursor = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const node = ensureChild(cursor, segment);
      if (isLeaf) {
        node.status = statuses[project.id];
      }
      cursor = node;
    });
  });

  localPaths.forEach((localPath) => {
    const segments = localPath.split("/").filter(Boolean);
    let cursor = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const node = ensureChild(cursor, segment);
      if (isLeaf) {
        node.status = localStatuses[localPath];
      }
      cursor = node;
    });
  });

  const clearNonLeafStatus = (nodes: TreePrintNode[]): void => {
    nodes.forEach((node) => {
      if (node.children && node.children.length > 0) {
        node.status = undefined;
        clearNonLeafStatus(node.children);
      }
    });
  };

  const sortNodes = (nodes: TreePrintNode[]): void => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
    nodes.forEach((node) => {
      if (node.children && node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  };

  clearNonLeafStatus(root.children ?? []);
  sortNodes(root.children ?? []);

  return root.children ?? [];
};


const buildLocalStatusMap = async (
  baseDir: string,
  knownPaths: Set<string>
): Promise<{ localPaths: string[]; statusMap: Record<string, RepoSyncStatus> }> => {
  const allDirs = await listLocalDirectories(baseDir);
  const localPaths = allDirs
    .filter((dir) => !knownPaths.has(dir))
    .map((dir) => path.relative(baseDir, dir));
  const statusEntries = await Promise.all(
    localPaths.map(async (relativePath) => {
      const targetPath = path.join(baseDir, relativePath);
      const status = await resolveRepoStatus({
        targetPath,
        knownRemote: false,
      });
      return [relativePath, status] as const;
    })
  );
  return {
    localPaths,
    statusMap: Object.fromEntries(statusEntries),
  };
};

export const shouldConfirmRemoval = (status?: RepoSyncStatus): boolean => {
  if (!status) {
    return false;
  }
  if (status.state === "UNCOMMITTED") {
    return true;
  }
  if (status.state === "AHEAD") {
    return true;
  }
  if (status.state === "DIVERGED") {
    return true;
  }
  return false;
};

const confirmRemoval = async (options: {
  repoLabel: string;
  status?: RepoSyncStatus;
  session?: TuiSession;
}): Promise<boolean> => {
  if (!shouldConfirmRemoval(options.status)) {
    return true;
  }
  const message = t("cli.progress.removeConfirm", { repo: options.repoLabel });
  if (options.session) {
    const confirmed = await options.session.promptConfirm({
      title: t("app.gitSyncTitle"),
      message,
      defaultValue: false,
    });
    return Boolean(confirmed);
  }
  const response = (await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message,
      default: false,
    },
  ])) as { confirm: boolean };
  return Boolean(response.confirm);
};

type SshKeyStoreCliOptions = {
  verbose?: boolean;
  serverName?: string;
  baseUrl?: string;
  username?: string;
  userEmail?: string;
  password?: string;
  useBasicAuth?: boolean;
  keyLabel?: string;
  passphrase?: string;
  publicKeyPath?: string;
  keyOverwrite?: boolean;
  retryDelayMs?: number;
  maxAttempts?: number;
  envFile?: string;
  tokenName?: string;
  tokenScopes?: string;
  tokenExpiresAt?: string;
  baseDir?: string;
  noPublicRepos?: boolean;
  noArchivedRepos?: boolean;
  filter?: string;
  syncRepos?: string;
  locale?: string;
};

export const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

type MergeResult = {
  servers: GitServerEntry[];
  updated: boolean;
};

export const mergeServer = (servers: GitServerEntry[], server: GitServerEntry): MergeResult => {
  const normalized = normalizeBaseUrl(server.baseUrl);
  const existingIndex = servers.findIndex((item) => normalizeBaseUrl(item.baseUrl) === normalized);
  const sanitized = {
    ...server,
    id: normalized,
    baseUrl: normalized,
  };

  if (existingIndex >= 0) {
    const updated = [...servers];
    updated[existingIndex] = { ...updated[existingIndex], ...sanitized };
    return { servers: updated, updated: true };
  }

  return { servers: [...servers, sanitized], updated: false };
};

export const promptGitServer = async (
  session?: TuiSession,
  overrides?: Partial<GitServerEntry>
): Promise<GitServerEntry> => {
  if (session) {
    const form = await session.promptForm<{ name: string; baseUrl: string; username: string }>({
      title: t("cli.prompt.server.title"),
      fields: [
        {
          name: "name",
          label: t("cli.prompt.server.fields.name"),
          defaultValue: overrides?.name ?? "GitLab",
        },
        {
          name: "baseUrl",
          label: t("cli.prompt.server.fields.baseUrl"),
          defaultValue: overrides?.baseUrl ?? "https://gitlab.com",
        },
        {
          name: "username",
          label: t("cli.prompt.server.fields.username"),
          description: t("cli.prompt.server.fields.usernameDesc"),
          defaultValue: overrides?.username ?? "",
        },
      ],
    });
    const useBasicAuth =
      overrides?.useBasicAuth ??
      (await session.promptConfirm({
      title: t("cli.prompt.server.title"),
      message: t("cli.prompt.server.confirmBasicAuth"),
      defaultValue: false,
    }));

    return {
      id: form?.baseUrl ?? overrides?.baseUrl ?? "",
      name: form?.name ?? overrides?.name ?? "GitLab",
      baseUrl: form?.baseUrl ?? overrides?.baseUrl ?? "https://gitlab.com",
      useBasicAuth: useBasicAuth ?? false,
      username: form?.username ?? overrides?.username ?? "",
    };
  }

  const answers = (await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: t("cli.prompt.server.fields.name"),
      default: overrides?.name ?? "GitLab",
    },
    {
      type: "input",
      name: "baseUrl",
      message: t("cli.prompt.server.fields.baseUrl"),
      default: overrides?.baseUrl ?? "https://gitlab.com",
    },
    {
      type: "confirm",
      name: "useBasicAuth",
      message: t("cli.prompt.server.confirmBasicAuth"),
      default: overrides?.useBasicAuth ?? false,
    },
    {
      type: "input",
      name: "username",
      message: t("cli.prompt.server.fields.username"),
      when: (answers) => Boolean(answers.useBasicAuth),
      default: overrides?.username ?? "",
    },
  ])) as { name: string; baseUrl: string; useBasicAuth: boolean; username?: string };

  return {
    id: answers.baseUrl ?? overrides?.baseUrl ?? "",
    name: answers.name ?? overrides?.name ?? "GitLab",
    baseUrl: answers.baseUrl ?? overrides?.baseUrl ?? "https://gitlab.com",
    useBasicAuth: answers.useBasicAuth,
    username: answers.username ?? overrides?.username,
  };
};

export const promptBasicAuthPassword = async (
  username: string,
  session?: TuiSession,
  presetPassword?: string
): Promise<string> => {
  if (presetPassword) {
    return presetPassword;
  }
  if (session) {
    const form = await session.promptForm<{ password: string }>({
      title: t("cli.prompt.basicAuth.title"),
      fields: [
        {
          name: "password",
          label: t("cli.prompt.basicAuth.passwordLabel", { username }),
          secret: true,
          description: t("cli.prompt.basicAuth.passwordDesc"),
        },
      ],
    });
    return form?.password ?? "";
  }

  const answers = (await inquirer.prompt([
    { type: "password", name: "password", message: t("cli.prompt.basicAuth.passwordLabel", { username }) },
  ])) as { password: string };
  return answers.password;
};

const ensureSshKey = async (
  api: GitLabApi,
  session?: TuiSession,
  verbose?: boolean,
  cli?: GitSyncCliOptions
): Promise<void> => {
  const existingKeys = listSshPublicKeys();
  const server = api.getServerHost();
  let associatedIdentityPath = getIdentityFileForHost(server);
  if (associatedIdentityPath) {
    const resolved = resolveSshIdentityPath(associatedIdentityPath);
    if (!fs.existsSync(resolved)) {
      const message = t("cli.prompt.sshKey.missingKey", { server, path: associatedIdentityPath });
      if (session) {
        await session.showMessage({ title: t("cli.prompt.sshKey.title"), message });
      } else {
        console.log(message);
      }
      associatedIdentityPath = null;
    }
  }

  if (associatedIdentityPath) {
    await ensureKnownHost(server, session, verbose);
    await reportSshPersistenceStatus(server, session);
    return;
  }

  if (!associatedIdentityPath && existingKeys.length > 0) {
    if (cli?.publicKeyPath) {
      const selectedKey = cli.publicKeyPath;
      if (!fs.existsSync(selectedKey)) {
        const message = t("cli.prompt.sshKey.missingProvidedKey", { path: selectedKey });
        if (session) {
          await session.showMessage({ title: t("cli.prompt.sshKey.title"), message });
        } else {
          console.log(message);
        }
        return;
      }
      const key = sanitizePublicKey(readPublicKey(selectedKey));
      upsertSshConfigHost(server, selectedKey.replace(/\.pub$/, ""));
      await ensureKnownHost(server, session, verbose);
      await reportSshPersistenceStatus(server, session);
      if (api.hasAuth()) {
        try {
          await registerKeyInGitLab(api, `paje-existing-${Date.now()}`, key);
        } catch (error) {
          const details = (error as { details?: { method: string; url: string; status: number; responseBody: string; curl: string } })
            .details;
          const message = details
            ? t("cli.errors.gitlab.registerKeyDetails", {
                status: details.status,
                url: details.url,
                response: details.responseBody,
                curl: details.curl,
              })
            : t("cli.errors.gitlab.registerKey", {
                message: error instanceof Error ? error.message : t("cli.errors.unknown"),
              });
          if (session) {
            await session.showMessage({ title: t("cli.prompt.gitlab.title"), message });
          } else {
            console.log(message);
          }
        }
      }
      return;
    }
    let choice: "existing" | "generate" = "generate";
    if (session) {
      const selection = await session.promptList({
        title: t("cli.prompt.sshKey.title"),
        message: t("cli.prompt.sshKey.selectOption"),
        choices: [
          {
            label: t("cli.prompt.sshKey.optionExisting"),
            value: "existing",
            description: t("cli.prompt.sshKey.optionExistingDesc"),
          },
          {
            label: t("cli.prompt.sshKey.optionGenerate"),
            value: "generate",
            description: t("cli.prompt.sshKey.optionGenerateDesc"),
          },
        ],
      });
      choice = (selection ?? "generate") as "existing" | "generate";
    } else {
      const promptChoice = (await inquirer.prompt([
        {
          name: "choice",
          type: "list",
          message: t("cli.prompt.sshKey.title"),
          choices: [
            { name: t("cli.prompt.sshKey.optionExisting"), value: "existing" },
            { name: t("cli.prompt.sshKey.optionGenerate"), value: "generate" },
          ],
        },
      ])) as { choice: "existing" | "generate" };
      choice = promptChoice.choice;
    }

    if (choice === "existing") {
      let selectedKey: string | null = null;
      if (session) {
        selectedKey = await session.promptList({
          title: t("cli.prompt.sshKey.title"),
          message: t("cli.prompt.sshKey.selectPublicKey"),
          choices: existingKeys.map((key) => ({
            label: key,
            value: key,
            description: t("cli.prompt.sshKey.confirmPublicKeyDesc"),
          })),
        });
      } else {
        const promptKey = (await inquirer.prompt([
          {
            name: "selectedKey",
            type: "list",
            message: t("cli.prompt.sshKey.selectPublicKey"),
            choices: existingKeys,
          },
        ])) as { selectedKey: string };
        selectedKey = promptKey.selectedKey;
      }

      if (!selectedKey) {
        return;
      }

      const key = sanitizePublicKey(readPublicKey(selectedKey));
      upsertSshConfigHost(server, selectedKey.replace(/\.pub$/, ""));
      await ensureKnownHost(server, session, verbose);
      await reportSshPersistenceStatus(server, session);
      if (api.hasAuth()) {
        try {
          await registerKeyInGitLab(api, `paje-existing-${Date.now()}`, key);
        } catch (error) {
          const details = (error as { details?: { method: string; url: string; status: number; responseBody: string; curl: string } })
            .details;
          const message = details
            ? t("cli.errors.gitlab.registerKeyDetails", {
                status: details.status,
                url: details.url,
                response: details.responseBody,
                curl: details.curl,
              })
            : t("cli.errors.gitlab.registerKey", {
                message: error instanceof Error ? error.message : t("cli.errors.unknown"),
              });
          if (session) {
            await session.showMessage({ title: t("cli.prompt.gitlab.title"), message });
          } else {
            console.log(message);
          }
        }
      }
      return;
    }
  }

  let passphrase: string | null = cli?.passphrase ?? null;
  let keyLabel: string | null = cli?.keyLabel ?? null;
  if (session) {
    if (cli?.keyLabel) {
      keyLabel = cli.keyLabel;
    }
    if (cli?.passphrase) {
      passphrase = cli.passphrase;
    }
    if (cli?.keyLabel || cli?.passphrase) {
      // não abrir formulário se parâmetros foram fornecidos
    } else {
      const form = await session.promptForm<{ keyLabel: string; passphrase: string }>({
        title: t("cli.prompt.sshKey.title"),
        fields: [
        {
          name: "keyLabel",
          label: t("cli.prompt.sshKey.keyLabelPrompt"),
          defaultValue: "paje",
          description: t("cli.prompt.sshKey.keyLabelDesc"),
        },
        {
          name: "passphrase",
          label: t("cli.prompt.sshKey.passphrasePrompt"),
          secret: true,
          description: t("cli.prompt.sshKey.passphraseDesc"),
        },
        ],
      });
      keyLabel = form?.keyLabel ?? "paje";
      passphrase = form?.passphrase ?? null;
    }
  } else {
    if (!cli?.keyLabel) {
      const promptLabel = (await inquirer.prompt([
        { name: "keyLabel", message: t("cli.prompt.sshKey.keyLabelPrompt"), type: "input", default: "paje" },
      ])) as { keyLabel?: string };
      keyLabel = promptLabel.keyLabel ?? "paje";
    }
    if (!cli?.passphrase) {
      const promptPass = (await inquirer.prompt([
        { name: "passphrase", message: t("cli.prompt.sshKey.passphrasePrompt"), type: "password" },
      ])) as { passphrase?: string };
      passphrase = promptPass.passphrase ?? null;
    }
  }

  let resolvedLabel = keyLabel || "paje";
  while (sshKeyExists(resolvedLabel)) {
    if (session) {
      session.showInlineError(t("cli.prompt.sshKey.keyExists", { label: resolvedLabel }));
      const retryForm = await session.promptForm<{ keyLabel: string; passphrase: string }>({
        title: t("cli.prompt.sshKey.title"),
        fields: [
          {
            name: "keyLabel",
            label: t("cli.prompt.sshKey.keyLabelPrompt"),
            defaultValue: resolvedLabel,
            description: t("cli.prompt.sshKey.keyLabelDesc"),
          },
          {
            name: "passphrase",
            label: t("cli.prompt.sshKey.passphrasePrompt"),
            secret: true,
            description: t("cli.prompt.sshKey.passphraseDesc"),
          },
        ],
      });
      resolvedLabel = retryForm?.keyLabel ?? resolvedLabel;
      passphrase = retryForm?.passphrase ?? passphrase;
    } else {
      console.log(t("cli.prompt.sshKey.keyExists", { label: resolvedLabel }));
      break;
    }
  }

  if (sshKeyExists(resolvedLabel)) {
    return;
  }

      const keyInfo = await generatePajeKeyPair(passphrase || undefined, resolvedLabel);
      const sanitizedKey = sanitizePublicKey(keyInfo.publicKey);
      upsertSshConfigHost(server, keyInfo.privateKeyPath);
      await ensureKnownHost(server, session, verbose);
      await reportSshPersistenceStatus(server, session);
      if (api.hasAuth()) {
        try {
          await registerKeyInGitLab(api, `paje-${Date.now()}`, sanitizedKey);
        } catch (error) {
          const details = (error as { details?: { method: string; url: string; status: number; responseBody: string; curl: string } })
            .details;
          const message = details
            ? t("cli.errors.gitlab.registerKeyDetails", {
                status: details.status,
                url: details.url,
                response: details.responseBody,
                curl: details.curl,
              })
            : t("cli.errors.gitlab.registerKey", {
                message: error instanceof Error ? error.message : t("cli.errors.unknown"),
              });
          if (session) {
            await session.showMessage({ title: t("cli.prompt.gitlab.title"), message });
          } else {
            console.log(message);
          }
        }
      }
};

const ensureKnownHost = async (server: string, session?: TuiSession, verbose?: boolean): Promise<void> => {
  if (await isHostInKnownHosts(server)) {
    return;
  }
  let confirm = true;
  if (session) {
    confirm =
      (await session.promptConfirm({
        title: t("cli.prompt.trust.title"),
        message: t("cli.prompt.trust.confirmKnownHost", { server }),
        defaultValue: true,
      })) ?? true;
  } else {
    const promptConfirm = (await inquirer.prompt([
      {
        name: "confirm",
        type: "confirm",
        message: t("cli.prompt.trust.confirmKnownHost", { server }),
        default: true,
      },
    ])) as { confirm: boolean };
    confirm = promptConfirm.confirm;
  }

  if (!confirm) {
    return;
  }

  const added = await addHostToKnownHosts(server, {
    verbose,
    logger: session
      ? (message) => {
          session.showMessage({ title: t("cli.prompt.verbose.title"), message });
        }
      : undefined,
  });
  if (!added) {
    const baseMessage = t("cli.prompt.trust.cannotAddHost", { server });
    const guidance = t("cli.prompt.trust.sshPort22Guidance");
    const message = `${baseMessage}\n${guidance}`;
    if (session) {
      await session.showMessage({ title: t("cli.prompt.trust.title"), message });
    } else {
      console.log(message);
    }
  }
};

const hasValidSshAssociation = (host: string): boolean => {
  const identityPath = getIdentityFileForHost(host);
  if (!identityPath) {
    return false;
  }
  return fs.existsSync(resolveSshIdentityPath(identityPath));
};

const reportSshPersistenceStatus = async (server: string, session?: TuiSession): Promise<void> => {
  const sshDir = path.join(os.homedir(), ".ssh");
  const configPath = getSshConfigPath();
  const configExists = fs.existsSync(configPath);
  const knownHostsPath = path.join(sshDir, "known_hosts");
  const knownHostsExists = fs.existsSync(knownHostsPath);

  if (configExists && knownHostsExists) {
    return;
  }

  const missing = [
    configExists ? null : "~/.ssh/config",
    knownHostsExists ? null : "~/.ssh/known_hosts",
  ].filter(Boolean);
  const message = t("cli.prompt.persistence.missing", { paths: missing.join(" e ") });
  if (session) {
    await session.showMessage({ title: t("cli.prompt.sshKey.title"), message });
  } else {
    console.log(message);
  }
};

const resolveEnvPaths = (envFile?: string): string[] | undefined => {
  if (!envFile) {
    return undefined;
  }
  return [envFile];
};

const defaultEnvPath = path.join(os.homedir(), ".paje", "env.yaml");

const resolveEnvFileFromCli = (envFile?: string): string | undefined => {
  if (envFile && envFile.trim()) {
    return envFile;
  }
  return defaultEnvPath;
};

export const resolveEnvValue = <T extends EnvConfigValue>(
  cliValue: T | undefined,
  env: EnvConfig,
  key: string
): T | undefined => {
  if (cliValue !== undefined && cliValue !== null && String(cliValue).trim() !== "") {
    return cliValue;
  }
  const value = env[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  return value as T;
};

export const resolveEnvString = (cliValue: string | undefined, env: EnvConfig, key: string): string | undefined => {
  const resolved = resolveEnvValue(cliValue, env, key);
  if (resolved === undefined) {
    return undefined;
  }
  return String(resolved);
};

export const resolveEnvBoolean = (cliValue: boolean | undefined, env: EnvConfig, key: string): boolean | undefined => {
  if (cliValue !== undefined) {
    return cliValue;
  }
  const value = env[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return undefined;
};

export const resolveEnvNumber = (cliValue: number | undefined, env: EnvConfig, key: string): number | undefined => {
  if (cliValue !== undefined && !Number.isNaN(cliValue)) {
    return cliValue;
  }
  const value = env[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

export const resolveEnvStringArray = (cliValue: string | undefined, env: EnvConfig, key: string): string | undefined => {
  if (cliValue && cliValue.trim()) {
    return cliValue;
  }
  const value = env[key];
  if (Array.isArray(value)) {
    return value.join(",");
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
};

export const resolveHomePath = (value?: string): string | undefined => {
  if (!value) {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return value;
};

const storeSshKeyOnly = async (
  server: GitServerEntry,
  session?: TuiSession,
  cli?: SshKeyStoreCliOptions
): Promise<void> => {
  const logger = session
    ? (message: string) => {
        session.showMessage({ title: t("cli.prompt.sshKey.title"), message });
      }
    : console.log;
  const serverHost = new URL(server.baseUrl).hostname;

  const envConfig = loadEnvConfig({ envFile: resolveEnvFileFromCli(cli?.envFile) });
  const hasCliArg = (flag: string): boolean => {
    const dashed = `--${flag}`;
    return process.argv.some((arg) => arg === dashed || arg.startsWith(`${dashed}=`));
  };
  const resolveEnvOrCliString = (cliValue: string | undefined, key: string, flag: string): string | undefined => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvString(resolvedCli, envConfig, key) ?? cliValue;
  };
  const resolveEnvOrCliBoolean = (cliValue: boolean | undefined, key: string, flag: string): boolean | undefined => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvBoolean(resolvedCli, envConfig, key) ?? cliValue;
  };
  const resolveEnvOrCliNumber = (cliValue: number | undefined, key: string, flag: string): number | undefined => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvNumber(resolvedCli, envConfig, key) ?? cliValue;
  };

  let resolvedUsername = resolveEnvOrCliString(cli?.username?.trim(), "username", "username");
  if (!resolvedUsername) {
    if (session) {
      const form = await session.promptForm<{ username: string }>({
        title: t("cli.prompt.gitlab.title"),
        fields: [
          {
            name: "username",
            label: t("cli.prompt.server.fields.username"),
            description: t("cli.prompt.server.fields.usernameDesc"),
          },
        ],
      });
      resolvedUsername = form?.username?.trim();
    } else {
      const promptUser = (await inquirer.prompt([
        { name: "username", message: t("cli.prompt.server.fields.username"), type: "input" },
      ])) as { username?: string };
      resolvedUsername = promptUser.username?.trim();
    }
  }

  const useBasicAuth = server.useBasicAuth ?? cli?.useBasicAuth ?? false;
  if (useBasicAuth) {
    if (process.env.PAJE_SKIP_SSH_STORE === "1") {
      logger?.(t("cli.log.skipRemoteToken"));
      return;
    }

    let basicAuthPassword = resolveEnvOrCliString(
      hasCliArg("password") ? cli?.password : undefined,
      "password",
      "password"
    );
    if (!basicAuthPassword) {
      if (session) {
        const form = await session.promptForm<{ password: string }>({
          title: t("cli.prompt.gitlab.title"),
          fields: [
            {
              name: "password",
              label: t("cli.prompt.basicAuth.passwordLabelDefault"),
              secret: true,
              description: t("cli.prompt.basicAuth.passwordDesc"),
            },
          ],
        });
        basicAuthPassword = form?.password ?? "";
      } else {
        const promptPass = (await inquirer.prompt([
          { name: "password", message: t("cli.prompt.basicAuth.passwordLabelDefault"), type: "password" },
        ])) as { password?: string };
        basicAuthPassword = promptPass.password ?? "";
      }
    }

    const basicAuthCredentials = loadGitCredentials({
      envFilePaths: resolveEnvPaths(resolveEnvFileFromCli(cli?.envFile)),
      allowProcessEnv: false,
    });

    const normalizedBaseUrlBA = normalizeBaseUrl(server.baseUrl);
    const existingServersBA = readGitServers<GitServerEntry[]>([]);
    const existingServerBA = existingServersBA.find((item) => normalizeBaseUrl(item.baseUrl) === normalizedBaseUrlBA);

    if (existingServerBA?.token) {
      try {
        const tokenStatus = await validatePersonalAccessToken({
          baseUrl: normalizedBaseUrlBA,
          token: existingServerBA.token,
          fetchImpl: globalThis.fetch,
          logger,
        });
        if (tokenStatus.valid) {
          const expiresAt = tokenStatus.expiresAt ?? t("cli.log.notInformed");
          const scopes =
            tokenStatus.scopes && tokenStatus.scopes.length > 0
              ? tokenStatus.scopes.join(", ")
              : t("cli.log.notInformed");
          const active = tokenStatus.active ?? true;
          logger?.(t("cli.log.tokenValid", { baseUrl: normalizedBaseUrlBA }));
          logger?.(t("cli.log.tokenDetails", { active: String(active), expiresAt, scopes }));
          logger?.(t("cli.log.tokenReuse"));
          return;
        }
        logger?.(t("cli.log.tokenInvalid"));
      } catch (error) {
        const message = error instanceof Error ? error.message : t("cli.errors.unknown");
        logger?.(t("cli.log.tokenValidateFail", { message }));
      }

      logger?.(t("cli.log.tokenRotateStart", { baseUrl: normalizedBaseUrlBA }));
      try {
        const rotated = await rotatePersonalAccessToken({
          baseUrl: normalizedBaseUrlBA,
          token: existingServerBA.token,
          fetchImpl: globalThis.fetch,
          logger,
        });
        const serverWithTokenBA: GitServerEntry = { ...server, token: rotated.token };
        const mergedServersBA = mergeServer(existingServersBA, serverWithTokenBA);
        writeGitServers(mergedServersBA.servers);
        logger?.(t("cli.log.tokenRotateSuccess", { baseUrl: normalizedBaseUrlBA }));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : t("cli.errors.unknown");
        logger?.(t("cli.log.tokenRotateFail", { message }));
      }
    }

    const resolvedTokenNameBA = resolveEnvOrCliString(cli?.tokenName?.trim(), "tokenName", "token-name");
    const resolvedTokenScopesBA = resolveEnvStringArray(
      hasCliArg("token-scopes") ? cli?.tokenScopes : undefined,
      envConfig,
      "tokenScopes"
    );
    const resolvedTokenExpiresAtBA = resolveEnvOrCliString(cli?.tokenExpiresAt, "tokenExpiresAt", "token-expires-at");
    const tokenNameBA = resolvedTokenNameBA ?? "";
    const scopeListBA = resolvedTokenScopesBA
      ? resolvedTokenScopesBA.split(",").map((item) => item.trim()).filter(Boolean)
      : ["read_repository", "read_api", "read_virtual_registry", "self_rotate"];
    if (!resolvedTokenNameBA) {
      logger?.(t("cli.log.tokenNameMissing"));
      return;
    }

    const tokenResultBA = await ensureGitLabPersonalAccessToken({
      baseUrl: normalizedBaseUrlBA,
      name: tokenNameBA,
      scopes: scopeListBA,
      expiresAt: resolvedTokenExpiresAtBA,
      credentials: {
        ...basicAuthCredentials,
        username: resolvedUsername ?? basicAuthCredentials.username,
        password: basicAuthPassword ?? basicAuthCredentials.password ?? "",
      },
      fetchImpl: globalThis.fetch,
      logger,
      maxAttempts: resolveEnvOrCliNumber(cli?.maxAttempts, "maxAttempts", "max-attempts"),
      retryDelayMs: resolveEnvOrCliNumber(cli?.retryDelayMs, "retryDelayMs", "retry-delay-ms"),
    });

    const basicAuthServerWithToken: GitServerEntry = { ...server, token: tokenResultBA.token };
    const basicAuthMergedServers = mergeServer(existingServersBA, basicAuthServerWithToken);
    writeGitServers(basicAuthMergedServers.servers);
    return;
  }

  const resolvedPublicKeyPath = resolveEnvOrCliString(cli?.publicKeyPath, "publicKeyPath", "public-key-path");
  let keyInfo: SshKeyInfo | undefined;
  if (resolvedPublicKeyPath) {
    const selectedKey = resolvedPublicKeyPath;
    if (!fs.existsSync(selectedKey)) {
      const message = t("cli.prompt.sshKey.missingProvidedKey", { path: selectedKey });
      if (session) {
        await session.showMessage({ title: t("cli.prompt.sshKey.title"), message });
      } else {
        console.log(message);
      }
      return;
    }
    keyInfo = {
      publicKeyPath: selectedKey,
      privateKeyPath: selectedKey.replace(/\.pub$/, ""),
      publicKey: readPublicKey(selectedKey),
    };
  } else {
    keyInfo = await ensurePajeKeyPair({
      keyLabel: resolveEnvOrCliString(cli?.keyLabel, "keyLabel", "key-label"),
      passphrase: resolveEnvOrCliString(cli?.passphrase, "passphrase", "passphrase"),
      overwrite: resolveEnvOrCliBoolean(cli?.keyOverwrite, "keyOverwrite", "key-overwrite") ?? false,
      logger,
    });
  }

  upsertSshConfigHost(serverHost, keyInfo.privateKeyPath);
  await ensureKnownHost(serverHost, session, resolveEnvOrCliBoolean(cli?.verbose, "verbose", "verbose"));
  await reportSshPersistenceStatus(serverHost, session);

  if (process.env.PAJE_SKIP_SSH_STORE === "1") {
    logger?.(t("cli.log.skipRemoteStore"));
    return;
  }

  let resolvedPassword = resolveEnvString(undefined, envConfig, "password");
  if (!resolvedPassword) {
    if (session) {
      const form = await session.promptForm<{ password: string }>({
        title: t("cli.prompt.gitlab.title"),
        fields: [
          {
            name: "password",
            label: t("cli.prompt.basicAuth.passwordLabelDefault"),
            secret: true,
            description: t("cli.prompt.basicAuth.passwordDesc"),
          },
        ],
      });
      resolvedPassword = form?.password ?? "";
    } else {
      const promptPass = (await inquirer.prompt([
        { name: "password", message: t("cli.prompt.basicAuth.passwordLabelDefault"), type: "password" },
      ])) as { password?: string };
      resolvedPassword = promptPass.password ?? "";
    }
  }

  const credentials = loadGitCredentials({
    envFilePaths: resolveEnvPaths(resolveEnvFileFromCli(cli?.envFile)),
    allowProcessEnv: false,
  });

  await ensureGitLabSshKey({
    baseUrl: server.baseUrl,
    title: resolveEnvOrCliString(cli?.keyLabel, "keyLabel", "key-label") ?? "paje",
    usageType: "auth_and_signing",
    credentials: {
      ...credentials,
      username: resolvedUsername ?? credentials.username,
      password: resolvedPassword ?? credentials.password ?? "",
    },
    keyInfo,
    fetchImpl: globalThis.fetch,
    logger,
    maxAttempts: resolveEnvOrCliNumber(cli?.maxAttempts, "maxAttempts", "max-attempts"),
    retryDelayMs: resolveEnvOrCliNumber(cli?.retryDelayMs, "retryDelayMs", "retry-delay-ms"),
  });

  if (process.env.PAJE_SKIP_SSH_STORE === "1") {
    logger?.(t("cli.log.skipRemoteToken"));
    return;
  }

  const normalizedBaseUrl = normalizeBaseUrl(server.baseUrl);
  const existingServers = readGitServers<GitServerEntry[]>([]);
  const existingServer = existingServers.find((item) => normalizeBaseUrl(item.baseUrl) === normalizedBaseUrl);

  if (existingServer?.token) {
    try {
      const tokenStatus = await validatePersonalAccessToken({
        baseUrl: normalizedBaseUrl,
        token: existingServer.token,
        fetchImpl: globalThis.fetch,
        logger,
      });
      if (tokenStatus.valid) {
        const expiresAt = tokenStatus.expiresAt ?? t("cli.log.notInformed");
        const scopes = tokenStatus.scopes && tokenStatus.scopes.length > 0 ? tokenStatus.scopes.join(", ") : t("cli.log.notInformed");
        const active = tokenStatus.active ?? true;
        logger?.(t("cli.log.tokenValid", { baseUrl: normalizedBaseUrl }));
        logger?.(t("cli.log.tokenDetails", { active: String(active), expiresAt, scopes }));
        logger?.(t("cli.log.tokenReuse"));
        return;
      }
      logger?.(t("cli.log.tokenInvalid"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("cli.errors.unknown");
      logger?.(t("cli.log.tokenValidateFail", { message }));
    }

    logger?.(t("cli.log.tokenRotateStart", { baseUrl: normalizedBaseUrl }));
    try {
      const rotated = await rotatePersonalAccessToken({
        baseUrl: normalizedBaseUrl,
        token: existingServer.token,
        fetchImpl: globalThis.fetch,
        logger,
      });
      const serverWithToken: GitServerEntry = {
        ...server,
        token: rotated.token,
      };
      const mergedServers = mergeServer(existingServers, serverWithToken);
      writeGitServers(mergedServers.servers);
      logger?.(t("cli.log.tokenRotateSuccess", { baseUrl: normalizedBaseUrl }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("cli.errors.unknown");
      logger?.(t("cli.log.tokenRotateFail", { message }));
    }
  }

  const resolvedTokenName = resolveEnvOrCliString(cli?.tokenName?.trim(), "tokenName", "token-name");
  const resolvedTokenScopes = resolveEnvStringArray(
    hasCliArg("token-scopes") ? cli?.tokenScopes : undefined,
    envConfig,
    "tokenScopes"
  );
  const resolvedTokenExpiresAt = resolveEnvOrCliString(cli?.tokenExpiresAt, "tokenExpiresAt", "token-expires-at");
  const tokenName = resolvedTokenName ?? "";
  const scopeList = resolvedTokenScopes
    ? resolvedTokenScopes.split(",").map((item) => item.trim()).filter(Boolean)
    : ["read_repository", "read_api", "read_virtual_registry", "self_rotate"];
  if (!resolvedTokenName) {
    logger?.(t("cli.log.tokenNameMissing"));
    return;
  }

  const tokenResult = await ensureGitLabPersonalAccessToken({
    baseUrl: normalizedBaseUrl,
    name: tokenName,
    scopes: scopeList,
    expiresAt: resolvedTokenExpiresAt,
    credentials: {
      ...credentials,
      username: resolvedUsername ?? credentials.username,
      password: resolvedPassword ?? credentials.password ?? "",
    },
    fetchImpl: globalThis.fetch,
    logger,
    maxAttempts: resolveEnvOrCliNumber(cli?.maxAttempts, "maxAttempts", "max-attempts"),
    retryDelayMs: resolveEnvOrCliNumber(cli?.retryDelayMs, "retryDelayMs", "retry-delay-ms"),
  });

  const serverWithToken: GitServerEntry = {
    ...server,
    token: tokenResult.token,
  };
  const mergedServers = mergeServer(existingServers, serverWithToken);
  writeGitServers(mergedServers.servers);
};

const findNodeById = (nodes: GitLabTreeNode[], id: string): GitLabTreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
};

const toggleById = (nodes: GitLabTreeNode[], id: string): void => {
  const node = findNodeById(nodes, id);
  if (!node) {
    return;
  }
  toggleTreeNode(node, !(node.selected ?? false));
  nodes.forEach((root) => recomputeTreeSelection(root));
};

const resolveParallelOptions = async (session?: TuiSession): Promise<ParallelSyncOptions> => {
  if (session) {
    const concurrency = await session.promptList<number | "auto">({
      title: t("cli.prompt.parallel.title"),
      message: t("cli.prompt.parallel.level"),
      choices: [
        { label: t("cli.prompt.parallel.auto"), value: "auto", description: t("cli.prompt.parallel.autoDesc") },
        { label: "1", value: 1, description: t("cli.prompt.parallel.oneDesc") },
        { label: "2", value: 2, description: t("cli.prompt.parallel.twoDesc") },
        { label: "4", value: 4, description: t("cli.prompt.parallel.fourDesc") },
        { label: "8", value: 8, description: t("cli.prompt.parallel.eightDesc") },
      ],
    });
    const shallow = await session.promptConfirm({
      title: t("cli.prompt.parallel.title"),
      message: t("cli.prompt.parallel.shallow"),
      defaultValue: false,
    });

    return {
      concurrency: (concurrency ?? "auto") as ParallelSyncOptions["concurrency"],
      shallow: shallow ?? false,
    };
  }

  const { concurrency, shallow } = (await inquirer.prompt([
    {
      name: "concurrency",
      type: "list",
      message: t("cli.prompt.parallel.level"),
      choices: [
        { name: t("cli.prompt.parallel.auto"), value: "auto" },
        { name: "1", value: 1 },
        { name: "2", value: 2 },
        { name: "4", value: 4 },
        { name: "8", value: 8 },
      ],
    },
    {
      name: "shallow",
      type: "confirm",
      message: t("cli.prompt.parallel.shallow"),
      default: false,
    },
  ])) as { concurrency: number | "auto"; shallow: boolean };

  return { concurrency, shallow } as ParallelSyncOptions;
};

const formatProgressValue = (value?: string): string => {
  if (!value) {
    return "--";
  }
  return value;
};

const renderWorkerLine = (event: ProgressEvent, width: number): string => {
  const percent = event.percent ?? 0;
  const filled = Math.round((percent / 100) * width);
  const empty = Math.max(0, width - filled);
  const bar = `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
  const percentLabel = colorize(`${percent.toString().padStart(3, " ")}%`, "cyan");
  const sizeLabel = colorize(formatProgressValue(event.transferred), "white");
  const speedLabel = colorize(formatProgressValue(event.speed), "magenta");
  const phaseLabel = colorize(event.phase.toUpperCase(), "yellow");
  const objectsLabel = event.objectsTotal
    ? colorize(`${event.objectsReceived ?? 0}/${event.objectsTotal} objetos`, "white")
    : colorize("-- objetos", "white");
  return `${bar} ${percentLabel} ${sizeLabel} ${speedLabel} ${objectsLabel} ${phaseLabel} ${event.target.pathWithNamespace}`;
};

const renderProgressBar = (current: number, total: number): string => {
  const width = 20;
  const ratio = total === 0 ? 1 : current / total;
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);
  return `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
};

const formatTransferDetail = (options: {
  progress?: {
    objectsReceived?: number;
    objectsTotal?: number;
    transferred?: string;
    speed?: string;
  };
  status: "cloned" | "pulled" | "pushed" | "skipped" | "failed";
  message?: string;
}): string => {
  if (options.status === "failed") {
    return options.message ? ` (${options.message})` : ` (${t("cli.errors.unknown")})`;
  }
  const parts: string[] = [];
  const received = options.progress?.objectsReceived;
  const total = options.progress?.objectsTotal;
  if (total || received) {
    if (total) {
      parts.push(t("cli.progress.objectsCopied", { received: received ?? 0, total }));
    } else {
      parts.push(t("cli.progress.objectsCopiedSingle", { received: received ?? 0 }));
    }
  }
  if (options.progress?.transferred) {
    parts.push(options.progress.transferred);
  }
  if (options.progress?.speed) {
    parts.push(t("cli.progress.speed", { speed: options.progress.speed }));
  }
  if (parts.length === 0) {
    return "";
  }
  return ` ${parts.join(", ")}`;
};

const parseMiB = (value?: string, isSpeed = false): string => {
  if (!value) {
    return "--";
  }
  const trimmed = value.trim();
  const cleaned = isSpeed ? trimmed.replace("/s", "") : trimmed;
  const match = cleaned.match(/^([\d.,]+)\s*(KiB|MiB|GiB)$/i);
  if (!match) {
    return "--";
  }
  const raw = Number(match[1].replace(",", "."));
  if (Number.isNaN(raw)) {
    return "--";
  }
  const unit = match[2].toLowerCase();
  const inMiB = unit === "kib" ? raw / 1024 : unit === "gib" ? raw * 1024 : raw;
  const label = inMiB.toFixed(2);
  return isSpeed ? `${label} MiB/s` : `${label} MiB`;
};

const formatObjects = (progress?: { objectsReceived?: number; objectsTotal?: number }): string => {
  if (!progress) {
    return "--";
  }
  if (progress.objectsTotal) {
    return `${progress.objectsReceived ?? 0}/${progress.objectsTotal}`;
  }
  if (progress.objectsReceived) {
    return String(progress.objectsReceived);
  }
  return "--";
};

const formatRepoLabel = (value: string, width: number): string => {
  if (value.length <= width) {
    return value.padEnd(width, " ");
  }
  return `${value.slice(0, Math.max(0, width - 1))}?`;
};

const buildParameterSource = (resolution: EnvResolution): ParameterSource => {
  return resolution.source;
};

const buildSshKeyStoreParameters = (options: SshKeyStoreCliOptions, hasCliArg: (flag: string) => boolean): CommandParameters => {
  const hasEnvFileCli = hasCliArg("env-file");
  const resolvedEnvFile = resolveEnvFileFromCli(hasEnvFileCli ? options.envFile : undefined);
  const envFileSource: ParameterSource = hasEnvFileCli && options.envFile?.trim() ? "resolved" : "default";
  const envConfig = loadEnvConfig({ envFile: resolvedEnvFile });

  const resolveEnvOrCliString = (
    cliValue: string | undefined,
    key: string,
    flag: string,
    defaultValue?: string
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvStringWithSource(resolvedCli, envConfig, key, defaultValue);
  };
  const resolveEnvOrCliBoolean = (
    cliValue: boolean | undefined,
    key: string,
    flag: string,
    defaultValue?: boolean
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvBooleanWithSource(resolvedCli, envConfig, key, defaultValue);
  };
  const resolveEnvOrCliNumber = (
    cliValue: number | undefined,
    key: string,
    flag: string,
    defaultValue?: number
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvNumberWithSource(resolvedCli, envConfig, key, defaultValue);
  };
  const resolveEnvOrCliArray = (
    cliValue: string | undefined,
    key: string,
    flag: string
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvStringArrayWithSource(resolvedCli, envConfig, key);
  };

  const baseUrlResolution = resolveEnvOrCliString(options.baseUrl?.trim(), "baseUrl", "base-url", "https://git.tse.jus.br");
  const serverNameResolution = resolveEnvOrCliString(options.serverName, "serverName", "server-name", "GitLab");
  const usernameResolution = resolveEnvOrCliString(options.username, "username", "username");
  const keyLabelResolution = resolveEnvOrCliString(options.keyLabel, "keyLabel", "key-label", "paje");
  const passphraseResolution = resolveEnvOrCliString(options.passphrase, "passphrase", "passphrase");
  const publicKeyPathResolution = resolveEnvOrCliString(options.publicKeyPath, "publicKeyPath", "public-key-path");
  const keyOverwriteResolution = resolveEnvOrCliBoolean(options.keyOverwrite, "keyOverwrite", "key-overwrite", false);
  const retryDelayResolution = resolveEnvOrCliNumber(options.retryDelayMs, "retryDelayMs", "retry-delay-ms");
  const maxAttemptsResolution = resolveEnvOrCliNumber(options.maxAttempts, "maxAttempts", "max-attempts");
  const tokenNameResolution = resolveEnvOrCliString(options.tokenName?.trim(), "tokenName", "token-name");
  const tokenScopesResolution = resolveEnvOrCliArray(options.tokenScopes, "tokenScopes", "token-scopes");
  const tokenExpiresAtResolution = resolveEnvOrCliString(options.tokenExpiresAt, "tokenExpiresAt", "token-expires-at");
  const verboseResolution = resolveEnvOrCliBoolean(options.verbose, "verbose", "verbose", false);

  return {
    command: "git-server-store",
    label: t("parameters.gitServerStore.label"),
    parameters: [
      buildParameter({
        name: "baseUrl",
        description: t("parameters.gitServerStore.baseUrl"),
        value: baseUrlResolution.value ?? "",
        source: buildParameterSource(baseUrlResolution),
      }),
      buildParameter({
        name: "serverName",
        description: t("parameters.gitServerStore.serverName"),
        value: serverNameResolution.value ?? "",
        source: buildParameterSource(serverNameResolution),
      }),
      buildParameter({
        name: "username",
        description: t("parameters.gitServerStore.username"),
        value: usernameResolution.value ?? "",
        source: buildParameterSource(usernameResolution),
      }),
      buildParameter({
        name: "keyLabel",
        description: t("parameters.gitServerStore.keyLabel"),
        value: keyLabelResolution.value ?? "",
        source: buildParameterSource(keyLabelResolution),
      }),
      buildParameter({
        name: "passphrase",
        description: t("parameters.gitServerStore.passphrase"),
        value: passphraseResolution.value ? "********" : "",
        source: buildParameterSource(passphraseResolution),
      }),
      buildParameter({
        name: "publicKeyPath",
        description: t("parameters.gitServerStore.publicKeyPath"),
        value: publicKeyPathResolution.value ?? "",
        source: buildParameterSource(publicKeyPathResolution),
      }),
      buildParameter({
        name: "keyOverwrite",
        description: t("parameters.gitServerStore.keyOverwrite"),
        value: keyOverwriteResolution.value ?? false,
        source: buildParameterSource(keyOverwriteResolution),
      }),
      buildParameter({
        name: "retryDelayMs",
        description: t("parameters.gitServerStore.retryDelayMs"),
        value: retryDelayResolution.value ?? "",
        source: buildParameterSource(retryDelayResolution),
      }),
      buildParameter({
        name: "maxAttempts",
        description: t("parameters.gitServerStore.maxAttempts"),
        value: maxAttemptsResolution.value ?? "",
        source: buildParameterSource(maxAttemptsResolution),
      }),
      buildParameter({
        name: "tokenName",
        description: t("parameters.gitServerStore.tokenName"),
        value: tokenNameResolution.value ?? "",
        source: buildParameterSource(tokenNameResolution),
      }),
      buildParameter({
        name: "tokenScopes",
        description: t("parameters.gitServerStore.tokenScopes"),
        value: tokenScopesResolution.value ?? "",
        source: buildParameterSource(tokenScopesResolution),
      }),
      buildParameter({
        name: "tokenExpiresAt",
        description: t("parameters.gitServerStore.tokenExpiresAt"),
        value: tokenExpiresAtResolution.value ?? "",
        source: buildParameterSource(tokenExpiresAtResolution),
      }),
      buildParameter({
        name: "verbose",
        description: t("parameters.gitServerStore.verbose"),
        value: verboseResolution.value ?? false,
        source: buildParameterSource(verboseResolution),
      }),
      buildParameter({
        name: "envFile",
        description: t("parameters.gitServerStore.envFile"),
        value: resolvedEnvFile ?? "",
        source: envFileSource,
      }),
    ],
  };
};

export const buildInitialParameters = (locale?: string): CommandParameters[] => {
  setLocale(locale);
  const hasCliArg = (_flag: string): boolean => false;
  const resolveCliBoolean = (_flag: string): boolean | undefined => undefined;
  const { parameters: gitSyncParameters } = resolveGitSyncConfig({}, hasCliArg, resolveCliBoolean);
  const sshKeyParameters = buildSshKeyStoreParameters({}, hasCliArg);
  return [gitSyncParameters, sshKeyParameters];
};

export const configureGitSyncCommand = (program: Command, session?: TuiSession): void => {
  program
    .command("git-sync")
    .description(t("cli.command.gitSync.description"))
    .option("-v, --verbose", t("cli.command.gitSync.options.verbose"), false)
    .option("--base-dir <dir>", t("cli.command.gitSync.options.baseDir"), "repos")
    .option("--server-name <name>", t("cli.command.gitSync.options.serverName"))
    .option("--base-url <url>", t("cli.command.gitSync.options.baseUrl"))
    .option("--use-basic-auth", t("cli.command.gitSync.options.useBasicAuth"), false)
    .option("--username <username>", t("cli.command.gitSync.options.username"))
    .option("--user-email <email>", t("cli.command.gitSync.options.userEmail"))
    .option("--password <password>", t("cli.command.gitSync.options.password"))
    .option("--key-label <label>", t("cli.command.gitSync.options.keyLabel"))
    .option("--passphrase <passphrase>", t("cli.command.gitSync.options.passphrase"))
    .option("--public-key-path <path>", t("cli.command.gitSync.options.publicKeyPath"))
    .option("--env-file <path>", t("cli.command.gitSync.options.envFile"))
    .option("--locale <locale>", t("cli.command.gitSync.options.locale"))
    .option("--prepare-local-dirs [value]", t("cli.command.gitSync.options.prepareLocalDirs"), false)
    .option("--no-summary [value]", t("cli.command.gitSync.options.noSummary"), false)
    .option("--no-public-repos [value]", t("cli.command.gitSync.options.noPublicRepos"), false)
    .option("--no-archived-repos [value]", t("cli.command.gitSync.options.noArchivedRepos"), false)
    .option("-f, --filter <pattern>", t("cli.command.gitSync.options.filter"))
    .option("--sync-repos <pattern>", t("cli.command.gitSync.options.syncRepos"))
    .option("--parallels <value>", t("cli.command.gitSync.options.parallels"))
    .option("--dry-run", t("cli.command.gitSync.options.dryRun"), false)
    .action(async function (this: Command, options: GitSyncCliOptions) {
      setLocale(options.locale);
      const logBroker = new LoggerBroker();
      if (!session) {
        logBroker.addTransport(createConsoleTransport("cli-console", "info"));
      }
      logBroker.addTransport(createFileTransport("file", "info"));
      if (session) {
        logBroker.addTransport(createGlobalPanelTransport("tui-panel", "debug"));
      }
      logBroker.info(t("cli.command.gitSync.description"));

      const logToTui = (message: string, level: "info" | "warn" | "error" = "info"): void => {
        if (!session) {
          return;
        }
        logBroker.log(level, message);
      };

      const logDebug = (message: string): void => {
        logBroker.debug(message);
      };

      const logInfo = (message: string): void => {
        logBroker.info(message);
      };

      const logToTuiPlain = (message: string): void => {
        logToTui(message, "info");
      };

      const cliOptions = options;
      const resolveCliBoolean = (flag: string): boolean | undefined => {
        const dashed = `--${flag}`;
        const args = process.argv;
        for (let index = 0; index < args.length; index += 1) {
          const arg = args[index];
          if (arg === dashed) {
            const next = args[index + 1];
            if (!next || next.startsWith("--")) {
              return true;
            }
            return parseBooleanFlag(next);
          }
          if (arg.startsWith(`${dashed}=`)) {
            const value = arg.slice(dashed.length + 1);
            return parseBooleanFlag(value);
          }
        }
        return undefined;
      };
      const hasCliArg = (flag: string): boolean => {
        const dashed = `--${flag}`;
        return process.argv.some((arg) => arg === dashed || arg.startsWith(`${dashed}=`));
      };
      const { config: mergedOptions, parameters: gitSyncParameters } = resolveGitSyncConfig(
        cliOptions,
        hasCliArg,
        resolveCliBoolean
      );
      if (mergedOptions.verbose) {
        logBroker.setTransportLevel("cli-console", "debug");
        logBroker.setTransportLevel("file", "debug");
        logBroker.setTransportLevel("tui-panel", "debug");
      }
      const parametersSummary: CommandParameters[] = [gitSyncParameters];
      if (session) {
        session.setParameters(parametersSummary);
      }

      const storedServers = readGitServers<GitServerEntry[]>([]);
      let servers = mergeServerList(storedServers);

      if (mergedOptions.serverName && mergedOptions.baseUrl) {
        const server: GitServerEntry = {
          id: mergedOptions.baseUrl,
          name: mergedOptions.serverName,
          baseUrl: mergedOptions.baseUrl,
          useBasicAuth: mergedOptions.useBasicAuth ?? false,
          username: mergedOptions.username,
        };
        const merge = mergeServer(servers, server);
        writeGitServers(merge.servers);
        servers = mergeServerList(merge.servers);
      }

      if (servers.length === 0) {
        const server = await promptGitServer(session, {
          name: mergedOptions.serverName,
          baseUrl: mergedOptions.baseUrl,
          useBasicAuth: mergedOptions.useBasicAuth,
          username: mergedOptions.username,
        });
        const merge = mergeServer([], server);
        writeGitServers(merge.servers);
        servers = mergeServerList(merge.servers);
      }

      if (mergedOptions.serverName && !mergedOptions.baseUrl) {
        const normalizedName = mergedOptions.serverName.trim().toLowerCase();
        servers = servers.filter((server) => server.name.trim().toLowerCase() == normalizedName);
      }

      if (mergedOptions.baseUrl) {
        const normalizedBaseUrl = normalizeBaseUrl(mergedOptions.baseUrl);
        servers = servers.filter((server) => normalizeBaseUrl(server.baseUrl) === normalizedBaseUrl);
      }

      if (servers.length === 0) {
        const message = t("cli.prompt.gitlab.noServerConfigured");
        if (session) {
          await session.showMessage({ title: t("cli.prompt.gitlab.title"), message });
        } else {
          console.log(message);
        }
        return;
      }

      const spinnerFrames = ["/", "-", "\\", "|"];
      let spinnerFrameIndex = 0;
      const loadingHandle = session
        ? renderLoadingScreen({
            title: t("app.gitSyncTitle"),
            message: t("tui.loading.repositories"),
            orientation: t("tui.loading.orientation"),
            parameters: session.getParameters(),
            spinnerFrames,
          })
        : null;

      const core = createGitSyncCore();
      const { header, tree, statusMap, projects: filteredProjects } = await core.loadTree({
        config: mergedOptions,
        logger: logBroker,
        onBasicAuthRequired: async (serverName, username) => {
          return promptBasicAuthPassword(username, session, mergedOptions.password);
        },
        onRequestStart: (serverName, requestCount) => {
          const frame = spinnerFrames[spinnerFrameIndex % spinnerFrames.length];
          spinnerFrameIndex += 1;
          logToTui(t("cli.http.accessServers", { frame, count: requestCount }));
          logToTui(t("cli.http.start", { server: serverName, label: "...", count: requestCount }));
        },
      }).finally(() => loadingHandle?.stop());

      if (filteredProjects.length === 0 && tree.length === 0) {
        return;
      }
      if (!session) {
        const defaultBaseDir = mergedOptions.baseDir ?? "repos";
        const resolvedUserName = mergedOptions.username?.trim() || undefined;
        const resolvedUserEmail = mergedOptions.userEmail?.trim() || undefined;
        const resolvedPaths = resolveLocalPathConflicts(filteredProjects);
        const knownPaths = new Set(
          filteredProjects.map((project) =>
            path.join(defaultBaseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project))
          )
        );
        const localScan = await buildLocalStatusMap(defaultBaseDir, knownPaths);
        const treeNodes = buildHierarchyTree(filteredProjects, statusMap, localScan.localPaths, localScan.statusMap);
        renderTreeLines(header, treeNodes).forEach((line) => console.log(line));
        const summary = createSummary();
        summary.total = filteredProjects.length;
        summary.publicCount = filteredProjects.filter((p) => p.visibility === "public").length;
        summary.archivedCount = filteredProjects.filter((p) => p.archived).length;
        Object.values(statusMap).forEach((status) => {
          summary.byStatus[status.state] += 1;
        });
        if (!mergedOptions.noSummary) {
          Object.values(localScan.statusMap).forEach((status) => {
            summary.byStatus[status.state] += 1;
          });
        }
        if (!mergedOptions.noSummary) {
          renderSummaryLines(summary).forEach((line) => logInfo(line));
        }

        if (mergedOptions.syncRepos) {
          let totalCount = 0;
          let completedCount = 0;
          let syncStartAt = 0;
          const allResults: Array<{ status: string; message?: string; target: { id: number; pathWithNamespace: string; branch?: string; localPath: string; defaultBranch?: string | null } }> = [];
          const workerLines = new Map<number, string>();
          const workerStates = new Map<
            number,
            { line: string; targetPath?: string; percent?: number; objectsReceived?: number }
          >();
          const targetWorkerMap = new Map<string, number>();
          const completedTargets = new Set<string>();
          const lastPrinted = new Map<number, { percent?: number; objectsReceived?: number; line?: string }>();
          const historyLines: string[] = [];
          const targetLastUpdateAt = new Map<string, number>();
          const targetLastLine = new Map<string, string>();
          const startedTargets = new Set<string>();
          const targetProgress = new Map<
            string,
            {
              objectsReceived?: number;
              objectsTotal?: number;
              transferred?: string;
              speed?: string;
            }
          >();
          let overallLine = "";
          const useTty = false;
          const progressWidth = 20;
          let blockLines = 1;
          const saveCursor = (): void => {
            if (!useTty) { return; }
            process.stdout.write("[s");
          };
          const restoreCursor = (): void => {
            if (!useTty) { return; }
            process.stdout.write("[u");
          };
          const renderBlock = (nextOverallLine?: string): void => {
            if (!useTty) { return; }
            if (nextOverallLine !== undefined) { overallLine = nextOverallLine; }
            restoreCursor();
            const moveUp = Math.max(0, blockLines - 1);
            if (moveUp > 0) { process.stdout.write(`[${moveUp}A`); }
            historyLines.forEach((content) => { process.stdout.write(`\r[2K${content}\n`); });
            workerLines.forEach((content) => { process.stdout.write(`\r[2K${content}\n`); });
            process.stdout.write(`\r[2K${overallLine}\n`);
            blockLines = historyLines.length + workerLines.size + 1;
            saveCursor();
          };
          const writeLine = (line: string): void => { console.log(line); };
          const appendHistoryLine = (line: string): void => {
            if (!useTty) {
              const last = lastPrinted.get(-1);
              if (last?.line === line) { return; }
              lastPrinted.set(-1, { line });
              console.log(line);
              return;
            }
            historyLines.push(line);
            renderBlock();
          };
          const renderProgressBar = (current: number, total: number): string => {
            const width = 20;
            const ratio = total === 0 ? 1 : current / total;
            const filled = Math.round(ratio * width);
            const empty = Math.max(0, width - filled);
            return `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
          };
          const buildWorkerPlaceholder = (workerId: number): string => {
            const workerLabel = colorize(t("cli.sync.workerLabel", { index: workerId.toString().padStart(2, "0") }), "white");
            return `${workerLabel} ${t("cli.sync.workerWaiting")}`;
          };
          const formatTransferDetail = (options: {
            progress?: {
              objectsReceived?: number;
              objectsTotal?: number;
              transferred?: string;
              speed?: string;
            };
            status: "cloned" | "pulled" | "pushed" | "skipped" | "failed";
            message?: string;
          }): string => {
            if (options.status === "failed") {
              return options.message ? ` (${options.message})` : ` (${t("cli.errors.unknown")})`;
            }
            const parts: string[] = [];
            const received = options.progress?.objectsReceived;
            const total = options.progress?.objectsTotal;
            if (total || received) {
              if (total) {
                parts.push(t("cli.progress.objectsCopied", { received: received ?? 0, total }));
              } else {
                parts.push(t("cli.progress.objectsCopiedSingle", { received: received ?? 0 }));
              }
            }
            if (options.progress?.transferred) { parts.push(options.progress.transferred); }
            if (options.progress?.speed) { parts.push(t("cli.progress.speed", { speed: options.progress.speed })); }
            if (parts.length === 0) { return ""; }
            return ` ${parts.join(", ")}`;
          };
          const parseMiB = (value?: string, isSpeed = false): string => {
            if (!value) { return "--"; }
            const trimmed = value.trim();
            const cleaned = isSpeed ? trimmed.replace("/s", "") : trimmed;
            const match = cleaned.match(/^([\d.,]+)\s*(KiB|MiB|GiB)$/i);
            if (!match) { return "--"; }
            const raw = Number(match[1].replace(",", "."));
            if (Number.isNaN(raw)) { return "--"; }
            const unit = match[2].toLowerCase();
            const inMiB = unit === "kib" ? raw / 1024 : unit === "gib" ? raw * 1024 : raw;
            const label = inMiB.toFixed(2);
            return isSpeed ? `${label} MiB/s` : `${label} MiB`;
          };
          const formatObjects = (progress?: { objectsReceived?: number; objectsTotal?: number }): string => {
            if (!progress) { return "--"; }
            if (progress.objectsTotal) { return `${progress.objectsReceived ?? 0}/${progress.objectsTotal}`; }
            if (progress.objectsReceived) { return String(progress.objectsReceived); }
            return "--";
          };
          const formatRepoLabel = (value: string, width: number): string => {
            if (value.length <= width) { return value.padEnd(width, " "); }
            return `${value.slice(0, Math.max(0, width - 1))}…`;
          };
          await core.syncSelected({
            config: mergedOptions,
            logger: logBroker,
            tree,
            handlers: {
              onBegin: (count) => {
                totalCount = count;
                syncStartAt = Date.now();
                const tituloSync = colorize(t("cli.sync.title"), "yellow");
                const totalLabel = colorize(String(totalCount), "cyan");
                const dryRunBadge = mergedOptions.dryRun ? ` ${colorize("DRY-RUN", "magenta")}` : "";
                const concurrency = resolveParallels(mergedOptions.parallels);
                const concurrencyLabel =
                  concurrency === "auto" ? colorize(t("cli.sync.concurrencyAuto"), "cyan") : colorize(String(concurrency), "cyan");
                console.log(t("cli.sync.start", { title: tituloSync, total: totalLabel, concurrency: concurrencyLabel, dryRun: dryRunBadge }));
                if (useTty) {
                  const progressLineCount =
                    concurrency === "auto" ? Math.min(totalCount, resolveConcurrency()) : Number(concurrency ?? 1);
                  for (let index = 1; index <= progressLineCount; index += 1) {
                    const placeholder = colorize(t("cli.sync.workerLabel", { index: index.toString().padStart(2, "0") }), "white");
                    const line = `${placeholder} ${t("cli.sync.workerWaiting")}`;
                    workerLines.set(index, line);
                    workerStates.set(index, { line });
                  }
                  workerLines.forEach((line) => console.log(line));
                  overallLine = "";
                  console.log(overallLine);
                  blockLines = workerLines.size + 1;
                  saveCursor();
                }
              },
              onResult: (result) => {
                allResults.push(result);
                completedCount += 1;
                const branchLabel = result.target.branch ? `#${result.target.branch}` : "";
                const actionLabelRaw =
                  result.status === "skipped" ? t("cli.summary.statusNoAction") : result.status.toUpperCase();
                const actionColor =
                  result.status === "cloned"
                    ? "green"
                    : result.status === "pulled"
                    ? "cyan"
                    : result.status === "pushed"
                    ? "blue"
                    : result.status === "failed"
                    ? "red"
                    : "yellow";
                const actionLabel = colorize(actionLabelRaw, actionColor);
                const prefix = mergedOptions.dryRun ? `${colorize("DRY-RUN", "magenta")} ` : "";
                const bar = renderProgressBar(completedCount, totalCount);
                const counter = colorize(`${completedCount}/${totalCount}`, "white");
                const targetKey = `${result.target.pathWithNamespace}${branchLabel}`;
                const progressSnapshot = targetProgress.get(targetKey);
                if (progressSnapshot?.objectsTotal && (progressSnapshot.objectsReceived ?? 0) < progressSnapshot.objectsTotal) {
                  progressSnapshot.objectsReceived = progressSnapshot.objectsTotal;
                  targetProgress.set(targetKey, progressSnapshot);
                }
                const detail = formatTransferDetail({
                  progress: targetProgress.get(targetKey),
                  status: result.status as "cloned" | "pulled" | "pushed" | "skipped" | "failed",
                  message: result.message,
                });
                const workerId = targetWorkerMap.get(targetKey);
                if (workerId) {
                  if (useTty) {
                    const workerLabel = colorize(
                      t("cli.sync.workerLabel", { index: workerId.toString().padStart(2, "0") }),
                      "white"
                    );
                    const doneLabel = colorize(t("cli.sync.progressComplete"), "cyan");
                    const doneLine = `${workerLabel} [${"#".repeat(progressWidth)}] ${doneLabel} -- -- ${actionLabel} ${result.target.pathWithNamespace}${detail}`;
                    if (!completedTargets.has(targetKey)) {
                      completedTargets.add(targetKey);
                      appendHistoryLine(doneLine);
                    }
                    const placeholder = buildWorkerPlaceholder(workerId);
                    workerLines.set(workerId, placeholder);
                    workerStates.set(workerId, { line: placeholder });
                  }
                }
                if (useTty) {
                  renderBlock(
                    `${bar} ${counter} ${prefix}${result.target.pathWithNamespace}${branchLabel} ${actionLabel}${detail}`
                  );
                } else {
                  console.log(`${bar} ${counter} ${prefix}${result.target.pathWithNamespace}${branchLabel} ${actionLabel}${detail}`);
                }
              },
              onProgress: (event) => {
                if (!workerLines.has(event.workerId)) {
                  if (!useTty) {
                    const placeholder = colorize(
                      t("cli.sync.workerLabel", { index: event.workerId.toString().padStart(2, "0") }),
                      "white"
                    );
                    workerLines.set(event.workerId, `${placeholder} ${t("cli.sync.workerWaiting")}`);
                    workerStates.set(event.workerId, { line: `${placeholder} ${t("cli.sync.workerWaiting")}` });
                  } else {
                    return;
                  }
                }
                const workerLabel = colorize(
                  t("cli.sync.workerLabel", { index: event.workerId.toString().padStart(2, "0") }),
                  "white"
                );
                const branchLabel = event.target.branch ? `#${event.target.branch}` : "";
                const targetKey = `${event.target.pathWithNamespace}${branchLabel}`;
                targetWorkerMap.set(targetKey, event.workerId);
                const previousProgress = targetProgress.get(targetKey);
                const nextObjectsReceived = Math.max(
                  previousProgress?.objectsReceived ?? 0,
                  event.objectsReceived ?? 0
                );
                const nextObjectsTotal = Math.max(
                  previousProgress?.objectsTotal ?? 0,
                  event.objectsTotal ?? 0
                );
                targetProgress.set(targetKey, {
                  objectsReceived: nextObjectsReceived || undefined,
                  objectsTotal: nextObjectsTotal || undefined,
                  transferred: event.transferred ?? previousProgress?.transferred,
                  speed: event.speed ?? previousProgress?.speed,
                });
                if (!useTty) {
                  const now = Date.now();
                  if (!startedTargets.has(targetKey)) {
                    startedTargets.add(targetKey);
                    const startPhase = event.phase === "check" ? t("cli.sync.phaseCheck") : event.phase.toUpperCase();
                    const startLine = `${colorize(t("cli.sync.phaseStart"), "yellow")} ${startPhase} ${event.target.pathWithNamespace}${branchLabel}`;
                    console.log(startLine);
                    targetLastUpdateAt.set(targetKey, now);
                    targetLastLine.set(targetKey, startLine);
                  }
                  if (event.percent !== undefined && event.percent >= 100) {
                    return;
                  }
                  const lastAt = targetLastUpdateAt.get(targetKey) ?? 0;
                  if (now - lastAt < 2000) {
                    return;
                  }
                  const line = renderWorkerLine(event, progressWidth);
                  if (targetLastLine.get(targetKey) === line) {
                    return;
                  }
                  targetLastLine.set(targetKey, line);
                  targetLastUpdateAt.set(targetKey, now);
                  console.log(line);
                  return;
                }
                const line = `${workerLabel} ${renderWorkerLine(event, progressWidth)}`;
                const currentState = workerStates.get(event.workerId);
                if (currentState?.line === line) {
                  return;
                }
                if (completedTargets.has(targetKey)) {
                  return;
                }
                if (event.percent === 100) {
                  return;
                }
                const percent = event.percent ?? currentState?.percent ?? 0;
                const objectsReceived = event.objectsReceived ?? currentState?.objectsReceived ?? 0;
                if (currentState?.targetPath === event.target.pathWithNamespace) {
                  const samePercent = percent === currentState.percent;
                  const sameObjects = objectsReceived === currentState.objectsReceived;
                  if (samePercent && sameObjects) {
                    return;
                  }
                }
                workerStates.set(event.workerId, {
                  line,
                  targetPath: event.target.pathWithNamespace,
                  percent,
                  objectsReceived,
                });
                workerLines.set(event.workerId, line);
                renderBlock();
              },
            },
          });
          if (useTty) {
            workerLines.forEach((line, workerId) => {
              const placeholder = buildWorkerPlaceholder(workerId);
              if (line === placeholder) {
                return;
              }
              workerLines.set(workerId, placeholder);
            });
            overallLine = "";
            renderBlock("");
          }
          const syncDurationMs = Date.now() - syncStartAt;
          const counts = allResults.reduce(
            (acc, result) => {
              acc.total += 1;
              if (result.status === "cloned") {
                acc.cloned += 1;
              } else if (result.status === "pulled") {
                acc.pulled += 1;
              } else if (result.status === "pushed") {
                acc.pushed += 1;
              } else if (result.status === "skipped") {
                acc.skipped += 1;
              } else if (result.status === "failed") {
                acc.failed += 1;
              }
              return acc;
            },
            { total: 0, cloned: 0, pulled: 0, pushed: 0, skipped: 0, failed: 0 }
          );
          const tempoSync = colorize(`${(syncDurationMs / 1000).toFixed(2)}s`, "cyan");
          writeLine(`${colorize(t("cli.sync.durationLabel"), "yellow")} ${tempoSync}`);
          const resumoTitulo = colorize(t("cli.sync.summaryTitle"), "yellow");
          writeLine(`${resumoTitulo}`);
          writeLine(
            `  ${colorize(t("cli.sync.summary.total"), "white")} ${colorize(String(counts.total), "cyan")}  ` +
              `${colorize(t("cli.sync.summary.cloned"), "green")} ${colorize(String(counts.cloned), "green")}  ` +
              `${colorize(t("cli.sync.summary.pulled"), "cyan")} ${colorize(String(counts.pulled), "cyan")}  ` +
              `${colorize(t("cli.sync.summary.pushed"), "blue")} ${colorize(String(counts.pushed), "blue")}  ` +
              `${colorize(t("cli.sync.summary.skipped"), "yellow")} ${colorize(String(counts.skipped), "yellow")}  ` +
              `${colorize(t("cli.sync.summary.failed"), "red")} ${colorize(String(counts.failed), "red")}`
          );
          writeLine("");
          const orderedResults = [...allResults].sort((a, b) =>
            `${a.target.pathWithNamespace}#${a.target.branch ?? ""}`.localeCompare(
              `${b.target.pathWithNamespace}#${b.target.branch ?? ""}`,
              "pt-BR",
              { sensitivity: "base" }
            )
          );
          writeLine(`${colorize(t("cli.sync.summaryOrderedTitle"), "yellow")}`);
          const repoWidth = Math.min(
            64,
            Math.max(12, ...orderedResults.map((result) => result.target.pathWithNamespace.length))
          );
          writeLine(
            `  ${colorize("#", "white")}  ` +
              `${colorize(t("cli.sync.table.repository").padEnd(repoWidth, " "), "white")}  ` +
              `${colorize(t("cli.sync.table.status").padEnd(8, " "), "white")}  ` +
              `${colorize(t("cli.sync.table.objects").padEnd(14, " "), "white")}  ` +
              `${colorize(t("cli.sync.table.volume").padEnd(13, " "), "white")}  ` +
              `${colorize(t("cli.sync.table.speed"), "white")}`
          );
          orderedResults.forEach((result, index) => {
            const branchLabel = result.target.branch ? `#${result.target.branch}` : "";
            const actionLabelRaw =
              result.status === "skipped" ? t("cli.summary.statusNoAction") : result.status.toUpperCase();
            const progress = targetProgress.get(`${result.target.pathWithNamespace}${branchLabel}`);
            const objectsLabel = formatObjects(progress).padEnd(14, " ");
            const volumeLabel = parseMiB(progress?.transferred).padEnd(13, " ");
            const speedLabel = parseMiB(progress?.speed, true);
            const prefix = mergedOptions.dryRun ? `${colorize("DRY-RUN", "magenta")} ` : "";
            const repoLabel = formatRepoLabel(`${result.target.pathWithNamespace}${branchLabel}`, repoWidth);
            const rowNumber = String(index + 1).padStart(2, " ");
            writeLine(
              `${prefix}${rowNumber}  ${repoLabel}  ${actionLabelRaw.padEnd(8, " ")}  ${objectsLabel}  ${volumeLabel}  ${speedLabel}`
            );
            if (result.status === "failed") {
              const errorMessage = result.message ?? t("cli.errors.unknown");
              writeLine(`   ${colorize(t("cli.errors.inline"), "red")} ${errorMessage}`);
            }
          });
          if (process.stdout.isTTY) {
            process.stdout.write("\r[2K");
          }
          if (process.stderr.isTTY) {
            process.stderr.write("\r[2K");
          }
        }
        return;
      }

      const defaultBaseDir = mergedOptions.baseDir ?? "repos";
      const resolvedPaths = resolveLocalPathConflicts(filteredProjects);
      const knownPaths = new Set(
        filteredProjects.map((project) =>
          path.join(defaultBaseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project))
        )
      );
      const localScan = mergedOptions.noSummary
        ? { localPaths: [], statusMap: {} as Record<string, RepoSyncStatus> }
        : await buildLocalStatusMap(defaultBaseDir, knownPaths);
      const summary = createSummary();
      summary.total = filteredProjects.length;
      summary.publicCount = filteredProjects.filter((p) => p.visibility === "public").length;
      summary.archivedCount = filteredProjects.filter((p) => p.archived).length;
      Object.values(statusMap).forEach((status) => {
        summary.byStatus[status.state] += 1;
      });
      if (!mergedOptions.noSummary) {
        Object.values(localScan.statusMap).forEach((status) => {
          summary.byStatus[status.state] += 1;
        });
        renderSummaryLines(summary).forEach((line) => logInfo(line));
      }
      const projectNodeMap = new Map<number, string>();
      const buildProjectNodeMap = (node: GitLabTreeNode): void => {
        if (node.type === "project" && node.project) {
          projectNodeMap.set(node.project.id, node.id);
          return;
        }
        node.children?.forEach((child) => buildProjectNodeMap(child));
      };
      tree.forEach((node) => buildProjectNodeMap(node));

      let treeProgress: TuiTreeProgress | null = null;
      const treeProgressRef = (): TuiTreeProgress | null => treeProgress;
      const resolveResultLabel = (status: SyncResult["status"]): string => {
        if (status === "cloned") {
          return t("cli.sync.resultStatus.cloned");
        }
        if (status === "pulled") {
          return t("cli.sync.resultStatus.pulled");
        }
        if (status === "pushed") {
          return t("cli.sync.resultStatus.pushed");
        }
        if (status === "failed") {
          return t("cli.sync.resultStatus.failed");
        }
        return t("cli.sync.resultStatus.skipped");
      };
      const buildProgressLabel = (event: ProgressEvent): string => {
        const percent = Math.round(event.percent ?? 0);
        const bar = renderProgressBar(percent, 100);
        const percentLabel = `${percent.toString().padStart(3, " ")}%`;
        const volumeLabel = parseMiB(event.transferred).padStart(9, " ");
        const speedLabel = parseMiB(event.speed, true).padStart(10, " ");
        const objectsLabel = formatObjects({ objectsReceived: event.objectsReceived, objectsTotal: event.objectsTotal }).padStart(9, " ");
        return `${bar} ${percentLabel} ${volumeLabel} ${speedLabel} ${objectsLabel}`;
      };

      await renderRepositoryTree(tree, (id) => toggleById(tree, id), session, {
        header,
        footer: t("tui.tree.orientationConfirm"),
        parameters: session?.getParameters() ?? parametersSummary,
        onReady: (handlers) => {
          treeProgress = handlers.progress;
          handlers.render();
        },
        onConfirm: async (selection: TuiSelectionResult) => {
          if (!session) {
            logBroker.warn(t("session.errorPrefix", { error: t("cli.log.tuiUnavailable") }));
            return;
          }

          const selectionMode = selection.mode ?? "all";
          let selectionNodes: GitLabTreeNode[] = [];
          if (selectionMode === "single") {
            const targetNode = selection.selectedNodeId ? findNodeById(tree, selection.selectedNodeId) : undefined;
            if (!targetNode) {
              logBroker.warn(t("tui.tree.singleInvalid"));
              return;
            }
            selectionNodes = collectProjectNodesFromNode(targetNode);
            if (selectionNodes.length === 0) {
              logBroker.warn(t("tui.tree.singleInvalid"));
              return;
            }
          } else {
            selectionNodes = collectProjectNodesFromNode({
              id: "root",
              label: "root",
              type: "group",
              children: tree,
            });
          }

          const selectedNodes = selectionNodes.filter((node) => node.selected);
          const selected = selectedNodes
            .map((node) => node.project)
            .filter((project): project is GitLabProject => Boolean(project));

          if (selected.length === 0) {
            logBroker.warn(t("tui.tree.empty"));
            return;
          }

          const selectedIds = new Set(selected.map((project) => project.id));
          const removalCandidates = selectionNodes
            .filter((node) => node.type === "project" && node.project)
            .map((node) => node.project)
            .filter((project): project is GitLabProject => Boolean(project))
            .filter((project) => !selectedIds.has(project.id));

          for (const project of removalCandidates) {
            const status = statusMap[project.id];
            if (!status || status.state === "EMPTY") {
              continue;
            }
            const localPath = path.join(defaultBaseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project));
            if (!fs.existsSync(localPath)) {
              continue;
            }
            const confirmed = await confirmRemoval({
              repoLabel: project.path_with_namespace,
              status,
              session,
            });
            if (!confirmed) {
              logBroker.warn(t("cli.sync.removeSkip", { repo: project.path_with_namespace }));
              continue;
            }
            if (mergedOptions.dryRun) {
              logBroker.info(t("cli.sync.removeDryRun", { repo: project.path_with_namespace }));
              continue;
            }
            const nodeId = projectNodeMap.get(project.id);
            const treeProgressInstance = treeProgressRef();
            if (nodeId && treeProgressInstance) {
              treeProgressInstance.updateProgress(nodeId, t("cli.sync.removeProgress"));
            }
            try {
              await fs.promises.rm(localPath, { recursive: true, force: true });
              if (nodeId) {
                const treeProgressInstance = treeProgressRef();
                treeProgressInstance?.clearProgress(nodeId);
                treeProgressInstance?.updateStatus(nodeId, {
                  branch: project.default_branch ?? "main",
                  state: "EMPTY",
                });
              }
              logBroker.info(t("cli.sync.removeDone", { repo: project.path_with_namespace }));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (nodeId) {
                treeProgressRef()?.clearProgress(nodeId);
              }
              logBroker.error(t("cli.sync.removeFail", { repo: project.path_with_namespace, message }));
            }
          }

          const counts = { total: 0, cloned: 0, pulled: 0, pushed: 0, skipped: 0, failed: 0 };
          const startedTargets = new Set<number>();
          await core.syncSelected({
            config: mergedOptions,
            logger: logBroker,
            tree,
            selectedProjects: selectionMode === "single" ? selected : undefined,
            handlers: {
              onBegin: (totalCount) => {
                const concurrency = resolveParallels(mergedOptions.parallels);
                logBroker.info(
                  t("cli.sync.start", {
                    title: t("cli.sync.title"),
                    total: String(totalCount),
                    concurrency: concurrency === "auto" ? t("cli.sync.concurrencyAuto") : String(concurrency),
                    dryRun: mergedOptions.dryRun ? "DRY-RUN" : "",
                  })
                );
              },
              onResult: async (result) => {
                counts.total += 1;
                if (result.status === "cloned") counts.cloned += 1;
                else if (result.status === "pulled") counts.pulled += 1;
                else if (result.status === "pushed") counts.pushed += 1;
                else if (result.status === "skipped") counts.skipped += 1;
                else if (result.status === "failed") counts.failed += 1;
                logBroker.info(
                  t("cli.sync.repoDone", {
                    repo: result.target.pathWithNamespace,
                    status: resolveResultLabel(result.status as SyncResult["status"]),
                  })
                );
                const nodeId = projectNodeMap.get(result.target.id);
                if (nodeId) {
                  treeProgressRef()?.clearProgress(nodeId);
                }
                const status = await resolveRepoStatus({
                  targetPath: result.target.localPath,
                  defaultBranch: result.target.defaultBranch,
                  knownRemote: true,
                }).catch(() => undefined);
                if (status && nodeId) {
                  treeProgressRef()?.updateStatus(nodeId, status);
                }
              },
              onProgress: (event) => {
                if (!startedTargets.has(event.target.id)) {
                  startedTargets.add(event.target.id);
                  const phaseLabel = event.phase === "check" ? t("cli.sync.phaseCheck") : event.phase.toUpperCase();
                  logBroker.info(
                    t("cli.sync.repoStart", {
                      repo: event.target.pathWithNamespace,
                      phase: phaseLabel,
                    })
                  );
                }
                const nodeId = projectNodeMap.get(event.target.id);
                if (!nodeId) {
                  return;
                }
                treeProgressRef()?.updateProgress(nodeId, buildProgressLabel(event));
              },
            },
          });
          logBroker.info(t("cli.sync.summaryTitle"));
          logBroker.info(
            `${t("cli.sync.summary.total")} ${counts.total}  ` +
              `${t("cli.sync.summary.cloned")} ${counts.cloned}  ` +
              `${t("cli.sync.summary.pulled")} ${counts.pulled}  ` +
              `${t("cli.sync.summary.pushed")} ${counts.pushed}  ` +
              `${t("cli.sync.summary.skipped")} ${counts.skipped}  ` +
              `${t("cli.sync.summary.failed")} ${counts.failed}`
          );
        },
      });

      return;
    });
};

export const configureSshKeyStoreCommand = (program: Command, session?: TuiSession): void => {
  program
    .command("git-server-store")
    .description(t("cli.command.gitServerStore.description"))
    .option("-v, --verbose", t("cli.command.gitServerStore.options.verbose"), false)
    .option("--server-name <name>", t("cli.command.gitServerStore.options.serverName"))
    .option("--base-url <url>", t("cli.command.gitServerStore.options.baseUrl"))
    .option("--username <username>", t("cli.command.gitServerStore.options.username"))
    .option("--key-label <label>", t("cli.command.gitServerStore.options.keyLabel"), "paje")
    .option("--passphrase <passphrase>", t("cli.command.gitServerStore.options.passphrase"))
    .option("--public-key-path <path>", t("cli.command.gitServerStore.options.publicKeyPath"))
    .option("--key-overwrite", t("cli.command.gitServerStore.options.keyOverwrite"), false)
    .option("--retry-delay-ms <ms>", t("cli.command.gitServerStore.options.retryDelayMs"), (value) => Number(value))
    .option("--max-attempts <count>", t("cli.command.gitServerStore.options.maxAttempts"), (value) => Number(value))
    .option("--env-file <path>", t("cli.command.gitServerStore.options.envFile"))
    .option("--token-name <name>", t("cli.command.gitServerStore.options.tokenName"))
    .option("--token-scopes <scopes>", t("cli.command.gitServerStore.options.tokenScopes"))
    .option("--token-expires-at <date>", t("cli.command.gitServerStore.options.tokenExpiresAt"))
    .option("--use-basic-auth", t("cli.command.gitServerStore.options.useBasicAuth"), false)
    .option("--user-email <email>", t("cli.command.gitServerStore.options.userEmail"))
    .option("--password <password>", t("cli.command.gitServerStore.options.password"))
    .option("--base-dir <dir>", t("cli.command.gitServerStore.options.baseDir"))
    .option("--no-public-repos [value]", t("cli.command.gitServerStore.options.noPublicRepos"), false)
    .option("--no-archived-repos [value]", t("cli.command.gitServerStore.options.noArchivedRepos"), false)
    .option("-f, --filter <pattern>", t("cli.command.gitServerStore.options.filter"))
    .option("--sync-repos <pattern>", t("cli.command.gitServerStore.options.syncRepos"))
    .option("--locale <locale>", t("cli.command.gitServerStore.options.locale"))
    .action(async (options: SshKeyStoreCliOptions) => {
      setLocale(options.locale);
      const hasCliArg = (flag: string): boolean => {
        const dashed = `--${flag}`;
        return process.argv.some((arg) => arg === dashed || arg.startsWith(`${dashed}=`));
      };
      const sshKeyParameters = buildSshKeyStoreParameters(options, hasCliArg);
      if (session) {
        session.setParameters([sshKeyParameters]);
      }

      const baseUrl = String(sshKeyParameters.parameters.find((param) => param.name === "baseUrl")?.value ?? "");
      const serverName = String(sshKeyParameters.parameters.find((param) => param.name === "serverName")?.value ?? "");
      const username = String(sshKeyParameters.parameters.find((param) => param.name === "username")?.value ?? "");
      const server: GitServerEntry = {
        id: baseUrl,
        name: serverName,
        baseUrl,
        useBasicAuth: options.useBasicAuth ?? true,
        username,
        userEmail: options.userEmail,
        baseDir: options.baseDir,
        noPublicRepos: options.noPublicRepos,
        noArchivedRepos: options.noArchivedRepos,
        filter: options.filter,
        syncRepos: options.syncRepos,
        tokenName: options.tokenName,
        tokenScopes: options.tokenScopes,
        tokenExpiresAt: options.tokenExpiresAt,
      };

      await storeSshKeyOnly(server, session, options);
    });

  program
    .command("ssh-key-store")
    .description(t("cli.command.sshKeyStore.description"))
    .action(async () => {
      const message = t("cli.command.sshKeyStore.renamed");
      if (session) {
        await session.showMessage({ title: t("cli.prompt.gitlab.title"), message });
        return;
      }
      console.log(message);
    });
};
