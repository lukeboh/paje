import { loadEnvConfig } from "../sshManager.js";
import { resolveEnvFileFromCli } from "./envResolver.js";

// Variáveis de ambiente consultadas para o idioma, em ordem de prioridade.
// Espelha a lista lida em `src/i18n/index.ts` (`getEnvLocale`).
const LOCALE_ENV_VARS = ["PAJE_LOCALE", "LC_ALL", "LC_MESSAGES", "LANG"] as const;

export type ResolveLocaleOptions = {
  /** Valor explícito de `--locale` (CLI). Tem prioridade máxima. */
  cliLocale?: string;
  /** Caminho de `--env-file`; quando ausente usa `~/.paje/env.yaml`. */
  envFile?: string;
};

/**
 * Resolve o idioma da interface seguindo a mesma ordem de prioridade dos demais
 * parâmetros do PAJÉ (ver README — "Ordem de prioridade para resolução de
 * parâmetros"):
 *
 *   1. Argumento CLI `--locale`
 *   2. Variáveis de ambiente (`PAJE_LOCALE`, `LC_ALL`, `LC_MESSAGES`, `LANG`)
 *   3. Chave `locale` do `env.yaml` (`~/.paje/env.yaml` ou `--env-file`)
 *
 * Retorna `undefined` quando nenhuma fonte define um valor, deixando a camada
 * i18n (`setLocale`) cair no seu próprio `DEFAULT_LOCALE`. O valor devolvido não
 * é normalizado aqui — a normalização (`pt-BR` → `pt_BR`, etc.) é feita por
 * `normalizeLocale` no i18n.
 */
export const resolveLocale = (options: ResolveLocaleOptions = {}): string | undefined => {
  const cli = options.cliLocale?.trim();
  if (cli) {
    return cli;
  }

  for (const name of LOCALE_ENV_VARS) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  try {
    const envConfig = loadEnvConfig({ envFile: resolveEnvFileFromCli(options.envFile) });
    const fromYaml = envConfig.locale;
    if (typeof fromYaml === "string" && fromYaml.trim()) {
      return fromYaml.trim();
    }
  } catch {
    // env.yaml ausente ou ilegível — mantém o fallback do i18n.
  }

  return undefined;
};
