import fs from "node:fs";
import path from "node:path";
import { t } from "../../../i18n/index.js";
import { GitLabApi } from "../gitlabApi.js";
import { parallelSync, runGit, type ProgressEvent } from "../parallelSync.js";
import { splitFilterPatterns } from "../patternFilter.js";
import { readGitServers, writeGitServers } from "../persistence.js";
import {
  addHostToKnownHosts,
  getIdentityFileForHost,
  isHostInKnownHosts,
  listSshPublicKeys,
  readPublicKey,
  registerKeyInGitLab,
  resolveSshIdentityPath,
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
  RepoSyncStatus,
} from "../types.js";
import { LoggerBroker } from "./loggerBroker.js";
import type { GitSyncConfig } from "./gitSyncConfig.js";

export type GitServerEntry = {
  id: string;
  name: string;
  baseUrl: string;
  useBasicAuth?: boolean;
  username?: string;
  token?: string;
};

export type GitSyncTreeView = {
  header: string;
  tree: GitLabTreeNode[];
  statusMap: Record<number, RepoSyncStatus>;
};

export type GitSyncProgressHandlers = {
  onProgress?: (event: ProgressEvent) => void;
  onResult?: (entry: { status: string; message?: string; target: GitRepositoryTarget }) => void;
};

export type GitSyncSummary = {
  total: number;
  publicCount: number;
  archivedCount: number;
  byStatus: Record<string, number>;
};

export type GitSyncCore = {
  listServers: (options: { config: GitSyncConfig; logger: LoggerBroker }) => Promise<GitServerEntry[]>;
  loadTree: (options: { config: GitSyncConfig; logger: LoggerBroker }) => Promise<GitSyncTreeView>;
  toggleTreeSelection: (tree: GitLabTreeNode[], id: string) => GitLabTreeNode[];
  syncSelected: (options: {
    config: GitSyncConfig;
    logger: LoggerBroker;
    tree: GitLabTreeNode[];
    handlers?: GitSyncProgressHandlers;
  }) => Promise<{ summary: GitSyncSummary }>;
};

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

const buildServerPrefix = (server: GitServerEntry): string => {
  const suffix = server.useBasicAuth ? " (basic)" : "";
  return `${server.name}${suffix}`;
};

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

const mergeServer = (
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

const resolveSyncReposSpecs = (rawPatterns?: string): Array<{ projectPath: string; branch?: string }> => {
  const specs: Array<{ projectPath: string; branch?: string }> = [];
  splitFilterPatterns(rawPatterns).forEach((rawPattern: string) => {
    if (!rawPattern.includes("@")) {
      specs.push({ projectPath: rawPattern });
      return;
    }
    const [projectPath, branch] = rawPattern.split("@");
    specs.push({ projectPath, branch });
  });
  return specs;
};

const resolveSyncTargets = (
  projects: GitLabProject[],
  specs: Array<{ projectPath: string; branch?: string }>
): GitRepositoryTarget[] => {
  const matches: GitRepositoryTarget[] = [];
  const normalizedProjects = projects.map((project) => ({
    project,
    matchPath: project.path_with_namespace.toLowerCase(),
  }));

  specs.forEach((spec) => {
    const normalizedSpec = spec.projectPath.toLowerCase();
    normalizedProjects.forEach(({ project, matchPath }) => {
      if (matchPath !== normalizedSpec) {
        return;
      }
      matches.push({
        id: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        sshUrl: project.ssh_url_to_repo,
        localPath: "",
        defaultBranch: spec.branch || project.default_branch,
        branch: spec.branch,
      });
    });
  });

  matches.forEach((target) => {
    target.pathWithNamespace = target.pathWithNamespace.trim();
  });

  return matches;
};

const resolveRepoStatus = async (options: {
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

const resolveProjectLocalPath = (project: GitLabProject): string => {
  return project.pajeOriginalPathWithNamespace ?? project.path_with_namespace;
};

const resolveLocalPathConflicts = (projects: GitLabProject[]): Map<number, string> => {
  const byPath = new Map<string, GitLabProject[]>();
  const resolved = new Map<number, string>();

  projects.forEach((project) => {
    const basePath = resolveProjectLocalPath(project);
    const entries = byPath.get(basePath) ?? [];
    entries.push(project);
    byPath.set(basePath, entries);
  });

  byPath.forEach((entries, basePath) => {
    if (entries.length === 1) {
      resolved.set(entries[0].id, basePath);
      return;
    }
    entries.forEach((project) => {
      const serverName = project.pajeServerName?.trim();
      const suffix = serverName && serverName.length > 0 ? `-${serverName}` : "-servidor";
      resolved.set(project.id, `${basePath}${suffix}`);
    });
  });

  return resolved;
};

const ensureLocalDirsIfNeeded = async (
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
  const added = await addHostToKnownHosts(server, {
    verbose,
    logger: (message) => logger.debug(message),
  });
  if (!added) {
    logger.warn(
      `Não foi possível adicionar ${server} ao ~/.ssh/known_hosts via ssh-keyscan. Verifique conectividade e permissões.`
    );
  }
};

const ensureSshKey = async (api: GitLabApi, logger: LoggerBroker, config: GitSyncConfig): Promise<void> => {
  const server = api.getServerHost();
  let associatedIdentityPath = getIdentityFileForHost(server);
  if (associatedIdentityPath) {
    const resolved = resolveSshIdentityPath(associatedIdentityPath);
    if (!fs.existsSync(resolved)) {
      logger.warn(`A chave vinculada em ~/.ssh/config para ${server} não existe (${associatedIdentityPath}).`);
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
      logger.warn(`Chave pública informada não existe: ${selectedKey}`);
      return;
    }
    const key = sanitizePublicKey(readPublicKey(selectedKey));
    upsertSshConfigHost(server, selectedKey.replace(/\.pub$/, ""));
    await ensureKnownHost(server, logger, config.verbose ?? false);
    if (api.hasAuth()) {
      try {
        await registerKeyInGitLab(api, `paje-existing-${Date.now()}`, key);
      } catch (error) {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        logger.warn(`Falha ao registrar chave no GitLab: ${message}`);
      }
    }
    return;
  }

  const existingKeys = listSshPublicKeys();
  if (existingKeys.length === 0) {
    logger.warn("Nenhuma chave SSH configurada em ~/.ssh. Configure uma chave para continuar.");
  }
};

const buildSummary = (): GitSyncSummary => ({
  total: 0,
  publicCount: 0,
  archivedCount: 0,
  byStatus: {
    SYNCED: 0,
    UPDATED: 0,
    UNPUSHED: 0,
    UNCOMMITTED: 0,
    AHEAD: 0,
    BEHIND: 0,
    DIVERGED: 0,
    CLONED: 0,
    FAILED: 0,
  },
});

const filterProjects = (projects: GitLabProject[], config: GitSyncConfig): GitLabProject[] => {
  return projects.filter((project) => {
    if (config.noArchivedRepos && project.archived) {
      return false;
    }
    if (config.noPublicRepos && project.visibility === "public") {
      return false;
    }
    if (config.filter) {
      const normalizedPath = project.path_with_namespace.toLowerCase();
      const normalizedFilter = config.filter.trim().toLowerCase();
      return normalizedPath.includes(normalizedFilter);
    }
    return true;
  });
};

const prepareTargets = (
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
    localPath: path.join(baseDir, resolvedPaths.get(project.id) ?? resolveProjectLocalPath(project)),
    defaultBranch: project.default_branch,
    gitUserName: username,
    gitUserEmail: userEmail,
  }));
};

const resolveParallels = (rawValue?: string): number | "auto" => {
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
          useBasicAuth: config.useBasicAuth ?? false,
          username: config.username,
        };
        const merge = mergeServer(servers, server);
        writeGitServers(merge.servers);
        servers = mergeServerList(merge.servers);
      }

      if (servers.length === 0) {
        logger.warn("Nenhum servidor GitLab configurado.");
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
    loadTree: async ({ config, logger }) => {
      const servers = await createGitSyncCore().listServers({ config, logger });
      if (servers.length === 0) {
        return { header: "GitLab", tree: [], statusMap: {} };
      }

      const listStartAt = Date.now();
      let listRequestCount = 0;
      const wrapRequest = async <T,>(server: GitServerEntry, label: string, fn: () => Promise<T>): Promise<T> => {
        listRequestCount += 1;
        logger.info(`HTTP: ${server.name} - ${label} (requisição ${listRequestCount})`);
        try {
          const result = await fn();
          logger.info(`HTTP: ${server.name} - ${label} concluído`);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "erro desconhecido";
          logger.error(`HTTP: ${server.name} - ${label} falhou: ${message}`);
          throw error;
        }
      };

      const serverResults = await Promise.all(
        servers.map(async (server) => {
          const serverHost = new URL(server.baseUrl).hostname;
          const hasSshAssociation = hasValidSshAssociation(serverHost);
          let basicAuth: { username: string; password: string } | undefined;

          if (server.useBasicAuth && !hasSshAssociation) {
            const username = server.username?.trim();
            const resolvedUsername = username && username.length > 0 ? username : "";
            if (!resolvedUsername) {
              logger.warn(`Usuário não informado para autenticação básica em ${server.name}.`);
              return null;
            }
            basicAuth = { username: resolvedUsername, password: config.password };
          }

          const api = new GitLabApi({
            baseUrl: server.baseUrl,
            basicAuth,
            token: server.token,
            verbose: config.verbose ?? false,
            logger: (message) => logger.debug(message),
          });

          if (!api.hasAuth()) {
            logger.warn(t("cli.sync.noAuthConfigured", { server: server.name }));
            return null;
          }

          if (hasSshAssociation || api.hasAuth()) {
            await ensureSshKey(api, logger, config);
          }

          const [groups, userProjects] = await Promise.all([
            wrapRequest(server, t("cli.http.listGroups"), () => api.listGroups()),
            wrapRequest(server, t("cli.http.listUserProjects"), () => api.listUserProjects()),
          ]);
          const projects = userProjects.filter((project, index, all) => {
            return all.findIndex((item) => item.id === project.id) === index;
          });

          const projectsWithHttpUrl: GitLabProject[] = server.token
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
      );

      const validServerResults = serverResults.filter(
        (result): result is { server: GitServerEntry; groups: GitLabGroup[]; projects: GitLabProject[] } =>
          result !== null
      );

      if (validServerResults.length === 0) {
        logger.warn(t("cli.sync.noValidServer"));
        return { header: "GitLab", tree: [], statusMap: {} };
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
      const summary = buildSummary();
      filteredProjects.forEach((project) => {
        summary.total += 1;
        if (project.visibility === "public") {
          summary.publicCount += 1;
        }
        if (project.archived) {
          summary.archivedCount += 1;
        }
      });

      await ensureLocalDirsIfNeeded(filteredProjects, config.baseDir, config.prepareLocalDirs ?? false);

      const resolvedPaths = resolveLocalPathConflicts(filteredProjects);
      const statusEntries = await Promise.all(
        filteredProjects.map(async (project) => {
          const targetPath = path.join(
            config.baseDir,
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
      const tree = buildGitLabTree(groups, filteredProjects);
      const applyStatusToTree = (node: GitLabTreeNode): void => {
        if (node.type === "project" && node.project) {
          node.status = statusMap[node.project.id];
          node.localPath = path.join(
            config.baseDir,
            resolvedPaths.get(node.project.id) ?? resolveProjectLocalPath(node.project)
          );
          return;
        }
        node.children?.forEach((child) => applyStatusToTree(child));
      };
      tree.forEach((node) => applyStatusToTree(node));
      applyInitialSelectionFromStatusMap(tree, statusMap);
      return { header, tree, statusMap };
    },
    toggleTreeSelection: (tree, id) => {
      toggleById(tree, id);
      return tree;
    },
    syncSelected: async ({ config, logger, tree, handlers }) => {
      const selected = collectSelectedProjects(tree);
      if (selected.length === 0) {
        logger.warn(t("cli.sync.noneSelected"));
        return { summary: buildSummary() };
      }

      const resolvedUserName = config.username?.trim() || undefined;
      const resolvedUserEmail = config.userEmail?.trim() || undefined;
      const syncSpecs = resolveSyncReposSpecs(config.syncRepos);
      const resolvedPaths = resolveLocalPathConflicts(selected);
      const syncTargets = syncSpecs.length > 0
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

      const concurrency = resolveParallels(config.parallels);
      const syncResults = await parallelSync(
        syncTargets,
        {
          concurrency,
          shallow: false,
          dryRun: config.dryRun ?? false,
          logger: (message, level) => logger.log(level ?? "info", message),
        },
        (result) => {
          handlers?.onResult?.({ status: result.status, message: result.message, target: result.target });
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
            summary.byStatus.FAILED += 1;
            break;
          case "cloned":
            summary.byStatus.CLONED += 1;
            break;
          case "pulled":
          case "pushed":
            summary.byStatus.UPDATED += 1;
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
