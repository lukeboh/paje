import fs from "node:fs";
import path from "node:path";
import { t } from "../../../i18n/index.js";
import { GitLabApi } from "../gitlabApi.js";
import { parallelSync, runGit, type ProgressEvent } from "../parallelSync.js";
import { antPatternToRegex, compileAntPatterns, matchesAntPatterns, splitFilterPatterns } from "../patternFilter.js";
import { resolveLocalPathConflicts, resolveProjectLocalPath } from "../gitPathUtils.js";
import { readGitServers, writeGitServers, readGitTreeCache, writeGitTreeCache } from "../persistence.js";
import { GitHubApi } from "../githubApi.js";
import {
  addHostToKnownHosts,
  getIdentityFileForHost,
  isHostInKnownHosts,
  listSshPublicKeys,
  readPublicKey,
  registerKeyInGitLab,
  resolveSshIdentityPath,
  rotatePersonalAccessToken,
  sanitizePublicKey,
  upsertSshConfigHost,
} from "../sshManager.js";
import {
  buildGitLabTree,
  collectSelectedProjects,
  applyInitialSelectionFromStatusMap,
  recomputeTreeSelection,
  toggleTreeNode,
} from "../treeBuilder.js";
import {
  getAheadBehind,
  getStatusPorcelain,
  hasGitDir,
  readLocalRepoInfo,
} from "../gitRepoScanner.js";
import type {
  GitLabGroup,
  GitLabProject,
  GitLabTreeNode,
  GitRepositoryTarget,
  GitTreeCacheEntry,
  RepoSyncState,
  RepoSyncStatus,
} from "../types.js";
import { LoggerBroker } from "./loggerBroker.js";
import type { GitSyncConfig } from "./gitSyncConfig.js";

// Where a persisted token came from — lets the UI point the user at the
// right place to revoke/regenerate it (a classic PAT vs. an OAuth app
// authorization live in different settings pages on GitLab/GitHub).
// "oauth-device-flow" is produced by the GitHub device-flow quick pick
// (gitCommand.ts's runGitHubDeviceFlowRegistration, via githubDeviceFlow.ts).
export type TokenOrigin = "personal-access-token" | "oauth-device-flow";

export type GitServerEntry = {
  id: string;
  name: string;
  baseUrl: string;
  type?: "gitlab" | "github";
  username?: string;
  userEmail?: string;
  token?: string;
  tokenOrigin?: TokenOrigin;
  baseDir?: string;
  noPublicRepos?: boolean;
  noArchivedRepos?: boolean;
  filter?: string;
  syncRepos?: string;
  tokenName?: string;
  tokenScopes?: string;
  tokenExpiresAt?: string;
};

// Every place that persists a fresh/rotated token should go through this
// instead of spreading { token } by hand, so tokenOrigin never silently
// stays unset.
export const withToken = (
  server: GitServerEntry,
  token: string,
  origin: TokenOrigin = "personal-access-token"
): GitServerEntry => ({ ...server, token, tokenOrigin: origin });

export type GitSyncTreeView = {
  header: string;
  tree: GitLabTreeNode[];
  statusMap: Record<number, RepoSyncStatus>;
  projects: GitLabProject[];
  fromCache?: boolean;
};

export type GitSyncLoadOptions = {
  config: GitSyncConfig;
  logger: LoggerBroker;
  // Called when a server has no working credential: either there was never
  // a token at all ("missing", and no SSH association either), or there was
  // one but it just failed with 401/403 and rotating it silently didn't fix
  // it ("invalid" — rotation is attempted first, without involving the
  // presentation layer at all, since it needs no user interaction). Either
  // way the presentation layer bootstraps a fresh token (prompting for a
  // password once) and hands it back so this run can keep going without
  // restarting. Returning null means the caller declined or bootstrapping
  // wasn't possible; that server is then skipped with a warning.
  onMissingCredentials?: (
    server: GitServerEntry,
    reason: "missing" | "invalid"
  ) => Promise<{ token: string } | null>;
  onRequestStart?: (serverName: string, requestCount: number) => void;
  onStatusRefreshed?: (projectId: number, status: RepoSyncStatus) => void;
};

export type GitSyncProgressHandlers = {
  onBegin?: (totalCount: number) => void;
  onProgress?: (event: ProgressEvent) => void;
  onResult?: (entry: { status: string; message?: string; target: GitRepositoryTarget }) => void | Promise<void>;
};

export type GitSyncSummary = {
  total: number;
  publicCount: number;
  archivedCount: number;
  failed: number;
  byStatus: Record<RepoSyncState, number>;
};

export type GitSyncCore = {
  listServers: (options: { config: GitSyncConfig; logger: LoggerBroker }) => Promise<GitServerEntry[]>;
  loadTree: (options: GitSyncLoadOptions) => Promise<GitSyncTreeView>;
  toggleTreeSelection: (tree: GitLabTreeNode[], id: string) => GitLabTreeNode[];
  syncSelected: (options: {
    config: GitSyncConfig;
    logger: LoggerBroker;
    tree: GitLabTreeNode[];
    selectedProjects?: GitLabProject[];
    handlers?: GitSyncProgressHandlers;
  }) => Promise<{ summary: GitSyncSummary }>;
};

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const computeConfigHash = (servers: GitServerEntry[]): string => {
  return servers
    .map((s) =>
      [s.name, normalizeBaseUrl(s.baseUrl), s.filter ?? "", String(s.noPublicRepos ?? false), String(s.noArchivedRepos ?? false)].join("|")
    )
    .sort()
    .join(";");
};

const buildServerPrefix = (server: GitServerEntry): string => server.name;

const mergeServerList = (servers: GitServerEntry[]): GitServerEntry[] => {
  return servers.map((server) => ({
    ...server,
    name: server.name.trim(),
    baseUrl: normalizeBaseUrl(server.baseUrl),
    id: normalizeBaseUrl(server.id || server.baseUrl),
  }));
};

const buildServersHeader = (servers: GitServerEntry[]): string => {
  if (servers.length === 0) {
    return "GitLab";
  }
  if (servers.length === 1) {
    return buildServerPrefix(servers[0]);
  }
  return t("cli.sync.serverCount", { count: servers.length });
};

export const mergeServer = (
  servers: GitServerEntry[],
  server: GitServerEntry
): { servers: GitServerEntry[]; updated: boolean } => {
  const normalizedBaseUrl = normalizeBaseUrl(server.baseUrl);
  const index = servers.findIndex((current) => normalizeBaseUrl(current.baseUrl) === normalizedBaseUrl);
  const sanitized = {
    ...server,
    id: normalizedBaseUrl,
    baseUrl: normalizedBaseUrl,
  };
  if (index === -1) {
    return { servers: [...servers, sanitized], updated: true };
  }
  const nextServers = [...servers];
  nextServers[index] = { ...nextServers[index], ...sanitized };
  return { servers: nextServers, updated: true };
};

const mergeGroupsByPath = (
  entries: Array<{ server: GitServerEntry; groups: GitLabGroup[] }>
): { groups: GitLabGroup[]; idMapByServer: Map<string, Map<number, number>> } => {
  const groups: GitLabGroup[] = [];
  const idMapByServer = new Map<string, Map<number, number>>();
  let nextId = 1;

  entries.forEach(({ server, groups: serverGroups }) => {
    const serverIdMap = new Map<number, number>();
    serverGroups.forEach((group) => {
      const existing = groups.find((item) => item.full_path === group.full_path);
      if (existing) {
        serverIdMap.set(group.id, existing.id);
        return;
      }
      serverIdMap.set(group.id, nextId);
      nextId += 1;
    });
    idMapByServer.set(server.id, serverIdMap);

    serverGroups.forEach((group) => {
      if (groups.some((item) => item.full_path === group.full_path)) {
        return;
      }
      const mappedId = serverIdMap.get(group.id) ?? nextId;
      const mappedParent = group.parent_id ? serverIdMap.get(group.parent_id) ?? null : null;
      groups.push({
        ...group,
        id: mappedId,
        parent_id: mappedParent,
      });
    });
  });

  return { groups, idMapByServer };
};

const mergeProjectsByPath = (
  entries: Array<{ server: GitServerEntry; projects: GitLabProject[] }>,
  idMapByServer: Map<string, Map<number, number>>
): { projects: GitLabProject[] } => {
  const projects: GitLabProject[] = [];
  const seen = new Set<string>();
  entries.forEach(({ server, projects: serverProjects }) => {
    const idMap = idMapByServer.get(server.id);
    serverProjects.forEach((project) => {
      const normalizedPath = `${server.name}/${project.path_with_namespace}`;
      if (seen.has(normalizedPath)) {
        return;
      }
      seen.add(normalizedPath);
      const namespaceId = project.namespace?.id;
      const normalized: GitLabProject = {
        ...project,
        namespace: project.namespace
          ? {
              ...project.namespace,
              id: namespaceId ? idMap?.get(namespaceId) ?? namespaceId : project.namespace.id,
              full_path: project.namespace.full_path,
            }
          : undefined,
        pajeOriginalPathWithNamespace: project.path_with_namespace,
        pajeServerName: server.name,
      };
      projects.push(normalized);
    });
  });
  return { projects };
};

export const resolveSyncReposSpecs = (rawPatterns?: string): Array<{ projectPath: string; branch?: string }> => {
  const specs: Array<{ projectPath: string; branch?: string }> = [];
  splitFilterPatterns(rawPatterns).forEach((rawPattern: string) => {
    const trimmed = rawPattern.trim();
    if (!trimmed.includes("#")) {
      specs.push({ projectPath: trimmed.replace(/\.git$/, "") });
      return;
    }
    const hashIndex = trimmed.indexOf("#");
    const projectPath = trimmed.slice(0, hashIndex).replace(/\.git$/, "");
    const branch = trimmed.slice(hashIndex + 1).trim() || undefined;
    specs.push({ projectPath, branch });
  });
  return specs;
};

export const resolveSyncTargets = (
  projects: GitLabProject[],
  specs: Array<{ projectPath: string; branch?: string }>
): GitRepositoryTarget[] => {
  if (specs.length === 0) {
    return [];
  }
  const normalizedProjects = projects.map((project) => ({
    project,
    matchPaths: [
      project.path_with_namespace,
      project.pajeOriginalPathWithNamespace,
    ].filter(Boolean) as string[],
  }));
  const matches: GitRepositoryTarget[] = [];
  specs.forEach((spec) => {
    const pattern = antPatternToRegex(spec.projectPath);
    normalizedProjects.forEach(({ project, matchPaths }) => {
      if (!matchPaths.some((mp) => pattern.test(mp))) {
        return;
      }
      matches.push({
        id: project.id,
        name: project.name,
        pathWithNamespace: resolveProjectLocalPath(project),
        sshUrl: project.ssh_url_to_repo,
        httpUrl: project.pajeHttpUrl,
        localPath: "",
        defaultBranch: project.default_branch,
        branch: spec.branch,
      });
    });
  });
  const uniqueByPath = new Map<string, GitRepositoryTarget>();
  matches.forEach((target) => {
    const key = `${target.pathWithNamespace}#${target.branch ?? ""}`;
    if (!uniqueByPath.has(key)) {
      uniqueByPath.set(key, target);
    }
  });
  return Array.from(uniqueByPath.values());
};

export const resolveRepoStatus = async (options: {
  targetPath: string;
  defaultBranch?: string | null;
  knownRemote?: boolean;
}): Promise<RepoSyncStatus> => {
  const branchFallback = options.defaultBranch ?? "main";
  const hasRepo = await hasGitDir(options.targetPath);
  if (!hasRepo) {
    return {
      branch: branchFallback,
      state: options.knownRemote ? "EMPTY" : "LOCAL",
    };
  }

  const repoInfo = await readLocalRepoInfo(options.targetPath);
  const branch = repoInfo.currentBranch ?? branchFallback;
  if (!repoInfo.remoteUrl) {
    return {
      branch,
      state: options.knownRemote ? "REMOTE" : "LOCAL",
    };
  }

  const pendingChanges = await getStatusPorcelain(options.targetPath);
  if (pendingChanges) {
    return { branch, state: "UNCOMMITTED" };
  }

  await runGit(["-C", options.targetPath, "fetch", "--quiet"]).catch(() => undefined);
  const { ahead, behind } = await getAheadBehind(options.targetPath, branch);
  if (ahead === 0 && behind === 0) {
    return { branch, state: "SYNCED" };
  }
  if (behind > 0 && ahead === 0) {
    return { branch, state: "BEHIND", delta: `-${behind}` };
  }
  if (ahead > 0 && behind === 0) {
    return { branch, state: "AHEAD", delta: `+${ahead}` };
  }
  return { branch, state: "DIVERGED", delta: `+${ahead}/-${behind}` };
};


export const ensureLocalDirsIfNeeded = async (
  projects: GitLabProject[],
  baseDir: string,
  prepareLocalDirs: boolean
): Promise<void> => {
  if (!prepareLocalDirs) {
    return;
  }
  const resolvedPaths = resolveLocalPathConflicts(projects);
  await Promise.all(
    projects.map(async (project) => {
      const targetPath = path.join(baseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project));
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    })
  );
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

const collectAllProjectsFromTree = (nodes: GitLabTreeNode[]): GitLabProject[] => {
  const projects: GitLabProject[] = [];
  const visit = (node: GitLabTreeNode): void => {
    if (node.type === "project" && node.project) {
      projects.push(node.project);
    }
    node.children?.forEach((child) => visit(child));
  };
  nodes.forEach((node) => visit(node));
  return projects;
};

const toggleById = (nodes: GitLabTreeNode[], id: string): void => {
  const target = findNodeById(nodes, id);
  if (!target) {
    return;
  }
  const nextSelected = !target.selected;
  toggleTreeNode(target, nextSelected);
  nodes.forEach((node) => recomputeTreeSelection(node));
};

const hasValidSshAssociation = (host: string): boolean => {
  const identityPath = getIdentityFileForHost(host);
  if (!identityPath) {
    return false;
  }
  return fs.existsSync(resolveSshIdentityPath(identityPath));
};

const ensureKnownHost = async (server: string, logger: LoggerBroker, verbose?: boolean): Promise<void> => {
  if (await isHostInKnownHosts(server)) {
    return;
  }
  logger.warn(t("cli.sync.knownHostMissing", { host: server }));
  const added = await addHostToKnownHosts(server, {
    verbose,
    logger: (message) => logger.debug(message),
  });
  if (added) {
    logger.info(t("cli.sync.knownHostAdded", { host: server }));
  } else {
    logger.warn(t("cli.prompt.trust.cannotAddHost", { server }));
  }
};

// Roda uma vez por host SSH distinto entre os servidores resolvidos, antes
// de qualquer operação git — inclusive quando loadTree() usa a árvore
// cacheada (que pula o laço de fetch por servidor mais abaixo, onde este
// mesmo host normalmente também seria verificado via ensureSshKey). Sem
// isso, um known_hosts incompleto nesta máquina (ex.: ~/.paje copiado sem
// ~/.ssh) só seria descoberto quando o clone/fetch em paralelo já estivesse
// em andamento, cada um preso numa pergunta interativa do SSH que nenhum
// deles tem como responder.
const ensureKnownHostsForServers = async (
  servers: GitServerEntry[],
  logger: LoggerBroker,
  verbose: boolean
): Promise<void> => {
  const hosts = new Set<string>();
  for (const server of servers) {
    try {
      const host = new URL(server.baseUrl).hostname;
      if (hasValidSshAssociation(host)) {
        hosts.add(host);
      }
    } catch {
      // URL inválida já é descartada em listServers(); ignora aqui.
    }
  }
  for (const host of hosts) {
    await ensureKnownHost(host, logger, verbose);
  }
};

type SshCapableApi = {
  getServerHost: () => string;
  hasAuth: () => boolean;
  createSshKey: (title: string, key: string) => Promise<{ id: number }>;
};

const ensureSshKey = async (api: SshCapableApi, logger: LoggerBroker, config: GitSyncConfig): Promise<void> => {
  const server = api.getServerHost();
  let associatedIdentityPath = getIdentityFileForHost(server);
  if (associatedIdentityPath) {
    const resolved = resolveSshIdentityPath(associatedIdentityPath);
    if (!fs.existsSync(resolved)) {
      logger.warn(t("cli.prompt.sshKey.missingKey", { server, path: associatedIdentityPath ?? "" }));
      associatedIdentityPath = null;
    }
  }

  if (associatedIdentityPath) {
    await ensureKnownHost(server, logger, config.verbose ?? false);
    return;
  }

  if (config.publicKeyPath) {
    const selectedKey = config.publicKeyPath;
    if (!fs.existsSync(selectedKey)) {
      logger.warn(t("cli.prompt.sshKey.missingProvidedKey", { path: selectedKey }));
      return;
    }
    const key = sanitizePublicKey(readPublicKey(selectedKey));
    upsertSshConfigHost(server, selectedKey.replace(/\.pub$/, ""));
    await ensureKnownHost(server, logger, config.verbose ?? false);
    if (api.hasAuth()) {
      try {
        await registerKeyInGitLab(api, `paje-existing-${Date.now()}`, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("cli.errors.unknown");
        logger.warn(t("cli.errors.gitlab.registerKeyFail", { message }));
      }
    }
    return;
  }

  const existingKeys = listSshPublicKeys();
  if (existingKeys.length === 0) {
    logger.warn(t("cli.prompt.sshKey.noKeyInSsh"));
  }
};

const buildSummary = (): GitSyncSummary => ({
  total: 0,
  publicCount: 0,
  archivedCount: 0,
  failed: 0,
  byStatus: {
    SYNCED: 0,
    BEHIND: 0,
    AHEAD: 0,
    REMOTE: 0,
    EMPTY: 0,
    LOCAL: 0,
    UNCOMMITTED: 0,
    DIVERGED: 0,
  },
});

export const filterProjects = (projects: GitLabProject[], config: GitSyncConfig): GitLabProject[] => {
  const filterPatterns = compileAntPatterns(config.filter);
  const excludePatterns = compileAntPatterns(config.excludeFilter);
  return projects.filter((project) => {
    if (config.noArchivedRepos && project.archived) {
      return false;
    }
    if (config.noPublicRepos && project.visibility === "public") {
      return false;
    }
    const candidates = [
      project.path_with_namespace,
      project.pajeOriginalPathWithNamespace,
      project.namespace?.full_path,
      project.namespace?.full_path ? `${project.namespace.full_path}/${project.name}` : undefined,
    ].filter(Boolean) as string[];
    // matchesAntPatterns treats an empty pattern list as "matches
    // everything" (right for the include filter below, where no filter
    // means show all) — for excludeFilter that would invert the meaning
    // and hide every project, so the length check here is required, not
    // just an optimization.
    if (excludePatterns.length > 0 && candidates.some((candidate) => matchesAntPatterns(candidate, excludePatterns))) {
      return false;
    }
    if (filterPatterns.length === 0) {
      return true;
    }
    return candidates.some((candidate) => matchesAntPatterns(candidate, filterPatterns));
  });
};

// Excludes groups whose full_path matches excludeFilter — filterProjects
// alone only drops projects, so a fully-excluded folder would otherwise
// still show up in the tree as an empty group. A pattern like "grupo/**"
// matches the group's own full_path (zero-width case) and every descendant
// at any depth, so excluding a folder here cascades to child groups for
// free; only patterns ending in "/**" cascade this way, which is exactly
// what the TUI's exclude action always generates (see treeBuilder.ts).
export const filterGroups = (groups: GitLabGroup[], config: GitSyncConfig): GitLabGroup[] => {
  const excludePatterns = compileAntPatterns(config.excludeFilter);
  if (excludePatterns.length === 0) {
    return groups;
  }
  return groups.filter((group) => !matchesAntPatterns(group.full_path, excludePatterns));
};

export const prepareTargets = (
  projects: GitLabProject[],
  baseDir: string,
  username?: string,
  userEmail?: string
): GitRepositoryTarget[] => {
  const resolvedPaths = resolveLocalPathConflicts(projects);
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    pathWithNamespace: resolveProjectLocalPath(project),
    sshUrl: project.ssh_url_to_repo,
    httpUrl: project.pajeHttpUrl,
    localPath: path.join(project.pajeBaseDir ?? baseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project)),
    defaultBranch: project.default_branch,
    gitUserName: username,
    gitUserEmail: project.pajeUserEmail ?? userEmail,
  }));
};

export const resolveParallels = (rawValue?: string): number | "auto" => {
  if (!rawValue) {
    return "auto";
  }
  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed || trimmed === "auto") {
    return "auto";
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return "auto";
  }
  return parsed;
};

export const createGitSyncCore = (): GitSyncCore => {
  return {
    listServers: async ({ config, logger }) => {
      const storedServers = readGitServers<GitServerEntry[]>([]);
      let servers = mergeServerList(storedServers);

      if (config.serverName && config.baseUrl) {
        const server: GitServerEntry = {
          id: config.baseUrl,
          name: config.serverName,
          baseUrl: config.baseUrl,
          username: config.username,
        };
        const merge = mergeServer(servers, server);
        writeGitServers(merge.servers);
        servers = mergeServerList(merge.servers);
      }

      servers = servers.filter((server) => {
        if (isValidHttpUrl(server.baseUrl)) {
          return true;
        }
        logger.warn(t("cli.sync.invalidBaseUrl", { server: server.name || server.id || server.baseUrl }));
        return false;
      });

      if (servers.length === 0) {
        logger.warn(t("cli.prompt.gitlab.noServerConfigured"));
        return [];
      }

      if (config.serverName && !config.baseUrl) {
        const normalizedName = config.serverName.trim().toLowerCase();
        servers = servers.filter((server) => server.name.trim().toLowerCase() === normalizedName);
      }

      if (config.baseUrl) {
        const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
        servers = servers.filter((server) => normalizeBaseUrl(server.baseUrl) === normalizedBaseUrl);
      }

      return servers;
    },
    loadTree: async ({ config, logger, onMissingCredentials, onRequestStart, onStatusRefreshed }) => {
      const servers = await createGitSyncCore().listServers({ config, logger });
      if (servers.length === 0) {
        return { header: "GitLab", tree: [], statusMap: {}, projects: [] };
      }

      await ensureKnownHostsForServers(servers, logger, config.verbose ?? false);

      const configHash = computeConfigHash(servers);
      const cached = readGitTreeCache();

      if (cached?.version === 1 && cached.configHash === configHash) {
        logger.info(t("cli.cache.hit"));

        const serversByName = new Map(servers.map((s) => [s.name, s]));
        const cachedServerResults = cached.servers
          .map(({ serverName, groups, projects }) => {
            const server = serversByName.get(serverName);
            if (!server) return null;
            const projectsWithHttpUrl = server.token
              ? projects.map((project) => {
                  try {
                    const url = new URL(project.http_url_to_repo);
                    url.username = "oauth2";
                    url.password = server.token as string;
                    return { ...project, pajeHttpUrl: url.toString() };
                  } catch {
                    return project;
                  }
                })
              : projects;
            return { server, groups, projects: projectsWithHttpUrl };
          })
          .filter((r): r is { server: GitServerEntry; groups: GitLabGroup[]; projects: GitLabProject[] } => r !== null);

        if (cachedServerResults.length > 0) {
          const { groups, idMapByServer } = mergeGroupsByPath(
            cachedServerResults.map((r) => ({ server: r.server, groups: r.groups }))
          );
          const { projects } = mergeProjectsByPath(
            cachedServerResults.map((r) => ({ server: r.server, projects: r.projects })),
            idMapByServer
          );
          const header = buildServersHeader(cachedServerResults.map((r) => r.server));

          const filteredProjects = filterProjects(projects, config);
          await ensureLocalDirsIfNeeded(filteredProjects, config.baseDir, config.prepareLocalDirs ?? false);
          const resolvedPaths = resolveLocalPathConflicts(filteredProjects);

          const statusMap = cached.statusMap;
          const tree = buildGitLabTree(filterGroups(groups, config), filteredProjects);
          const applyStatusToTree = (node: GitLabTreeNode): void => {
            if (node.type === "project" && node.project) {
              node.status = statusMap[node.project.id];
              node.localPath = path.join(
                node.project.pajeBaseDir ?? config.baseDir,
                resolvedPaths.get(node.project.id) ?? resolveProjectLocalPath(node.project)
              );
              return;
            }
            node.children?.forEach((child) => applyStatusToTree(child));
          };
          tree.forEach((node) => applyStatusToTree(node));
          applyInitialSelectionFromStatusMap(tree, statusMap);

          setImmediate(async () => {
            // Bounded worker pool: one git subprocess per repo, so spawning
            // them all at once would saturate the machine and starve the TUI
            // event loop (the interface stops responding to keystrokes).
            const REFRESH_CONCURRENCY = 4;
            const freshStatusMap: Record<number, RepoSyncStatus> = {};
            let nextIndex = 0;
            const worker = async (): Promise<void> => {
              while (nextIndex < filteredProjects.length) {
                const project = filteredProjects[nextIndex];
                nextIndex += 1;
                const targetPath = path.join(
                  project.pajeBaseDir ?? config.baseDir,
                  resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project)
                );
                const status = await resolveRepoStatus({
                  targetPath,
                  defaultBranch: project.default_branch,
                  knownRemote: true,
                });
                freshStatusMap[project.id] = status;
                // Deliver each status as soon as it is known instead of after
                // the full sweep, so the tree updates progressively.
                onStatusRefreshed?.(project.id, status);
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(REFRESH_CONCURRENCY, filteredProjects.length) }, () => worker())
            );
            try {
              writeGitTreeCache({ ...cached, statusMap: freshStatusMap });
              logger.info(t("cli.cache.statusRefreshed"));
            } catch {
              // non-critical
            }
          });

          return { header, tree, statusMap, projects: filteredProjects, fromCache: true };
        }
      }

      const listStartAt = Date.now();
      let listRequestCount = 0;
      const wrapRequest = async <T,>(server: GitServerEntry, label: string, fn: () => Promise<T>): Promise<T> => {
        listRequestCount += 1;
        onRequestStart?.(server.name, listRequestCount);
        logger.info(t("cli.http.start", { server: server.name, label, count: String(listRequestCount) }));
        try {
          const result = await fn();
          logger.info(t("cli.http.success", { server: server.name, label }));
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : t("cli.errors.unknown");
          logger.error(t("cli.http.fail", { server: server.name, label, message }));
          throw error;
        }
      };

      const serverResults = await Promise.all(
        servers.map(async (server) => {
          if (server.type === "github") {
            if (!server.token) {
              logger.warn(t("cli.sync.noAuthConfigured", { server: server.name }));
              return null;
            }
            const api = new GitHubApi({
              baseUrl: server.baseUrl,
              token: server.token,
              verbose: config.verbose ?? false,
              logger: (message) => logger.debug(message),
            });
            try {
              const [groups, userProjects] = await Promise.all([
                wrapRequest(server, t("cli.http.listGroups"), () => api.listGroups()),
                wrapRequest(server, t("cli.http.listUserProjects"), () => api.listUserProjects()),
              ]);
              const projects = userProjects.filter((project, index, all) => {
                return all.findIndex((item) => item.id === project.id) === index;
              });
              const projectsWithMetadata: GitLabProject[] = projects.map((project) => {
                const meta: Partial<GitLabProject> = {};
                if (server.baseDir) meta.pajeBaseDir = server.baseDir;
                if (server.userEmail) meta.pajeUserEmail = server.userEmail;
                try {
                  const url = new URL(project.http_url_to_repo);
                  url.username = "x-access-token";
                  url.password = server.token as string;
                  meta.pajeHttpUrl = url.toString();
                } catch {
                  // keep without pajeHttpUrl
                }
                return { ...project, ...meta };
              });
              const serverFiltered = filterProjects(projectsWithMetadata, {
                filter: server.filter,
                noPublicRepos: server.noPublicRepos,
                noArchivedRepos: server.noArchivedRepos,
              } as GitSyncConfig);
              return { server, groups, projects: serverFiltered };
            } catch (error) {
              const status = (error as Error & { status?: number })?.status;
              if (status === 401 || status === 403) {
                // GitHub has no rotate-without-user-interaction endpoint and
                // no password-bootstrap fallback (PATs/OAuth tokens aren't
                // created that way there), so unlike GitLab this can't heal
                // itself — the clearest thing to do is name the cause and
                // point at the fix instead of silently skipping the server.
                logger.warn(t("cli.sync.githubTokenExpired", { server: server.name }));
              }
              return null;
            }
          }

          const serverHost = new URL(server.baseUrl).hostname;
          const hasSshAssociation = hasValidSshAssociation(serverHost);

          let resolvedToken = server.token;
          if (!resolvedToken && !hasSshAssociation && onMissingCredentials) {
            const bootstrapped = await onMissingCredentials(server, "missing");
            if (bootstrapped?.token) {
              resolvedToken = bootstrapped.token;
            }
          }

          if (!resolvedToken && !hasSshAssociation) {
            logger.warn(t("cli.sync.noAuthConfigured", { server: server.name }));
            return null;
          }

          let api = new GitLabApi({
            baseUrl: server.baseUrl,
            token: resolvedToken,
            verbose: config.verbose ?? false,
            logger: (message) => logger.debug(message),
          });

          if (hasSshAssociation || api.hasAuth()) {
            await ensureSshKey(api, logger, config);
          }

          const buildResult = (groups: GitLabGroup[], userProjects: GitLabProject[]) => {
            const projects = userProjects.filter((project, index, all) => {
              return all.findIndex((item) => item.id === project.id) === index;
            });

            const projectsWithMetadata: GitLabProject[] = projects.map((project) => {
              const meta: Partial<GitLabProject> = {};
              if (server.baseDir) meta.pajeBaseDir = server.baseDir;
              if (server.userEmail) meta.pajeUserEmail = server.userEmail;
              if (resolvedToken) {
                try {
                  const url = new URL(project.http_url_to_repo);
                  url.username = "oauth2";
                  url.password = resolvedToken;
                  meta.pajeHttpUrl = url.toString();
                } catch {
                  // keep without pajeHttpUrl
                }
              }
              return { ...project, ...meta };
            });

            const serverFiltered = filterProjects(projectsWithMetadata, {
              filter: server.filter,
              noPublicRepos: server.noPublicRepos,
              noArchivedRepos: server.noArchivedRepos,
            } as GitSyncConfig);

            return { server, groups, projects: serverFiltered };
          };

          const listOnce = () =>
            Promise.all([
              wrapRequest(server, t("cli.http.listGroups"), () => api.listGroups()),
              wrapRequest(server, t("cli.http.listUserProjects"), () => api.listUserProjects()),
            ]);

          try {
            const [groups, userProjects] = await listOnce();
            return buildResult(groups, userProjects);
          } catch (error) {
            const status = (error as { details?: { status?: number } })?.details?.status;
            const looksLikeAuthFailure = status === 401 || status === 403;
            if (!looksLikeAuthFailure || !resolvedToken) {
              // Not an auth problem (network error, etc.), or there was no
              // token to have gone stale in the first place (pure-SSH case
              // failing for some other reason) — behave as before.
              return null;
            }

            // The token exists but the server just rejected it — try to heal
            // it before giving up. Rotation needs no user interaction, so
            // it's attempted first; only if that fails too does this fall
            // back to the presentation layer's bootstrap (a fresh password).
            let healedToken: string | null = null;
            try {
              const rotated = await rotatePersonalAccessToken({
                baseUrl: server.baseUrl,
                token: resolvedToken,
                fetchImpl: globalThis.fetch,
                logger: (message) => logger.debug(message),
              });
              healedToken = rotated.token;
            } catch {
              // Rotation itself failed — the token is likely fully revoked,
              // not just expired. Fall through to the bootstrap below.
            }

            if (!healedToken && onMissingCredentials) {
              const bootstrapped = await onMissingCredentials(server, "invalid");
              healedToken = bootstrapped?.token ?? null;
            }

            if (!healedToken) {
              logger.warn(t("cli.sync.tokenExpired", { server: server.name }));
              return null;
            }

            const existingServers = readGitServers<GitServerEntry[]>([]);
            const merged = mergeServer(existingServers, withToken(server, healedToken));
            writeGitServers(merged.servers);

            resolvedToken = healedToken;
            api = new GitLabApi({
              baseUrl: server.baseUrl,
              token: resolvedToken,
              verbose: config.verbose ?? false,
              logger: (message) => logger.debug(message),
            });

            try {
              const [groups, userProjects] = await listOnce();
              return buildResult(groups, userProjects);
            } catch {
              logger.warn(t("cli.sync.tokenExpired", { server: server.name }));
              return null;
            }
          }
        })
      );

      const validServerResults = serverResults.filter(
        (result): result is { server: GitServerEntry; groups: GitLabGroup[]; projects: GitLabProject[] } =>
          result !== null
      );

      if (validServerResults.length === 0) {
        logger.warn(t("cli.sync.noValidServer"));
        return { header: "GitLab", tree: [], statusMap: {}, projects: [] };
      }

      const { groups, idMapByServer } = mergeGroupsByPath(
        validServerResults.map((result) => ({ server: result.server, groups: result.groups }))
      );
      const { projects } = mergeProjectsByPath(
        validServerResults.map((result) => ({ server: result.server, projects: result.projects })),
        idMapByServer
      );
      const activeServers = validServerResults.map((result) => result.server);
      const header = buildServersHeader(activeServers);
      const listDurationMs = Date.now() - listStartAt;
      logger.info(t("cli.sync.listDuration", { seconds: (listDurationMs / 1000).toFixed(2) }));

      const filteredProjects = filterProjects(projects, config);
      await ensureLocalDirsIfNeeded(filteredProjects, config.baseDir, config.prepareLocalDirs ?? false);

      const resolvedPaths = resolveLocalPathConflicts(filteredProjects);
      const statusEntries = await Promise.all(
        filteredProjects.map(async (project) => {
          const targetPath = path.join(
            project.pajeBaseDir ?? config.baseDir,
            resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project)
          );
          const status = await resolveRepoStatus({
            targetPath,
            defaultBranch: project.default_branch,
            knownRemote: true,
          });
          return [project.id, status] as const;
        })
      );
      const statusMap = Object.fromEntries(statusEntries) as Record<number, RepoSyncStatus>;

      try {
        const cacheEntry: GitTreeCacheEntry = {
          version: 1,
          configHash,
          servers: validServerResults.map((r) => ({
            serverName: r.server.name,
            groups: r.groups,
            projects: r.projects.map(({ pajeHttpUrl: _url, ...rest }) => rest),
          })),
          statusMap,
        };
        writeGitTreeCache(cacheEntry);
        logger.info(t("cli.cache.saved"));
      } catch {
        // non-critical
      }

      const tree = buildGitLabTree(filterGroups(groups, config), filteredProjects);
      const applyStatusToTree = (node: GitLabTreeNode): void => {
        if (node.type === "project" && node.project) {
          node.status = statusMap[node.project.id];
          node.localPath = path.join(
            node.project.pajeBaseDir ?? config.baseDir,
            resolvedPaths.get(node.project.id) ?? resolveProjectLocalPath(node.project)
          );
          return;
        }
        node.children?.forEach((child) => applyStatusToTree(child));
      };
      tree.forEach((node) => applyStatusToTree(node));
      applyInitialSelectionFromStatusMap(tree, statusMap);
      return { header, tree, statusMap, projects: filteredProjects };
    },
    toggleTreeSelection: (tree, id) => {
      toggleById(tree, id);
      return tree;
    },
    syncSelected: async ({ config, logger, tree, selectedProjects, handlers }) => {
      const syncSpecs = resolveSyncReposSpecs(config.syncRepos);
      let selected: GitLabProject[];
      if (selectedProjects !== undefined) {
        if (config.syncRepos) {
          logger.warn(t("cli.sync.singleModeSyncReposIgnored"));
        }
        selected = selectedProjects;
      } else if (syncSpecs.length > 0) {
        selected = collectAllProjectsFromTree(tree);
      } else {
        selected = collectSelectedProjects(tree);
      }

      if (selected.length === 0) {
        logger.warn(t("cli.sync.noneSelected"));
        return { summary: buildSummary() };
      }

      const resolvedUserName = config.username?.trim() || undefined;
      const resolvedUserEmail = config.userEmail?.trim() || undefined;
      const resolvedPaths = resolveLocalPathConflicts(selected);
      const syncTargets = syncSpecs.length > 0 && selectedProjects === undefined
        ? resolveSyncTargets(selected, syncSpecs).map((target) => ({
            ...target,
            localPath: path.join(config.baseDir, resolvedPaths.get(target.id) ?? target.pathWithNamespace),
            gitUserName: resolvedUserName,
            gitUserEmail: resolvedUserEmail,
          }))
        : prepareTargets(selected, config.baseDir, resolvedUserName, resolvedUserEmail);

      if (syncTargets.length === 0) {
        logger.warn(t("cli.sync.noSyncMatches"));
        return { summary: buildSummary() };
      }

      handlers?.onBegin?.(syncTargets.length);

      const concurrency = resolveParallels(config.parallels);
      const syncResults = await parallelSync(
        syncTargets,
        {
          concurrency,
          shallow: false,
          dryRun: config.dryRun ?? false,
          logger: (message, level) => logger.log(level ?? "info", message),
        },
        async (result) => {
          await handlers?.onResult?.({ status: result.status, message: result.message, target: result.target });
        },
        (event) => {
          handlers?.onProgress?.(event);
        }
      );

      const summary = buildSummary();
      syncResults.forEach((result) => {
        summary.total += 1;
        switch (result.status) {
          case "failed":
            summary.failed += 1;
            break;
          case "cloned":
            summary.byStatus.REMOTE += 1;
            break;
          case "pulled":
            summary.byStatus.BEHIND += 1;
            break;
          case "pushed":
            summary.byStatus.AHEAD += 1;
            break;
          case "skipped":
            summary.byStatus.SYNCED += 1;
            break;
          default:
            summary.byStatus.SYNCED += 1;
            break;
        }
      });

      return { summary };
    },
  };
};
