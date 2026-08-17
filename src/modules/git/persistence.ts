import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GitTreeCacheEntry } from "./types.js";
import { ENV_TEMPLATE_CONTENT } from "./envTemplate.js";

export type PajePaths = {
  baseDir: string;
  logsDir: string;
  serversFile: string;
  tokensFile: string;
  treeCacheFile: string;
  cdTargetFile: string;
};

const DEFAULT_BASE_DIR = ".paje";

export const resolvePajePaths = (): PajePaths => {
  const home = os.homedir();
  const baseDir = path.join(home, DEFAULT_BASE_DIR);
  const logsDir = path.join(baseDir, "logs");
  const serversFile = path.join(baseDir, "git-servers.json");
  const tokensFile = path.join(baseDir, "git-tokens.json");
  const treeCacheFile = path.join(baseDir, "git-tree-cache.json");
  const cdTargetFile = path.join(baseDir, "cd-target");
  return {
    baseDir,
    logsDir,
    serversFile,
    tokensFile,
    treeCacheFile,
    cdTargetFile,
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

// Plain text, not JSON — the only consumer is a shell function (bash/zsh
// paje(), PowerShell's paje profile function) appended by the installer,
// which just needs the raw path to cd into after PAJÉ exits.
export const writeCdTarget = (targetPath: string): void => {
  const { cdTargetFile, baseDir } = resolvePajePaths();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(cdTargetFile, targetPath, "utf-8");
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

// Creates ~/.paje/env.yaml (or the given path) from the commented template
// when it doesn't exist yet. Called on every startup for the default path
// (see loadEnvConfig in sshManager.ts) so the very first run leaves the user
// with a fully documented file instead of nothing. Returns true if the file
// was created, false if it already existed.
export const ensureEnvYamlExists = (filePath?: string): boolean => {
  const resolvedPath = filePath ?? resolveDefaultEnvYamlPath();
  if (fs.existsSync(resolvedPath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, ENV_TEMPLATE_CONTENT);
  return true;
};

export const writeEnvYamlUpdates = (
  updates: Record<string, string>,
  filePath?: string
): void => {
  const resolvedPath = filePath ?? resolveDefaultEnvYamlPath();

  // Seed from the commented template rather than an empty file: if the
  // target doesn't exist yet (e.g. deleted after startup, or a fresh custom
  // --env-file), the first save through the TUI editor (Ctrl+E) must not
  // produce a file stripped of every comment.
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(resolvedPath, "utf-8").split(/\r?\n/);
  } catch {
    lines = ENV_TEMPLATE_CONTENT.split(/\r?\n/);
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
