import { spawn } from "node:child_process";
import { runGit } from "./parallelSync.js";

export interface GitCredentialOptions {
  baseUrl: string;
  token: string;
  username?: string;
  isGitHub?: boolean;
  logger?: (message: string) => void;
}

export const runGitWithStdin = async (
  args: string[],
  stdinInput: string,
  cwd?: string
): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf-8");
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });

    if (child.stdin) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    }
  });
};

/**
 * Checks if a git credential helper is already configured globally.
 * If none is configured, sets `git config --global credential.helper store`.
 */
export const ensureGitCredentialHelper = async (
  logger?: (message: string) => void
): Promise<void> => {
  try {
    const currentHelper = (
      await runGit(["config", "--global", "--get", "credential.helper"]).catch(() => "")
    ).trim();

    if (!currentHelper) {
      await runGit(["config", "--global", "credential.helper", "store"]);
      logger?.("Git credential helper configurado globalmente como 'store'.");
    }
  } catch (error) {
    logger?.(
      `Aviso ao verificar/configurar credential.helper: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export const parseCredentialTarget = (
  baseUrl: string,
  username?: string,
  isGitHub?: boolean
): { protocol: string; host: string; resolvedUsername: string } => {
  const url = new URL(baseUrl);
  const protocol = url.protocol.replace(":", "") || "https";
  const host = url.host;
  const resolvedUsername =
    username?.trim() ||
    (isGitHub || host.toLowerCase().includes("github") ? "x-access-token" : "oauth2");
  return { protocol, host, resolvedUsername };
};

/**
 * Registers / approves credentials in Git's credential helper (e.g. ~/.git-credentials).
 */
export const approveGitCredential = async (
  options: GitCredentialOptions
): Promise<void> => {
  if (!options.token || !options.baseUrl) {
    return;
  }
  await ensureGitCredentialHelper(options.logger);
  try {
    const { protocol, host, resolvedUsername } = parseCredentialTarget(
      options.baseUrl,
      options.username,
      options.isGitHub
    );
    const input = [
      `protocol=${protocol}`,
      `host=${host}`,
      `username=${resolvedUsername}`,
      `password=${options.token}`,
      "",
      "",
    ].join("\n");

    await runGitWithStdin(["credential", "approve"], input);
  } catch (error) {
    options.logger?.(
      `Falha ao registrar credencial no Git: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Rejects / removes credentials from Git's credential helper.
 */
export const rejectGitCredential = async (options: {
  baseUrl: string;
  username?: string;
  isGitHub?: boolean;
  logger?: (message: string) => void;
}): Promise<void> => {
  if (!options.baseUrl) {
    return;
  }
  try {
    const { protocol, host, resolvedUsername } = parseCredentialTarget(
      options.baseUrl,
      options.username,
      options.isGitHub
    );
    const input = [
      `protocol=${protocol}`,
      `host=${host}`,
      `username=${resolvedUsername}`,
      "",
      "",
    ].join("\n");

    await runGitWithStdin(["credential", "reject"], input);
  } catch (error) {
    options.logger?.(
      `Falha ao revogar credencial no Git: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
