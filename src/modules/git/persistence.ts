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
