import type { GitLabProject } from "./types.js";

export const resolveProjectLocalPath = (project: GitLabProject): string => {
  return project.pajeOriginalPathWithNamespace ?? project.path_with_namespace;
};

export const resolveLocalPathConflicts = (projects: GitLabProject[]): Map<number, string> => {
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
