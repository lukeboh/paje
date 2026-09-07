import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Funcionalidade coberta: `resolveLocale()` (core/localeResolver.ts) — a
// resolução do idioma da interface seguindo a ordem de prioridade padrão do
// PAJÉ: --locale (CLI) > variáveis de ambiente > chave `locale` do env.yaml.
//
// Regressão alvo: antes desta correção, o `locale:` do ~/.paje/env.yaml era
// lido por loadEnvConfig() mas nunca chegava a setLocale(), então a TUI ficava
// sempre em inglês mesmo com `locale: "pt_BR"` configurado.
//
// HOME/USERPROFILE são trocados ANTES do primeiro import de sshManager.js
// para isolar o teste num diretório temporário, mesmo que outro arquivo de
// teste já tenha importado o módulo antes (mesmo processo do runner).

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-locale-resolver-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const LOCALE_ENV_VARS = ["PAJE_LOCALE", "LC_ALL", "LC_MESSAGES", "LANG"] as const;
const originalLocaleEnv = new Map(LOCALE_ENV_VARS.map((name) => [name, process.env[name]]));

const clearLocaleEnv = (): void => {
  for (const name of LOCALE_ENV_VARS) {
    delete process.env[name];
  }
};

process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
clearLocaleEnv();

try {
  const { resolveLocale } = await import("../src/modules/git/core/localeResolver.js");
  const { setLocale, getLocale } = await import("../src/i18n/index.js");

  const defaultEnvPath = path.join(tmpHome, ".paje", "env.yaml");
  const writeEnvYaml = (localeLine: string): void => {
    fs.mkdirSync(path.dirname(defaultEnvPath), { recursive: true });
    fs.writeFileSync(defaultEnvPath, `${localeLine}\nbase-dir: "repos"\n`);
  };

  // 1. env.yaml com locale: "pt_BR" e nenhuma outra fonte → devolve "pt_BR"
  writeEnvYaml('locale: "pt_BR"');
  assert.equal(resolveLocale(), "pt_BR", "env.yaml locale deve ser usado quando não há CLI nem env var");

  // 2. --locale (CLI) tem prioridade sobre o env.yaml
  assert.equal(
    resolveLocale({ cliLocale: "en_US" }),
    "en_US",
    "cliLocale deve vencer o env.yaml"
  );

  // 3. Variável de ambiente vence o env.yaml, mas perde para a CLI
  process.env.LANG = "en_US.UTF-8";
  assert.equal(resolveLocale(), "en_US.UTF-8", "variável de ambiente deve vencer o env.yaml");
  assert.equal(
    resolveLocale({ cliLocale: "pt_BR" }),
    "pt_BR",
    "cliLocale deve vencer a variável de ambiente"
  );
  clearLocaleEnv();

  // 4. locale vazio no env.yaml e nenhuma outra fonte → undefined (i18n cai no default)
  writeEnvYaml('locale: ""');
  assert.equal(resolveLocale(), undefined, "locale vazio no env.yaml não deve forçar um idioma");

  // 5. cliLocale só com espaços é ignorado, caindo no env.yaml
  writeEnvYaml('locale: "pt_BR"');
  assert.equal(
    resolveLocale({ cliLocale: "   " }),
    "pt_BR",
    "cliLocale em branco deve ser ignorado"
  );

  // 6. --env-file explícito é respeitado
  const customPath = path.join(tmpHome, "custom-env.yaml");
  fs.writeFileSync(customPath, 'locale: "pt_BR"\n');
  assert.equal(
    resolveLocale({ envFile: customPath }),
    "pt_BR",
    "resolveLocale deve ler o caminho informado em envFile"
  );

  // 7. Integração com o i18n: setLocale(resolveLocale(...)) deixa a TUI em pt_BR
  writeEnvYaml('locale: "pt_BR"');
  setLocale(resolveLocale());
  assert.equal(getLocale(), "pt_BR", "setLocale deve aplicar o idioma vindo do env.yaml");
  setLocale("en_US");
} finally {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  for (const [name, value] of originalLocaleEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log("locale_resolver_test: OK");
