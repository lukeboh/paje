import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Funcionalidade coberta: criação automática do ~/.paje/env.yaml na primeira
// execução, a partir do template com comentários (env-template.yaml).
//
// resolveDefaultEnvYamlPath()/loadEnvConfig() computam os.homedir() a cada
// chamada (não mais uma constante travada na carga do módulo) — por isso
// HOME é trocado ANTES do primeiro import de sshManager.js/persistence.js
// neste arquivo de teste, garantindo isolamento real por HOME temporário
// mesmo quando outros arquivos de teste já importaram esses módulos antes
// (no mesmo processo do runner).

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-env-first-run-"));
const originalHome = process.env.HOME;
process.env.HOME = tmpHome;

try {
  const { loadEnvConfig } = await import("../src/modules/git/sshManager.js");
  const { ENV_TEMPLATE_CONTENT } = await import("../src/modules/git/envTemplate.js");

  const defaultEnvPath = path.join(tmpHome, ".paje", "env.yaml");
  assert.ok(!fs.existsSync(defaultEnvPath), "Pré-condição: env.yaml não deve existir ainda");

  // 1. Primeira chamada ao caminho padrão cria o arquivo com o template
  //    completo (todos os comentários), mesmo sem nenhuma chave usada ainda.
  const configFirstCall = loadEnvConfig();
  assert.ok(fs.existsSync(defaultEnvPath), "loadEnvConfig() sem envFile deve criar ~/.paje/env.yaml");
  const createdContent = fs.readFileSync(defaultEnvPath, "utf-8");
  assert.equal(createdContent, ENV_TEMPLATE_CONTENT, "Conteúdo criado deve ser idêntico ao template");
  assert.equal(configFirstCall.baseDir, "repos", "Valores do template devem ser lidos corretamente após a criação");
  assert.equal(configFirstCall.parallels, "auto", "Template atualizado deve trazer parallels: auto");

  // 2. Chamada subsequente não deve sobrescrever edições do usuário
  fs.writeFileSync(defaultEnvPath, 'base-dir: "editado"\n# comentario do usuario\n');
  const configSecondCall = loadEnvConfig();
  assert.equal(configSecondCall.baseDir, "editado", "Segunda chamada não pode sobrescrever o arquivo do usuário");
  const contentAfterSecondCall = fs.readFileSync(defaultEnvPath, "utf-8");
  assert.ok(
    contentAfterSecondCall.includes("# comentario do usuario"),
    "Edição do usuário deve permanecer intacta após nova chamada"
  );

  // 3. --env-file explícito apontando para caminho inexistente NÃO aciona
  //    a criação automática (escopo restrito ao caminho padrão)
  const customPath = path.join(tmpHome, "custom-explicito.yaml");
  const configCustom = loadEnvConfig({ envFile: customPath });
  assert.deepEqual(configCustom, {}, "Caminho customizado ausente deve retornar config vazia, como antes");
  assert.ok(!fs.existsSync(customPath), "Caminho customizado ausente NÃO deve ser criado automaticamente");
} finally {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log("env_yaml_first_run_test: OK");
