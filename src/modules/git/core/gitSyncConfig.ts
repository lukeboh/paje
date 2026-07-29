import { loadEnvConfig } from "../sshManager.js";
import {
  resolveEnvBoolean,
  resolveEnvBooleanWithSource,
  resolveEnvFileFromCli,
  resolveEnvNumber,
  resolveEnvNumberWithSource,
  resolveEnvString,
  resolveEnvStringArray,
  resolveEnvStringArrayWithSource,
  resolveEnvStringWithSource,
  resolveHomePath,
  resolveHomePathWithSource,
  type EnvResolution,
} from "./envResolver.js";
import { buildParameter, type CommandParameters, type ParameterSource } from "./parameters.js";
import { t } from "../../../i18n/index.js";

export type GitSyncConfigInput = {
  baseDir?: string;
  verbose?: boolean;
  serverName?: string;
  baseUrl?: string;
  useBasicAuth?: boolean;
  username?: string;
  password?: string;
  userEmail?: string;
  keyLabel?: string;
  passphrase?: string;
  publicKeyPath?: string;
  envFile?: string;
  locale?: string;
  prepareLocalDirs?: boolean;
  noSummary?: boolean;
  noPublicRepos?: boolean;
  noArchivedRepos?: boolean;
  filter?: string;
  syncRepos?: string;
  dryRun?: boolean;
  parallels?: string;
};

export type GitSyncConfig = Required<Omit<GitSyncConfigInput, "envFile">> & { envFile?: string };

export type GitSyncResolved = {
  config: GitSyncConfig;
  parameters: CommandParameters;
};

const DEFAULT_BASE_DIR = "repos";

export const resolveGitSyncConfig = (
  cliOptions: GitSyncConfigInput,
  hasCliArg: (flag: string) => boolean,
  resolveCliBoolean: (flag: string) => boolean | undefined
): GitSyncResolved => {
  const hasEnvFileCli = hasCliArg("env-file");
  const resolvedEnvFile = resolveEnvFileFromCli(hasEnvFileCli ? cliOptions.envFile : undefined);
  const envFileResolution: EnvResolution = hasEnvFileCli && cliOptions.envFile?.trim()
    ? { value: resolvedEnvFile, source: "cli" }
    : { value: resolvedEnvFile, source: "default" };
  const envConfig = loadEnvConfig({ envFile: resolvedEnvFile });

  const resolveEnvOrCliString = (cliValue: string | undefined, key: string, flag: string): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvStringWithSource(resolvedCli, envConfig, key);
  };
  const resolveEnvOrCliBoolean = (
    cliValue: boolean | undefined,
    key: string,
    flag: string,
    resolvedFlag?: boolean,
    defaultValue?: boolean
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? (resolvedFlag ?? cliValue) : undefined;
    return resolveEnvBooleanWithSource(resolvedCli, envConfig, key, defaultValue);
  };
  const resolveEnvOrCliNumber = (
    cliValue: number | undefined,
    key: string,
    flag: string,
    defaultValue?: number
  ): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvNumberWithSource(resolvedCli, envConfig, key, defaultValue);
  };
  const resolveEnvOrCliArray = (cliValue: string | undefined, key: string, flag: string): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue : undefined;
    return resolveEnvStringArrayWithSource(resolvedCli, envConfig, key);
  };
  // Password is never read from env.yaml — only ever a one-off CLI flag or an
  // interactive prompt, so it can never end up persisted in a file.
  const resolveCliOnlyString = (cliValue: string | undefined, flag: string): EnvResolution => {
    const resolvedCli = hasCliArg(flag) ? cliValue?.trim() : undefined;
    return resolvedCli ? { value: resolvedCli, source: "cli" } : { value: undefined, source: "default" };
  };

  const cliNoSummary = resolveCliBoolean("no-summary");
  const cliPrepareLocalDirs = resolveCliBoolean("prepare-local-dirs");
  const cliNoPublicRepos = resolveCliBoolean("no-public-repos");
  const cliNoArchivedRepos = resolveCliBoolean("no-archived-repos");
  const cliVerbose = resolveCliBoolean("verbose");
  const cliDryRun = resolveCliBoolean("dry-run");

  const baseDirResolution = resolveEnvOrCliString(cliOptions.baseDir, "baseDir", "base-dir");
  const resolvedBaseDir = resolveHomePathWithSource(
    typeof baseDirResolution.value === "string" ? baseDirResolution.value : undefined,
    baseDirResolution.source
  );
  const serverNameResolution = resolveEnvOrCliString(cliOptions.serverName, "serverName", "server-name");
  const baseUrlResolution = resolveEnvOrCliString(cliOptions.baseUrl, "baseUrl", "base-url");
  const useBasicAuthResolution = resolveEnvOrCliBoolean(cliOptions.useBasicAuth, "useBasicAuth", "use-basic-auth", undefined, false);
  const usernameResolution = resolveEnvOrCliString(cliOptions.username, "username", "username");
  const userEmailResolution = resolveEnvOrCliString(cliOptions.userEmail, "userEmail", "user-email");
  const passwordResolution = resolveCliOnlyString(cliOptions.password, "password");
  const keyLabelResolution = resolveEnvOrCliString(cliOptions.keyLabel, "keyLabel", "key-label");
  const passphraseResolution = resolveEnvOrCliString(cliOptions.passphrase, "passphrase", "passphrase");
  const publicKeyPathResolution = resolveEnvOrCliString(cliOptions.publicKeyPath, "publicKeyPath", "public-key-path");
  const localeResolution = resolveEnvOrCliString(cliOptions.locale, "locale", "locale");
  const verboseResolution = resolveEnvOrCliBoolean(cliOptions.verbose, "verbose", "verbose", cliVerbose, false);
  const prepareLocalDirsResolution = resolveEnvOrCliBoolean(
    cliOptions.prepareLocalDirs,
    "prepareLocalDirs",
    "prepare-local-dirs",
    cliPrepareLocalDirs,
    false
  );
  const noSummaryResolution = resolveEnvOrCliBoolean(cliOptions.noSummary, "noSummary", "no-summary", cliNoSummary, false);
  const noPublicReposResolution = resolveEnvOrCliBoolean(
    cliOptions.noPublicRepos,
    "noPublicRepos",
    "no-public-repos",
    cliNoPublicRepos,
    false
  );
  const noArchivedReposResolution = resolveEnvOrCliBoolean(
    cliOptions.noArchivedRepos,
    "noArchivedRepos",
    "no-archived-repos",
    cliNoArchivedRepos,
    false
  );
  const filterResolution = resolveEnvOrCliString(cliOptions.filter, "filter", "filter");
  const syncReposResolution = resolveEnvOrCliArray(cliOptions.syncRepos, "syncRepos", "sync-repos");
  const dryRunResolution = resolveEnvOrCliBoolean(cliOptions.dryRun, "dryRun", "dry-run", cliDryRun, false);
  const parallelsResolution = resolveEnvOrCliString(cliOptions.parallels, "parallels", "parallels");

  const buildSource = (resolution: EnvResolution): ParameterSource => resolution.source;

  const config: GitSyncConfig = {
    ...cliOptions,
    baseDir: (resolvedBaseDir.value as string | undefined) ?? DEFAULT_BASE_DIR,
    serverName: (serverNameResolution.value as string | undefined) ?? "",
    baseUrl: (baseUrlResolution.value as string | undefined) ?? "",
    useBasicAuth: (useBasicAuthResolution.value as boolean | undefined) ?? false,
    username: (usernameResolution.value as string | undefined) ?? "",
    userEmail: (userEmailResolution.value as string | undefined) ?? "",
    password: (passwordResolution.value as string | undefined) ?? "",
    keyLabel: (keyLabelResolution.value as string | undefined) ?? "",
    passphrase: (passphraseResolution.value as string | undefined) ?? "",
    publicKeyPath: (publicKeyPathResolution.value as string | undefined) ?? "",
    locale: (localeResolution.value as string | undefined) ?? "",
    verbose: (verboseResolution.value as boolean | undefined) ?? false,
    prepareLocalDirs: (prepareLocalDirsResolution.value as boolean | undefined) ?? false,
    noSummary: (noSummaryResolution.value as boolean | undefined) ?? false,
    noPublicRepos: (noPublicReposResolution.value as boolean | undefined) ?? false,
    noArchivedRepos: (noArchivedReposResolution.value as boolean | undefined) ?? false,
    filter: (filterResolution.value as string | undefined) ?? "",
    syncRepos: (syncReposResolution.value as string | undefined) ?? "",
    dryRun: (dryRunResolution.value as boolean | undefined) ?? false,
    parallels: (parallelsResolution.value as string | undefined) ?? "",
    envFile: resolvedEnvFile,
  };

  const parameters: CommandParameters = {
    command: "git-sync",
    label: t("parameters.gitSync.label"),
    parameters: [
      buildParameter({
        name: "baseDir",
        description: t("parameters.gitSync.baseDir"),
        value: config.baseDir,
        source: buildSource(resolvedBaseDir),
      }),
      buildParameter({
        name: "locale",
        description: t("cli.command.gitSync.options.locale"),
        value: config.locale,
        source: buildSource(localeResolution),
      }),
      buildParameter({
        name: "serverName",
        description: t("parameters.gitSync.serverName"),
        value: config.serverName,
        source: buildSource(serverNameResolution),
      }),
      buildParameter({
        name: "baseUrl",
        description: t("parameters.gitSync.baseUrl"),
        value: config.baseUrl,
        source: buildSource(baseUrlResolution),
      }),
      buildParameter({
        name: "useBasicAuth",
        description: t("parameters.gitSync.useBasicAuth"),
        value: config.useBasicAuth,
        source: buildSource(useBasicAuthResolution),
      }),
      buildParameter({
        name: "username",
        description: t("parameters.gitSync.username"),
        value: config.username,
        source: buildSource(usernameResolution),
      }),
      buildParameter({
        name: "userEmail",
        description: t("parameters.gitSync.userEmail"),
        value: config.userEmail,
        source: buildSource(userEmailResolution),
      }),
      buildParameter({
        name: "password",
        description: t("parameters.gitSync.password"),
        value: config.password ? "********" : "",
        source: buildSource(passwordResolution),
      }),
      buildParameter({
        name: "keyLabel",
        description: t("parameters.gitSync.keyLabel"),
        value: config.keyLabel,
        source: buildSource(keyLabelResolution),
      }),
      buildParameter({
        name: "passphrase",
        description: t("parameters.gitSync.passphrase"),
        value: config.passphrase ? "********" : "",
        source: buildSource(passphraseResolution),
      }),
      buildParameter({
        name: "publicKeyPath",
        description: t("parameters.gitSync.publicKeyPath"),
        value: config.publicKeyPath,
        source: buildSource(publicKeyPathResolution),
      }),
      buildParameter({
        name: "verbose",
        description: t("parameters.gitSync.verbose"),
        value: config.verbose,
        source: buildSource(verboseResolution),
      }),
      buildParameter({
        name: "prepareLocalDirs",
        description: t("parameters.gitSync.prepareLocalDirs"),
        value: config.prepareLocalDirs,
        source: buildSource(prepareLocalDirsResolution),
      }),
      buildParameter({
        name: "noSummary",
        description: t("parameters.gitSync.noSummary"),
        value: config.noSummary,
        source: buildSource(noSummaryResolution),
      }),
      buildParameter({
        name: "noPublicRepos",
        description: t("parameters.gitSync.noPublicRepos"),
        value: config.noPublicRepos,
        source: buildSource(noPublicReposResolution),
      }),
      buildParameter({
        name: "noArchivedRepos",
        description: t("parameters.gitSync.noArchivedRepos"),
        value: config.noArchivedRepos,
        source: buildSource(noArchivedReposResolution),
      }),
      buildParameter({
        name: "filter",
        description: t("parameters.gitSync.filter"),
        value: config.filter,
        source: buildSource(filterResolution),
      }),
      buildParameter({
        name: "syncRepos",
        description: t("parameters.gitSync.syncRepos"),
        value: config.syncRepos,
        source: buildSource(syncReposResolution),
      }),
      buildParameter({
        name: "dryRun",
        description: t("parameters.gitSync.dryRun"),
        value: config.dryRun,
        source: buildSource(dryRunResolution),
      }),
      buildParameter({
        name: "parallels",
        description: t("parameters.gitSync.parallels"),
        value: config.parallels,
        source: buildSource(parallelsResolution),
      }),
      buildParameter({
        name: "envFile",
        description: t("parameters.gitSync.envFile"),
        value: resolvedEnvFile ?? "",
        source: envFileResolution.source === "cli" ? "resolved" : "default",
      }),
    ],
  };

  return { config, parameters };
};

export const resolveTokenScopes = (rawValue: string | undefined, envFile?: string): string[] => {
  const envConfig = loadEnvConfig({ envFile: resolveEnvFileFromCli(envFile) });
  const resolved = resolveEnvStringArray(rawValue, envConfig, "tokenScopes");
  if (!resolved) {
    return [];
  }
  return resolved
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};
