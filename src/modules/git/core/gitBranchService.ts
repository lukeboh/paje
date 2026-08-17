import { runGit } from "../parallelSync.js";
import { getAheadBehind, getStatusPorcelain, hasGitDir, readLocalRepoInfo } from "../gitRepoScanner.js";
import type { RepoSyncStatus } from "../types.js";

type BranchStatusOptions = {
  targetPath: string;
  defaultBranch?: string;
  fetch?: boolean;
};

const normalizeBranchName = (name: string): string => {
  const withoutRemotes = name.replace(/^remotes\//, "");
  return withoutRemotes.replace(/^origin\//, "");
};

export const hasRef = async (targetPath: string, ref: string): Promise<boolean> => {
  try {
    await runGit(["-C", targetPath, "show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

// Local or remote-tracking ref — same two refs checkoutBranch already
// checks before falling through to a bare `git checkout <branch>` (which
// only succeeds if git itself can resolve it some other way, e.g. a
// unique short SHA — not relevant here). Read-only: never triggers a
// checkout, so it's safe to call before deciding whether to prompt for
// branch creation.
export const branchExistsRemoteOrLocal = async (targetPath: string, branch: string): Promise<boolean> => {
  const normalized = normalizeBranchName(branch);
  if (await hasRef(targetPath, `refs/heads/${normalized}`)) {
    return true;
  }
  return hasRef(targetPath, `refs/remotes/origin/${normalized}`);
};

const formatGitCommand = (args: string[]): string => `git ${args.join(" ")}`;

export const listLocalBranches = async (targetPath: string): Promise<string[]> => {
  const output = await runGit(["-C", targetPath, "branch", "-a", "--format=%(refname:short)"]);
  const branches = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => name !== "HEAD" && !name.endsWith("/HEAD"))
    .map((name) => normalizeBranchName(name));
  return Array.from(new Set(branches));
};

export const checkoutBranch = async (targetPath: string, branch: string): Promise<string> => {
  const normalizedBranch = normalizeBranchName(branch);
  const localRef = `refs/heads/${normalizedBranch}`;
  const remoteRef = `refs/remotes/origin/${normalizedBranch}`;
  if (await hasRef(targetPath, localRef)) {
    const args = ["-C", targetPath, "checkout", normalizedBranch];
    await runGit(args);
    return formatGitCommand(args);
  }
  if (await hasRef(targetPath, remoteRef)) {
    const args = ["-C", targetPath, "checkout", "-b", normalizedBranch, "--track", `origin/${normalizedBranch}`];
    await runGit(args);
    return formatGitCommand(args);
  }
  const args = ["-C", targetPath, "checkout", normalizedBranch];
  await runGit(args);
  return formatGitCommand(args);
};

export const createBranchAndPush = async (targetPath: string, branch: string): Promise<void> => {
  await runGit(["-C", targetPath, "checkout", "-b", branch]);
  await runGit(["-C", targetPath, "push", "-u", "origin", branch]);
};

export type BulkBranchTarget = { targetPath: string; label: string };

export type BulkBranchResult = {
  target: BulkBranchTarget;
  status: "checked-out" | "created" | "skipped" | "failed";
  // Only set when status is "skipped" — a code, not a message, so the
  // presentation layer builds the actual (i18n'd) text; core never embeds
  // user-facing strings.
  reason?: "no-default-branch" | "branch-missing";
  // Only set when status is "failed" — the raw error text from the
  // underlying git command, passed through as-is (same as every other
  // git-failure surface in this file: the caller wraps it in its own
  // translated template, it never re-translates the git output itself).
  message?: string;
};

// Single-repo: checks out the branch if it exists (local or remote-tracking,
// via checkoutBranch), otherwise creates+pushes it when createIfMissing is
// set, otherwise reports "skipped" without throwing — the bulk variant below
// relies on that to keep going instead of aborting the whole batch.
export const checkoutOrCreateBranch = async (
  targetPath: string,
  branch: string,
  options: { createIfMissing: boolean }
): Promise<{ action: "checked-out" | "created" | "skipped" }> => {
  if (await branchExistsRemoteOrLocal(targetPath, branch)) {
    await checkoutBranch(targetPath, branch);
    return { action: "checked-out" };
  }
  if (!options.createIfMissing) {
    return { action: "skipped" };
  }
  await createBranchAndPush(targetPath, branch);
  return { action: "created" };
};

// Read-only pass over every target, used to build the "N repos don't have
// this branch yet — create it there too?" confirmation before anything is
// actually mutated.
export const checkBranchAvailability = async (
  targets: BulkBranchTarget[],
  branch: string
): Promise<{ withBranch: BulkBranchTarget[]; withoutBranch: BulkBranchTarget[] }> => {
  const withBranch: BulkBranchTarget[] = [];
  const withoutBranch: BulkBranchTarget[] = [];
  for (const target of targets) {
    const exists = await branchExistsRemoteOrLocal(target.targetPath, branch);
    (exists ? withBranch : withoutBranch).push(target);
  }
  return { withBranch, withoutBranch };
};

// Sequential, not parallel: these mutate working trees (checkout, and
// possibly push), so running them concurrently risks colliding with a sync
// in progress or with each other. One target failing (e.g. uncommitted
// changes git itself refuses to check out over) must not abort the rest of
// the batch, hence the per-item try/catch here rather than one at the
// caller.
export const checkoutOrCreateBranchBulk = async (
  targets: BulkBranchTarget[],
  branch: string,
  createIfMissing: boolean
): Promise<BulkBranchResult[]> => {
  const results: BulkBranchResult[] = [];
  for (const target of targets) {
    try {
      const { action } = await checkoutOrCreateBranch(target.targetPath, branch, { createIfMissing });
      if (action === "skipped") {
        results.push({ target, status: "skipped", reason: "branch-missing" });
      } else {
        results.push({ target, status: action });
      }
    } catch (error) {
      results.push({ target, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
};

export const checkoutDefaultBranchBulk = async (
  targets: Array<BulkBranchTarget & { defaultBranch?: string }>
): Promise<BulkBranchResult[]> => {
  const results: BulkBranchResult[] = [];
  for (const target of targets) {
    if (!target.defaultBranch) {
      results.push({ target, status: "skipped", reason: "no-default-branch" });
      continue;
    }
    try {
      await checkoutBranch(target.targetPath, target.defaultBranch);
      results.push({ target, status: "checked-out" });
    } catch (error) {
      results.push({ target, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
};

// Local rename is always attempted; the remote side only if the repo
// actually has one configured (options.hasRemote — caller resolves this via
// readLocalRepoInfo, same signal resolveRepoStatus below already uses,
// rather than trusting API metadata that might not reflect the real local
// clone). Pushes the new name (with -u, so the rename doesn't leave the
// branch tracking the about-to-be-deleted old remote ref) before deleting
// the old one, so a failure in between never leaves zero copies of the
// branch on the remote. If only the delete step fails, the rename itself
// already succeeded — that's reported back, not thrown, so the caller can
// log a warning instead of treating the whole operation as failed.
export const renameBranch = async (
  targetPath: string,
  oldName: string,
  newName: string,
  options: { hasRemote: boolean }
): Promise<{ remoteDeleteFailed?: boolean }> => {
  await runGit(["-C", targetPath, "branch", "-m", oldName, newName]);
  if (!options.hasRemote) {
    return {};
  }
  await runGit(["-C", targetPath, "push", "-u", "origin", newName]);
  try {
    await runGit(["-C", targetPath, "push", "origin", "--delete", oldName]);
    return {};
  } catch {
    return { remoteDeleteFailed: true };
  }
};

export const resolveRepoStatus = async ({ targetPath, defaultBranch, fetch }: BranchStatusOptions): Promise<RepoSyncStatus> => {
  const branchFallback = defaultBranch ?? "main";
  const hasRepo = await hasGitDir(targetPath);
  if (!hasRepo) {
    return {
      branch: branchFallback,
      state: "EMPTY",
    };
  }

  const repoInfo = await readLocalRepoInfo(targetPath);
  const branch = repoInfo.currentBranch ?? branchFallback;
  if (!repoInfo.remoteUrl) {
    return {
      branch,
      state: "LOCAL",
    };
  }

  const pendingChanges = await getStatusPorcelain(targetPath);
  if (pendingChanges) {
    return { branch, state: "UNCOMMITTED" };
  }

  if (fetch) {
    await runGit(["-C", targetPath, "fetch", "--quiet"]).catch(() => undefined);
  }

  const { ahead, behind } = await getAheadBehind(targetPath, branch);
  if (ahead === 0 && behind === 0) {
    return { branch, state: "SYNCED" };
  }
  if (behind > 0 && ahead === 0) {
    return { branch, state: "BEHIND", delta: `-${behind}` };
  }
  if (ahead > 0 && behind === 0) {
    return { branch, state: "AHEAD", delta: `+${ahead}` };
  }
  return { branch, state: "AHEAD", delta: `+${ahead}/-${behind}` };
};
