import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";
import { ensureEnvYamlExists, resolveDefaultEnvYamlPath } from "./persistence.js";

const execFilePromisified = promisify(execFile);
const execFileAsync = (file: string, args: string[]) =>
  execFilePromisified(file, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

export type SshKeyInfo = {
  publicKeyPath: string;
  privateKeyPath: string;
  publicKey: string;
};

export type GitCredentials = {
  username: string;
  password: string;
  source: string;
};

export type SshManagerLogger = (message: string) => void;

export type EnsureGitLabSshKeyOptions = {
  baseUrl?: string;
  title?: string;
  usageType?: "auth_and_signing" | "auth" | "signing";
  keyLabel?: string;
  passphrase?: string;
  keyInfo?: SshKeyInfo;
  credentials?: GitCredentials;
  envFilePaths?: string[];
  jsonFilePath?: string;
  allowProcessEnv?: boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
  logger?: SshManagerLogger;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
};

export type EnsureGitLabTokenOptions = {
  baseUrl?: string;
  name: string;
  description?: string;
  scopes?: string[];
  expiresAt?: string;
  credentials?: GitCredentials;
  envFilePaths?: string[];
  jsonFilePath?: string;
  allowProcessEnv?: boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
  logger?: SshManagerLogger;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
};

type SshConfigBlock = {
  hosts: string[];
  start: number;
  end: number;
  identityFile?: string;
  hostName?: string;
  user?: string;
  identitiesOnly?: string;
};

export const sshKeyExists = (keyLabel: string): boolean => {
  const sshDir = path.join(os.homedir(), ".ssh");
  const safeLabel = keyLabel.replace(/[^a-zA-Z0-9-_]/g, "_");
  const privateKeyPath = path.join(sshDir, safeLabel);
  const publicKeyPath = `${privateKeyPath}.pub`;
  return fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath);
};

export type SshKeyChoice = "existing" | "generate";

export const listSshPublicKeys = (): string[] => {
  const sshDir = path.join(os.homedir(), ".ssh");
  if (!fs.existsSync(sshDir)) {
    return [];
  }

  return fs
    .readdirSync(sshDir)
    .filter((file) => file.endsWith(".pub"))
    .map((file) => path.join(sshDir, file));
};

export const readPublicKey = (publicKeyPath: string): string => {
  return fs.readFileSync(publicKeyPath, "utf-8").trim();
};

export const sanitizePublicKey = (publicKey: string): string => {
  return publicKey.replace(/\r?\n/g, " ").trim();
};

export const getSshConfigPath = (): string => path.join(os.homedir(), ".ssh", "config");

const getKnownHostsPath = (): string => path.join(os.homedir(), ".ssh", "known_hosts");

const normalizeSshConfigValue = (value: string): string => {
  const trimmed = value.split("#")[0].trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseSshConfigContents = (contents: string): { lines: string[]; blocks: SshConfigBlock[] } => {
  const lines = contents.split(/\r?\n/);
  const blocks: SshConfigBlock[] = [];
  let currentBlock: SshConfigBlock | null = null;

  const finalizeBlock = (endIndex: number): void => {
    if (currentBlock) {
      currentBlock.end = endIndex;
      blocks.push(currentBlock);
      currentBlock = null;
    }
  };

  lines.forEach((line, index) => {
    const hostMatch = line.match(/^\s*Host\s+(.+)$/i);
    if (hostMatch) {
      finalizeBlock(index);
      const hosts = hostMatch[1].trim().split(/\s+/).filter(Boolean);
      currentBlock = { hosts, start: index, end: lines.length };
      return;
    }

    if (!currentBlock) {
      return;
    }

    const identityMatch = line.match(/^\s*IdentityFile\s+(.+)$/i);
    if (identityMatch) {
      currentBlock.identityFile = normalizeSshConfigValue(identityMatch[1]);
    }
    const hostNameMatch = line.match(/^\s*HostName\s+(.+)$/i);
    if (hostNameMatch) {
      currentBlock.hostName = normalizeSshConfigValue(hostNameMatch[1]);
    }
    const userMatch = line.match(/^\s*User\s+(.+)$/i);
    if (userMatch) {
      currentBlock.user = normalizeSshConfigValue(userMatch[1]);
    }
    const identitiesOnlyMatch = line.match(/^\s*IdentitiesOnly\s+(.+)$/i);
    if (identitiesOnlyMatch) {
      currentBlock.identitiesOnly = normalizeSshConfigValue(identitiesOnlyMatch[1]);
    }
  });

  finalizeBlock(lines.length);
  return { lines, blocks };
};

export const getIdentityFileForHostFromContents = (contents: string, host: string): string | null => {
  const { blocks } = parseSshConfigContents(contents);
  const block = blocks.find((item) => item.hosts.includes(host));
  return block?.identityFile ?? null;
};

const formatIdentityFilePath = (identityFilePath: string): string => {
  const homeDir = os.homedir();
  const normalizedPath = identityFilePath.replace(/\\/g, "/");
  const normalizedHome = homeDir.replace(/\\/g, "/");
  if (normalizedPath.startsWith(normalizedHome)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return normalizedPath;
};

export const resolveSshIdentityPath = (identityFile: string): string => {
  if (identityFile.startsWith("~/")) {
    return path.join(os.homedir(), identityFile.slice(2));
  }
  if (identityFile === "~") {
    return os.homedir();
  }
  return identityFile;
};

export const upsertSshConfigContents = (
  contents: string,
  host: string,
  identityFilePath: string,
  user = "git"
): string => {
  const { lines, blocks } = parseSshConfigContents(contents);
  const formattedIdentity = formatIdentityFilePath(identityFilePath);
  const block = blocks.find((item) => item.hosts.includes(host));
  const blockLines = [
    `Host ${host}`,
    `  HostName ${host}`,
    `  User ${user}`,
    `  IdentityFile ${formattedIdentity}`,
    `  IdentitiesOnly yes`,
  ];

  if (!block) {
    const trimmedLines = lines.length === 1 && lines[0] === "" ? [] : lines;
    const needsBlankLine = trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].trim() !== "";
    const nextLines = [...trimmedLines, ...(needsBlankLine ? [""] : []), ...blockLines, ""];
    return nextLines.join("\n");
  }

  const keyRegexes = [
    /^\s*HostName\s+/i,
    /^\s*User\s+/i,
    /^\s*IdentityFile\s+/i,
    /^\s*IdentitiesOnly\s+/i,
  ];
  const hostLine = lines[block.start];
  const innerLines = lines.slice(block.start + 1, block.end);
  const otherLines = innerLines.filter((line) => !keyRegexes.some((regex) => regex.test(line)));
  const newBlockLines = [hostLine, ...blockLines.slice(1), ...otherLines];

  const updatedLines = [...lines.slice(0, block.start), ...newBlockLines, ...lines.slice(block.end)];
  return updatedLines.join("\n");
};

export const readSshConfigContents = (): string => {
  const configPath = getSshConfigPath();
  if (!fs.existsSync(configPath)) {
    return "";
  }
  return fs.readFileSync(configPath, "utf-8");
};

export const writeSshConfigContents = (contents: string): void => {
  const sshDir = path.join(os.homedir(), ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });
  fs.writeFileSync(getSshConfigPath(), contents, "utf-8");
};

export const getIdentityFileForHost = (host: string): string | null => {
  return getIdentityFileForHostFromContents(readSshConfigContents(), host);
};

export const upsertSshConfigHost = (host: string, identityFilePath: string, user = "git"): void => {
  const contents = readSshConfigContents();
  const nextContents = upsertSshConfigContents(contents, host, identityFilePath, user);
  writeSshConfigContents(nextContents);
};

export const isHostInKnownHostsFromContents = (contents: string, host: string): boolean => {
  if (!contents.trim()) {
    return false;
  }
  const lines = contents.split(/\r?\n/);
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return false;
    }
    const firstField = trimmed.split(" ")[0];
    const hosts = firstField.split(",");
    return hosts.includes(host) || hosts.includes(`[${host}]:22`);
  });
};

export const isHostInKnownHosts = async (host: string): Promise<boolean> => {
  const knownHostsPath = getKnownHostsPath();
  if (!fs.existsSync(knownHostsPath)) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync("ssh-keygen", ["-F", host, "-f", knownHostsPath]);
    if (stdout && stdout.trim()) {
      return true;
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
  }

  const contents = fs.readFileSync(knownHostsPath, "utf-8");
  return isHostInKnownHostsFromContents(contents, host);
};

export const addHostToKnownHosts = async (
  host: string,
  options?: { verbose?: boolean; logger?: (message: string) => void }
): Promise<boolean> => {
  const sshDir = path.join(os.homedir(), ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });
  const knownHostsPath = getKnownHostsPath();
  if (options?.verbose) {
    (options.logger ?? console.log)(`Executando: ssh-keyscan -T 5 -t rsa,ecdsa,ed25519 ${host}`);
  }
  try {
    const { stdout } = await execFileAsync("ssh-keyscan", ["-T", "5", "-t", "rsa,ecdsa,ed25519", host]);
    if (!stdout || !stdout.trim()) {
      if (options?.verbose) {
        (options.logger ?? console.log)("ssh-keyscan não retornou saída.");
      }
      return false;
    }
    fs.appendFileSync(knownHostsPath, stdout, "utf-8");
    if (options?.verbose) {
      (options.logger ?? console.log)(`known_hosts atualizado em ${knownHostsPath}`);
    }
    return true;
  } catch (error) {
    if (options?.verbose) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      (options.logger ?? console.log)(`Falha no ssh-keyscan: ${message}`);
    }
    return false;
  }
};

export const generatePajeKeyPair = async (passphrase?: string, keyLabel?: string): Promise<SshKeyInfo> => {
  const sshDir = path.join(os.homedir(), ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });

  const safeLabel = (keyLabel ?? "paje").replace(/[^a-zA-Z0-9-_]/g, "_");
  const privateKeyPath = path.join(sshDir, safeLabel);
  const publicKeyPath = `${privateKeyPath}.pub`;
  const comment = safeLabel;
  const args = ["-t", "ed25519", "-f", privateKeyPath, "-N", passphrase ?? "", "-C", comment];

  await execFileAsync("ssh-keygen", args);

  return {
    privateKeyPath,
    publicKeyPath,
    publicKey: readPublicKey(publicKeyPath),
  };
};

export const registerKeyInGitLab = async (
  api: { createSshKey: (title: string, key: string) => Promise<{ id: number }> },
  title: string,
  publicKey: string
): Promise<void> => {
  await api.createSshKey(title, publicKey);
};

// Computed per call (not a frozen module-load constant): os.homedir() must
// reflect the current HOME at the time of the call, not whatever it was when
// this module first loaded — otherwise HOME changes within the same process
// (tests, or any long-lived host like the VSCode extension) would be ignored.
const resolveDefaultEnvPaths = (): string[] => [
  resolveDefaultEnvYamlPath(),
  "env-test.yaml",
  "env.test",
  ".env.test",
  "config.local.env",
  ".env.local",
  ".env",
];
const DEFAULT_JSON_PATH = "config.local.json";
const DEFAULT_BASE_URL = "https://git.tse.jus.br";
const DEFAULT_KEY_TITLE = "paje";
const DEFAULT_USAGE_TYPE: "auth_and_signing" = "auth_and_signing";
const DEFAULT_TOKEN_SCOPES = ["read_repository", "read_api", "read_virtual_registry", "self_rotate"];
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";

class SshManagerAuthError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SshManagerAuthError";
    this.status = status;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const resolveTokenExpiresAt = (expiresAt?: string): string => {
  if (expiresAt && expiresAt.trim()) {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Data de expiração do token inválida.");
    }
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);
    if (parsed > maxDate) {
      throw new Error("Data de expiração do token não pode exceder 1 ano.");
    }
    return formatDate(parsed);
  }
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() + 1);
  return formatDate(defaultDate);
};

const buildTokenDescription = (credentials: GitCredentials): string =>
  `Token usado pelo ${credentials.username} na estação ${os.hostname()}`;

export type EnvConfigValue = string | number | boolean | string[];

export type EnvConfig = Record<string, EnvConfigValue>;

const stripInlineComment = (line: string): string => {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      return line.slice(0, index);
    }
  }
  return line;
};

const parseYamlValue = (rawValue: string): EnvConfigValue | undefined => {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "~" || trimmed.toLowerCase() === "null") {
    return undefined;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^['"]|['"]$/g, ""));
  }
  const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
  if (unquoted === "true") {
    return true;
  }
  if (unquoted === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) {
    return Number(unquoted);
  }
  return unquoted;
};

const normalizeEnvKey = (key: string): string =>
  key.includes("-") ? key.replace(/-([a-zA-Z0-9])/g, (_, char) => char.toUpperCase()) : key;

const parseYamlContent = (contents: string): EnvConfig => {
  const result: EnvConfig = {};
  contents
    .split(/\r?\n/)
    .map((line) => stripInlineComment(line))
    .map((line) => line.trim())
    .filter((line) => line)
    .forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return;
      }
      const rawKey = line.slice(0, separatorIndex).trim();
      const key = normalizeEnvKey(rawKey);
      if (!key) {
        return;
      }
      const rawValue = line.slice(separatorIndex + 1);
      const parsed = parseYamlValue(rawValue);
      if (parsed === undefined) {
        return;
      }
      result[key] = parsed;
    });
  return result;
};

const parseEnvContent = (contents: string): Record<string, string> => {
  const result: Record<string, string> = {};
  contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const [rawKey, ...rawValueParts] = line.split("=");
      if (!rawKey || rawValueParts.length === 0) {
        return;
      }
      const key = normalizeEnvKey(rawKey.trim());
      const rawValue = rawValueParts.join("=").trim();
      const value = rawValue.replace(/^['\"]|['\"]$/g, "");
      result[key] = value;
    });
  return result;
};

const isYamlFile = (filePath: string): boolean => filePath.endsWith(".yaml") || filePath.endsWith(".yml");

const parseEnvFile = (filePath: string, contents: string): Record<string, string> => {
  const parsed = isYamlFile(filePath) ? parseYamlContent(contents) : parseEnvContent(contents);
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : String(value),
    ])
  );
};

const readFileIfExists = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
};

export const loadGitCredentials = (options: {
  envFilePaths?: string[];
  jsonFilePath?: string;
  allowProcessEnv?: boolean;
} = {}): GitCredentials => {
  if (options.allowProcessEnv && process.env.GIT_USER && process.env.GIT_PASS) {
    return {
      username: process.env.GIT_USER,
      password: process.env.GIT_PASS,
      source: "process.env",
    };
  }

  const jsonPath = options.jsonFilePath ?? DEFAULT_JSON_PATH;
  const jsonContents = readFileIfExists(jsonPath);
  if (jsonContents) {
    const parsed = JSON.parse(jsonContents) as Record<string, unknown>;
    const username = String(parsed.username ?? parsed.GIT_USER ?? parsed.gitUser ?? "");
    const password = String(parsed.password ?? parsed.GIT_PASS ?? parsed.gitPass ?? "");
    if (username && password) {
      return { username, password, source: jsonPath };
    }
  }

  const envPaths = options.envFilePaths ?? resolveDefaultEnvPaths();
  for (const envPath of envPaths) {
    const contents = readFileIfExists(envPath);
    if (!contents) {
      continue;
    }
    const data = parseEnvFile(envPath, contents);
    const username = data.username ?? data.GIT_USER;
    const password = data.password ?? data.GIT_PASS;
    if (username && password) {
      return { username, password, source: envPath };
    }
  }

  throw new Error(
    "Credenciais GitLab não encontradas. Informe GIT_USER e GIT_PASS em ~/.paje/env.yaml."
  );
};

export const loadEnvConfig = (options: { envFile?: string } = {}): EnvConfig => {
  const defaultPath = resolveDefaultEnvYamlPath();
  const targetPath = options.envFile ?? defaultPath;

  if (targetPath === defaultPath) {
    // First run: materialize ~/.paje/env.yaml from the commented template
    // instead of leaving the user with nothing. Scoped to the default path —
    // every presentation layer (CLI, TUI, VSCode extension) resolves to this
    // exact path unless --env-file overrides it, so this single call site
    // covers all of them. An explicit --env-file pointing elsewhere is left
    // untouched (missing custom paths still resolve to {}, as tests expect).
    ensureEnvYamlExists(targetPath);
  }

  const contents = readFileIfExists(targetPath);
  if (!contents) {
    return {};
  }
  return parseYamlContent(contents);
};

const normalizeKeyLabel = (keyLabel: string): string => keyLabel.replace(/[^a-zA-Z0-9-_]/g, "_");

const getKeyPaths = (keyLabel: string): { privateKeyPath: string; publicKeyPath: string } => {
  const sshDir = path.join(os.homedir(), ".ssh");
  const safeLabel = normalizeKeyLabel(keyLabel);
  const privateKeyPath = path.join(sshDir, safeLabel);
  return { privateKeyPath, publicKeyPath: `${privateKeyPath}.pub` };
};

const ensurePublicKeyFromPrivate = async (privateKeyPath: string, publicKeyPath: string): Promise<void> => {
  const { stdout } = await execFileAsync("ssh-keygen", ["-y", "-f", privateKeyPath]);
  const normalized = stdout.trim();
  if (!normalized) {
    throw new Error("ssh-keygen não retornou a chave pública.");
  }
  fs.writeFileSync(publicKeyPath, `${normalized}\n`, "utf-8");
};

export const ensurePajeKeyPair = async (options: {
  keyLabel?: string;
  passphrase?: string;
  overwrite?: boolean;
  logger?: SshManagerLogger;
} = {}): Promise<SshKeyInfo> => {
  const keyLabel = options.keyLabel ?? DEFAULT_KEY_TITLE;
  const logger = options.logger;
  const { privateKeyPath, publicKeyPath } = getKeyPaths(keyLabel);
  const overwrite = options.overwrite ?? false;

  if (!overwrite && fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    logger?.(`Chave SSH ${keyLabel} já existe. Reutilizando a chave existente.`);
    return {
      privateKeyPath,
      publicKeyPath,
      publicKey: readPublicKey(publicKeyPath),
    };
  }

  if (!overwrite && fs.existsSync(privateKeyPath) && !fs.existsSync(publicKeyPath)) {
    logger?.("Chave pública ausente, regenerando a partir da chave privada existente.");
    await ensurePublicKeyFromPrivate(privateKeyPath, publicKeyPath);
    return {
      privateKeyPath,
      publicKeyPath,
      publicKey: readPublicKey(publicKeyPath),
    };
  }

  if (overwrite && (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath))) {
    // Unlike POSIX rename(), Windows' fs.renameSync throws if the
    // destination already exists (e.g. overwriting the same key label a
    // second time leaves a .bak from the first overwrite) — remove any
    // stale backup first so this works the same on both platforms.
    if (fs.existsSync(privateKeyPath)) {
      const backupPath = `${privateKeyPath}.bak`;
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath);
      }
      fs.renameSync(privateKeyPath, backupPath);
    }
    if (fs.existsSync(publicKeyPath)) {
      const backupPath = `${publicKeyPath}.pub.bak`;
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath);
      }
      fs.renameSync(publicKeyPath, backupPath);
    }
    logger?.(`Chave existente renomeada para ${privateKeyPath}.bak (e .pub.bak).`);
  }

  logger?.("Gerando novo par de chaves SSH Ed25519.");
  return generatePajeKeyPair(options.passphrase, keyLabel);
};

const extractAuthenticityToken = (html: string): string | null => {
  const $ = cheerio.load(html);
  return $("input[name='authenticity_token']").attr("value") ?? $("meta[name='csrf-token']").attr("content") ?? null;
};

const extractCsrfToken = (html: string): string | null => {
  const $ = cheerio.load(html);
  return $("meta[name='csrf-token']").attr("content") ?? null;
};

const extractPersonalAccessToken = (html: string): string | null => {
  const $ = cheerio.load(html);
  const inputValue =
    $("#created-personal-access-token").attr("value") ??
    $("input#created-personal-access-token").attr("value") ??
    $("input[name='created_personal_access_token']").attr("value") ??
    $("input[name='personal_access_token']").attr("value");
  if (inputValue && inputValue.trim()) {
    return inputValue.trim();
  }
  const testIdText = $("[data-testid='created-personal-access-token']").text();
  if (testIdText && testIdText.trim()) {
    return testIdText.trim();
  }
  const codeText = $("code").first().text();
  if (codeText && codeText.trim().startsWith("glpat-")) {
    return codeText.trim();
  }
  return null;
};

const buildBrowserHeaders = (cookie?: string, referer?: string): Record<string, string> => ({
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": DEFAULT_USER_AGENT,
  ...(referer ? { Referer: referer } : {}),
  ...(cookie ? { Cookie: cookie } : {}),
});

const buildJsonHeaders = (cookie?: string, referer?: string, csrfToken?: string): Record<string, string> => ({
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Content-Type": "application/json",
  "User-Agent": DEFAULT_USER_AGENT,
  "X-Requested-With": "XMLHttpRequest",
  ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  ...(referer ? { Referer: referer } : {}),
  ...(cookie ? { Cookie: cookie } : {}),
});

const updateCookieJar = (jar: CookieJar, response: Response, url: string): void => {
  const setCookies = (response.headers as any).getSetCookie?.() as string[] | undefined;
  const fallback = response.headers.get("set-cookie");
  const cookieList = setCookies ?? (fallback ? [fallback] : []);
  cookieList.forEach((cookie) => jar.setCookieSync(cookie, url));
};

const fetchWithCookies = async (
  fetchImpl: typeof fetch,
  jar: CookieJar,
  url: string,
  init: RequestInit = {}
): Promise<Response> => {
  const cookieHeader = jar.getCookieStringSync(url);
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
  const response = await fetchImpl(url, { ...init, headers });
  updateCookieJar(jar, response, url);
  return response;
};

const validateKeyTitleInHtml = (html: string, title: string): boolean => {
  const $ = cheerio.load(html);
  const directValue = $("input[name='key[title]']").attr("value") ?? $("input#key_title").attr("value");
  if (directValue && directValue.trim() === title) {
    return true;
  }
  const bodyText = $("body").text();
  if (bodyText.includes(title)) {
    return true;
  }
  return html.includes(title);
};

const extractKeyIdFromHtml = (html: string, title: string): number => {
  const $ = cheerio.load(html);
  let keyId = 0;
  const titleCandidates = $(":contains('" + title + "')");
  titleCandidates.each((_, element) => {
    if (keyId) {
      return;
    }
    const nearestLink = $(element).closest("a[href*='/ssh_keys/']").attr("href");
    const href = nearestLink ?? $(element).find("a[href*='/ssh_keys/']").attr("href");
    const match = href?.match(/\/ssh_keys\/(\d+)/);
    if (match) {
      keyId = Number(match[1]);
    }
  });
  if (keyId) {
    return keyId;
  }
  const anyMatch = html.match(/\/ssh_keys\/(\d+)/);
  return anyMatch ? Number(anyMatch[1]) : 0;
};

const runWebFlowOnce = async (options: {
  baseUrl: string;
  credentials: GitCredentials;
  title: string;
  usageType: string;
  publicKey: string;
  fetchImpl: typeof fetch;
  logger?: SshManagerLogger;
}): Promise<number> => {
  const { baseUrl, credentials, title, usageType, publicKey, fetchImpl, logger } = options;
  const jar = new CookieJar();

  const signInUrl = `${baseUrl}/users/sign_in`;
  logger?.(`HTTP GET ${signInUrl}`);
  const signInResponse = await fetchWithCookies(fetchImpl, jar, signInUrl, {
    headers: buildBrowserHeaders(),
  });
  if (signInResponse.status === 401) {
    throw new SshManagerAuthError("Não autorizado na página de login.", signInResponse.status);
  }
  const signInHtml = await signInResponse.text();
  const signInToken = extractAuthenticityToken(signInHtml);
  if (!signInToken) {
    throw new SshManagerAuthError("Token de autenticidade ausente no login.");
  }

  const loginUrl = `${baseUrl}/users/auth/ldapmain/callback`;
  const loginForm = new URLSearchParams();
  loginForm.set("username", credentials.username);
  loginForm.set("password", credentials.password);
  loginForm.set("remember_me", "0");
  loginForm.set("authenticity_token", signInToken);

  logger?.(`HTTP POST ${loginUrl}`);
  const loginResponse = await fetchWithCookies(fetchImpl, jar, loginUrl, {
    method: "POST",
    headers: {
      ...buildBrowserHeaders(jar.getCookieStringSync(loginUrl), signInUrl),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: loginForm.toString(),
    redirect: "manual",
  });
  if (loginResponse.status === 401) {
    throw new SshManagerAuthError("Credenciais inválidas no LDAP.", loginResponse.status);
  }

  const keysUrl = `${baseUrl}/-/user_settings/ssh_keys`;
  logger?.(`HTTP GET ${keysUrl}`);
  const keysResponse = await fetchWithCookies(fetchImpl, jar, keysUrl, {
    headers: buildBrowserHeaders(jar.getCookieStringSync(keysUrl), signInUrl),
  });
  if (keysResponse.status === 401) {
    throw new SshManagerAuthError("Sessão expirada ao acessar chaves SSH.", keysResponse.status);
  }
  const keysHtml = await keysResponse.text();
  const webAuthenticityToken = extractAuthenticityToken(keysHtml);
  const csrfToken = extractCsrfToken(keysHtml);
  const tokenForForm = webAuthenticityToken ?? csrfToken;
  if (!tokenForForm) {
    throw new SshManagerAuthError("Token de sessão ausente na página de chaves SSH.");
  }

  if (validateKeyTitleInHtml(keysHtml, title)) {
    const existingId = extractKeyIdFromHtml(keysHtml, title);
    logger?.(`Chave SSH ${title} já está cadastrada no GitLab. Reutilizando.`);
    return existingId;
  }

  const registerForm = new URLSearchParams();
  registerForm.set("authenticity_token", tokenForForm);
  registerForm.set("key[key]", publicKey);
  registerForm.set("key[title]", title);
  registerForm.set("key[usage_type]", usageType);

  logger?.(`HTTP POST ${keysUrl}`);
  const registerResponse = await fetchWithCookies(fetchImpl, jar, keysUrl, {
    method: "POST",
    headers: {
      ...buildBrowserHeaders(jar.getCookieStringSync(keysUrl), keysUrl),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: registerForm.toString(),
    redirect: "manual",
  });

  if (registerResponse.status === 401) {
    throw new SshManagerAuthError("Não autorizado ao cadastrar chave SSH.", registerResponse.status);
  }
  if (registerResponse.status >= 400) {
    const text = await registerResponse.text();
    throw new Error(`Falha ao cadastrar chave SSH (${registerResponse.status}): ${text}`);
  }

  const location = registerResponse.headers.get("location") ?? registerResponse.headers.get("Location") ?? "";
  let idMatch = location.match(/\/ssh_keys\/(\d+)/);
  let keyId = idMatch ? Number(idMatch[1]) : 0;
  if (!keyId) {
    const responseText = await registerResponse.text();
    idMatch = responseText.match(/\/ssh_keys\/(\d+)/);
    keyId = idMatch ? Number(idMatch[1]) : 0;
  }
  let validated = false;
  let validateUrl = "";
  if (keyId) {
    validateUrl = `${baseUrl}/-/user_settings/ssh_keys/${keyId}`;
    logger?.(`HTTP GET ${validateUrl}`);
    const validateResponse = await fetchWithCookies(fetchImpl, jar, validateUrl, {
      headers: buildBrowserHeaders(jar.getCookieStringSync(validateUrl), keysUrl),
    });
    if (validateResponse.status === 401) {
      throw new SshManagerAuthError("Sessão inválida ao validar chave SSH.", validateResponse.status);
    }
    const validateHtml = await validateResponse.text();
    validated = validateKeyTitleInHtml(validateHtml, title);
  }

  if (!validated) {
    const refreshKeysResponse = await fetchWithCookies(fetchImpl, jar, keysUrl, {
      headers: buildBrowserHeaders(jar.getCookieStringSync(keysUrl), keysUrl),
    });
    const refreshHtml = await refreshKeysResponse.text();
    if (!keyId) {
      keyId = extractKeyIdFromHtml(refreshHtml, title);
    }
    validated = validateKeyTitleInHtml(refreshHtml, title);
  }

  if (!validated) {
    throw new SshManagerAuthError(`Validação falhou: chave ${title} não encontrada.`);
  }

  return keyId || 0;
};

const runTokenWebFlowOnce = async (options: {
  baseUrl: string;
  credentials: GitCredentials;
  name: string;
  description: string;
  scopes: string[];
  expiresAt?: string;
  fetchImpl: typeof fetch;
  logger?: SshManagerLogger;
}): Promise<string> => {
  const { baseUrl, credentials, name, description, scopes, expiresAt, fetchImpl, logger } = options;
  const jar = new CookieJar();

  const signInUrl = `${baseUrl}/users/sign_in`;
  logger?.(`HTTP GET ${signInUrl}`);
  const signInResponse = await fetchWithCookies(fetchImpl, jar, signInUrl, {
    headers: buildBrowserHeaders(),
  });
  if (signInResponse.status === 401) {
    throw new SshManagerAuthError("Não autorizado na página de login.", signInResponse.status);
  }
  const signInHtml = await signInResponse.text();
  const signInToken = extractAuthenticityToken(signInHtml);
  if (!signInToken) {
    throw new SshManagerAuthError("Token de autenticidade ausente no login.");
  }

  const loginUrl = `${baseUrl}/users/auth/ldapmain/callback`;
  const loginForm = new URLSearchParams();
  loginForm.set("username", credentials.username);
  loginForm.set("password", credentials.password);
  loginForm.set("remember_me", "0");
  loginForm.set("authenticity_token", signInToken);

  logger?.(`HTTP POST ${loginUrl}`);
  const loginResponse = await fetchWithCookies(fetchImpl, jar, loginUrl, {
    method: "POST",
    headers: {
      ...buildBrowserHeaders(jar.getCookieStringSync(loginUrl), signInUrl),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: loginForm.toString(),
    redirect: "manual",
  });
  if (loginResponse.status === 401) {
    throw new SshManagerAuthError("Credenciais inválidas no LDAP.", loginResponse.status);
  }

  const tokenUrl = `${baseUrl}/-/user_settings/personal_access_tokens`;
  logger?.(`HTTP GET ${tokenUrl}`);
  const tokenPageResponse = await fetchWithCookies(fetchImpl, jar, tokenUrl, {
    headers: buildBrowserHeaders(jar.getCookieStringSync(tokenUrl), signInUrl),
  });
  if (tokenPageResponse.status === 401) {
    throw new SshManagerAuthError("Sessão expirada ao acessar tokens pessoais.", tokenPageResponse.status);
  }
  const tokenPageHtml = await tokenPageResponse.text();
  const webAuthenticityToken = extractAuthenticityToken(tokenPageHtml);
  const csrfToken = extractCsrfToken(tokenPageHtml);
  const tokenForForm = webAuthenticityToken ?? csrfToken;
  if (!tokenForForm) {
    throw new SshManagerAuthError("Token de sessão ausente na página de tokens pessoais.");
  }

  const payload: Record<string, unknown> = {
    name,
    description,
    scopes,
  };
  if (expiresAt) {
    payload.expires_at = expiresAt;
  }

  logger?.(`HTTP POST ${tokenUrl}`);
  const registerResponse = await fetchWithCookies(fetchImpl, jar, tokenUrl, {
    method: "POST",
    headers: buildJsonHeaders(jar.getCookieStringSync(tokenUrl), tokenUrl, tokenForForm),
    body: JSON.stringify(payload),
  });

  if (registerResponse.status === 401) {
    throw new SshManagerAuthError("Não autorizado ao cadastrar token pessoal.", registerResponse.status);
  }
  if (registerResponse.status >= 400) {
    const text = await registerResponse.text();
    throw new Error(`Falha ao cadastrar token pessoal (${registerResponse.status}): ${text}`);
  }

  const responseText = await registerResponse.text();
  const contentType = registerResponse.headers.get("content-type") ?? "";
  let tokenValue: string | null = null;
  if (contentType.includes("application/json") || responseText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(responseText) as { token?: string };
      if (parsed?.token) {
        tokenValue = parsed.token;
      }
    } catch {
      tokenValue = null;
    }
  }
  if (!tokenValue) {
    tokenValue = extractPersonalAccessToken(responseText);
  }
  if (!tokenValue) {
    throw new SshManagerAuthError("Token pessoal não encontrado na resposta do GitLab.");
  }

  return tokenValue;
};

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof SshManagerAuthError) {
    return true;
  }
  return false;
};

type PersonalAccessTokenInfo = {
  id?: number;
  name?: string;
  token?: string;
  expires_at?: string;
  scopes?: string[];
  active?: boolean;
};

const isTokenExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return false;
  }
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getTime() < Date.now();
};

export const validatePersonalAccessToken = async (options: {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
  logger?: SshManagerLogger;
}): Promise<{ valid: boolean; expiresAt?: string; scopes?: string[]; active?: boolean }> => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/api/v4/personal_access_tokens/self`;
  options.logger?.(`HTTP GET ${url}`);
  const response = await fetchImpl(url, {
    headers: {
      "PRIVATE-TOKEN": options.token,
    },
  });
  if (response.status === 401) {
    return { valid: false };
  }
  if (response.status >= 400) {
    throw new Error(`Falha ao validar token pessoal (${response.status}).`);
  }
  const data = (await response.json()) as PersonalAccessTokenInfo;
  const active = data.active ?? true;
  const expiresAt = data.expires_at;
  const expired = isTokenExpired(expiresAt);
  return {
    valid: active && !expired,
    expiresAt,
    scopes: data.scopes ?? [],
    active,
  };
};

export const rotatePersonalAccessToken = async (options: {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
  logger?: SshManagerLogger;
}): Promise<{ token: string; name: string; scopes: string[]; expiresAt?: string; id?: number }> => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/api/v4/personal_access_tokens/self/rotate`;
  options.logger?.(`HTTP POST ${url}`);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": options.token,
    },
  });
  if (response.status === 401) {
    throw new SshManagerAuthError("Token pessoal inválido para rotação.", response.status);
  }
  if (response.status >= 400) {
    const text = await response.text();
    throw new Error(`Falha ao rotacionar token pessoal (${response.status}): ${text}`);
  }
  const data = (await response.json()) as PersonalAccessTokenInfo;
  if (!data.token || !data.name) {
    throw new Error("Resposta de rotação não contém token.");
  }
  return {
    id: data.id,
    name: data.name,
    token: data.token,
    expiresAt: data.expires_at,
    scopes: data.scopes ?? [],
  };
};

export const ensureGitLabSshKey = async (options: EnsureGitLabSshKeyOptions = {}): Promise<{
  id: number;
  keyInfo: SshKeyInfo;
  credentialsSource: string;
}> => {
  const logger = options.logger ?? console.log;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const title = options.title ?? DEFAULT_KEY_TITLE;
  const usageType = options.usageType ?? DEFAULT_USAGE_TYPE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepFn = options.sleepFn ?? sleep;
  const maxAttempts = options.maxAttempts ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 4000;

  const credentials =
    options.credentials ??
    loadGitCredentials({
      envFilePaths: options.envFilePaths,
      jsonFilePath: options.jsonFilePath,
      allowProcessEnv: options.allowProcessEnv,
    });

  logger(`Credenciais carregadas de ${credentials.source}.`);

  const keyInfo = options.keyInfo ??
    (await ensurePajeKeyPair({ keyLabel: options.keyLabel ?? title, passphrase: options.passphrase, logger }));

  const sanitizedKey = sanitizePublicKey(keyInfo.publicKey);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logger(`Tentativa ${attempt}/${maxAttempts} para registrar chave SSH no GitLab.`);
    try {
      const keyId = await runWebFlowOnce({
        baseUrl,
        credentials,
        title,
        usageType,
        publicKey: sanitizedKey,
        fetchImpl,
        logger,
      });
      logger(`Chave SSH validada com sucesso (ID ${keyId}).`);
      return { id: keyId, keyInfo, credentialsSource: credentials.source };
    } catch (error) {
      if (!isRetryableError(error) || attempt === maxAttempts) {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        logger(`Falha definitiva ao registrar chave SSH: ${message}`);
        throw error;
      }
      const message = error instanceof Error ? error.message : "erro desconhecido";
      logger(`Falha temporária (${message}). Aguardando ${retryDelayMs}ms para nova tentativa.`);
      await sleepFn(retryDelayMs);
    }
  }

  throw new Error("Falha inesperada no fluxo de registro de chave SSH.");
};

export const ensureGitLabPersonalAccessToken = async (
  options: EnsureGitLabTokenOptions
): Promise<{ token: string; name: string; scopes: string[] }> => {
  const logger = options.logger ?? console.log;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const scopes = options.scopes ?? DEFAULT_TOKEN_SCOPES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepFn = options.sleepFn ?? sleep;
  const maxAttempts = options.maxAttempts ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 4000;

  const credentials =
    options.credentials ??
    loadGitCredentials({
      envFilePaths: options.envFilePaths,
      jsonFilePath: options.jsonFilePath,
      allowProcessEnv: options.allowProcessEnv,
    });

  logger(`Credenciais carregadas de ${credentials.source}.`);
  const description = options.description ?? buildTokenDescription(credentials);
  const expiresAt = resolveTokenExpiresAt(options.expiresAt);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logger(`Tentativa ${attempt}/${maxAttempts} para gerar token pessoal no GitLab.`);
    try {
      const token = await runTokenWebFlowOnce({
        baseUrl,
        credentials,
        name: options.name,
        description,
        scopes,
        expiresAt,
        fetchImpl,
        logger,
      });
      logger(`Token pessoal gerado com sucesso (${options.name}).`);
      return { token, name: options.name, scopes };
    } catch (error) {
      if (!isRetryableError(error) || attempt === maxAttempts) {
        const message = error instanceof Error ? error.message : "erro desconhecido";
        logger(`Falha definitiva ao gerar token pessoal: ${message}`);
        throw error;
      }
      const message = error instanceof Error ? error.message : "erro desconhecido";
      logger(`Falha temporária (${message}). Aguardando ${retryDelayMs}ms para nova tentativa.`);
      await sleepFn(retryDelayMs);
    }
  }

  throw new Error("Falha inesperada no fluxo de geração de token pessoal.");
};
