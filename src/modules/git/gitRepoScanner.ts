import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFilePromisified = promisify(execFile);
const execFileAsync = (file: string, args: string[]) =>
  execFilePromisified(file, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

export type LocalGitRepoInfo = {
  path: string;
  remoteUrl?: string;
  currentBranch?: string;
};

export const getRemoteUrl = async (repoPath: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote", "get-url", "origin"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
};

export const getCurrentBranch = async (repoPath: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
};

export const readLocalRepoInfo = async (repoPath: string): Promise<LocalGitRepoInfo> => {
  const [remoteUrl, currentBranch] = await Promise.all([
    getRemoteUrl(repoPath),
    getCurrentBranch(repoPath),
  ]);
  return {
    path: repoPath,
    remoteUrl,
    currentBranch,
  };
};

export const hasGitDir = async (repoPath: string): Promise<boolean> => {
  try {
    const stat = await fs.promises.stat(path.join(repoPath, ".git"));
    return stat.isDirectory();
  } catch {
    return false;
  }
};

export const getStatusPorcelain = async (repoPath: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "status", "--porcelain"]);
    return stdout.trim();
  } catch {
    return "";
  }
};

export const getAheadBehind = async (
  repoPath: string,
  branch: string
): Promise<{ ahead: number; behind: number }> => {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoPath,
      "rev-list",
      "--left-right",
      "--count",
      `origin/${branch}...${branch}`,
    ]);
    const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/);
    return {
      behind: Number(behindRaw ?? 0),
      ahead: Number(aheadRaw ?? 0),
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
};

const shouldSkipDir = (dirName: string): boolean => {
  if (!dirName) {
    return false;
  }
  if (dirName === ".git") {
    return true;
  }
  return false;
};

export const listLocalDirectories = async (baseDir: string): Promise<string[]> => {
  const entries = await fs.promises.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      if (shouldSkipDir(entry.name)) {
        return;
      }
      const fullPath = path.join(baseDir, entry.name);
      const gitDirExists = await hasGitDir(fullPath);
      if (gitDirExists) {
        results.push(fullPath);
        return;
      }
      const nested = await listLocalDirectories(fullPath);
      results.push(...nested);
    })
  );
  return results;
};
