import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GitTreeCacheEntry } from "./types.js";

export type PajePaths = {
  baseDir: string;
  logsDir: string;
  serversFile: string;
  tokensFile: string;
  treeCacheFile: string;
};

const DEFAULT_BASE_DIR = ".paje";

export const resolvePajePaths = (): PajePaths => {
  const home = os.homedir();
  const baseDir = path.join(home, DEFAULT_BASE_DIR);
  const logsDir = path.join(baseDir, "logs");
  const serversFile = path.join(baseDir, "git-servers.json");
  const tokensFile = path.join(baseDir, "git-tokens.json");
  const treeCacheFile = path.join(baseDir, "git-tree-cache.json");
  return {
    baseDir,
    logsDir,
    serversFile,
    tokensFile,
    treeCacheFile,
  };
};

export const ensurePajeDirs = (paths: PajePaths = resolvePajePaths()): void => {
  fs.mkdirSync(paths.baseDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
};

export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
};

export const writeJsonFile = <T>(filePath: string, data: T): void => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

export const readGitServers = <T>(fallback: T): T => {
  const { serversFile } = resolvePajePaths();
  return readJsonFile<T>(serversFile, fallback);
};

export const writeGitServers = <T>(data: T): void => {
  const { serversFile } = resolvePajePaths();
  writeJsonFile<T>(serversFile, data);
};

export const readGitTokens = <T>(fallback: T): T => {
  const { tokensFile } = resolvePajePaths();
  return readJsonFile<T>(tokensFile, fallback);
};

export const writeGitTokens = <T>(data: T): void => {
  const { tokensFile } = resolvePajePaths();
  writeJsonFile<T>(tokensFile, data);
};

export const readGitTreeCache = (): GitTreeCacheEntry | null => {
  const { treeCacheFile } = resolvePajePaths();
  return readJsonFile<GitTreeCacheEntry | null>(treeCacheFile, null);
};

export const writeGitTreeCache = (entry: GitTreeCacheEntry): void => {
  const { treeCacheFile } = resolvePajePaths();
  writeJsonFile(treeCacheFile, entry);
};

const camelToKebab = (name: string): string =>
  name.replace(/([A-Z])/g, (char) => `-${char.toLowerCase()}`);

const kebabToCamel = (key: string): string =>
  key.replace(/-([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());

const serializeYamlValue = (value: string): string => {
  if (value === "true" || value === "false") return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (value.startsWith("[")) return value;
  if (!value) return '""';
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

export const resolveDefaultEnvYamlPath = (): string =>
  path.join(os.homedir(), ".paje", "env.yaml");

export const writeEnvYamlUpdates = (
  updates: Record<string, string>,
  filePath?: string
): void => {
  const resolvedPath = filePath ?? resolveDefaultEnvYamlPath();

  let lines: string[] = [];
  try {
    lines = fs.readFileSync(resolvedPath, "utf-8").split(/\r?\n/);
  } catch {
    // file does not exist yet; we'll create it
  }

  const remaining = new Set(Object.keys(updates));

  const updatedLines = lines.map((line) => {
    const commentIndex = line.indexOf("#");
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) return line;
    if (commentIndex >= 0 && commentIndex < separatorIndex) return line;

    const rawKey = line.slice(0, separatorIndex).trim();
    const camelKey = kebabToCamel(rawKey);

    if (Object.prototype.hasOwnProperty.call(updates, camelKey)) {
      remaining.delete(camelKey);
      return `${rawKey}: ${serializeYamlValue(updates[camelKey]!)}`;
    }
    return line;
  });

  for (const camelKey of remaining) {
    const kebabKey = camelToKebab(camelKey);
    updatedLines.push(`${kebabKey}: ${serializeYamlValue(updates[camelKey]!)}`);
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, updatedLines.join("\n"));
};
