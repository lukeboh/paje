import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureEnvYamlExists, writeEnvYamlUpdates } from "../src/modules/git/persistence.js";
import { ENV_TEMPLATE_CONTENT } from "../src/modules/git/envTemplate.js";

// 0. envTemplate.ts embute o mesmo conteúdo de env-template.yaml (raiz do
//    repositório) como constante — necessário porque o núcleo do PAJÉ roda em
//    contextos onde o caminho da raiz não é resolvível de forma confiável
//    (bundle da extensão VSCode via esbuild, `tsx` fora do diretório do
//    projeto). Este teste impede que os dois arquivos divirjam em silêncio.
const rootTemplatePath = path.resolve(import.meta.dirname, "..", "env-template.yaml");
const rootTemplateContent = fs.readFileSync(rootTemplatePath, "utf-8");
assert.equal(
  ENV_TEMPLATE_CONTENT,
  rootTemplateContent,
  "envTemplate.ts (ENV_TEMPLATE_CONTENT) deve ser idêntico, byte a byte, a env-template.yaml na raiz do repositório"
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-env-write-"));

// 1. Atualiza chave existente preservando comentários e demais linhas
const fileA = path.join(tmpDir, "a.yaml");
fs.writeFileSync(
  fileA,
  [
    "# Parâmetros do PAJÉ",
    "# CLI sempre tem prioridade.",
    'base-dir: "repos"',
    "verbose: false",
    "retry-delay-ms: 4000",
    "",
  ].join("\n")
);
writeEnvYamlUpdates({ baseDir: "outra/pasta" }, fileA);
const contentA = fs.readFileSync(fileA, "utf-8");
assert.ok(contentA.includes("# Parâmetros do PAJÉ"), "Comentário de cabeçalho deve ser preservado");
assert.ok(contentA.includes('base-dir: "outra/pasta"'), "Chave existente deve ser atualizada em kebab-case");
assert.ok(contentA.includes("verbose: false"), "Chaves não alteradas devem permanecer");
assert.ok(contentA.includes("retry-delay-ms: 4000"), "Números devem permanecer sem aspas");

// 2. Booleanos e números novos são gravados sem aspas; strings com aspas
const fileB = path.join(tmpDir, "b.yaml");
fs.writeFileSync(fileB, 'base-dir: "repos"\n');
writeEnvYamlUpdates({ verbose: "true", maxAttempts: "3", filter: "grupo/**" }, fileB);
const contentB = fs.readFileSync(fileB, "utf-8");
assert.ok(contentB.includes("verbose: true"), "Booleano novo deve ser anexado sem aspas");
assert.ok(contentB.includes("max-attempts: 3"), "Número novo deve ser anexado sem aspas em kebab-case");
assert.ok(contentB.includes('filter: "grupo/**"'), "String nova deve ser anexada com aspas");

// 3. Arquivo inexistente é criado a partir do template — comentários não
//    podem ser suprimidos mesmo na primeira gravação
const fileC = path.join(tmpDir, "sub", "c.yaml");
writeEnvYamlUpdates({ baseDir: "nova" }, fileC);
const contentC = fs.readFileSync(fileC, "utf-8");
assert.ok(contentC.includes('base-dir: "nova"'), "Arquivo inexistente deve ser criado com a chave atualizada");
assert.ok(
  contentC.includes("# Parâmetros do PAJÉ"),
  "Primeira gravação em arquivo inexistente deve preservar os comentários do template"
);
assert.ok(
  contentC.includes("# Nome amigável do servidor"),
  "Comentários de outras chaves do template também devem estar presentes"
);
assert.equal(
  contentC.split("base-dir:").length - 1,
  1,
  "A chave do template deve ser atualizada in-place, não duplicada"
);

// 4. Linha comentada com ':' não deve ser confundida com chave real
const fileD = path.join(tmpDir, "d.yaml");
fs.writeFileSync(fileD, ['# exemplo: base-dir: "x"', 'base-dir: "repos"', ""].join("\n"));
writeEnvYamlUpdates({ baseDir: "z" }, fileD);
const contentD = fs.readFileSync(fileD, "utf-8");
assert.ok(contentD.includes('# exemplo: base-dir: "x"'), "Linha comentada deve permanecer intacta");
assert.ok(contentD.includes('base-dir: "z"'), "Somente a chave real deve ser atualizada");
assert.equal(
  contentD.split("base-dir:").length - 1,
  2,
  "Não deve duplicar a chave (1 no comentário + 1 real)"
);

// 5. Valor com aspas internas é escapado
const fileE = path.join(tmpDir, "e.yaml");
fs.writeFileSync(fileE, 'filter: ""\n');
writeEnvYamlUpdates({ filter: 'a"b' }, fileE);
const contentE = fs.readFileSync(fileE, "utf-8");
assert.ok(contentE.includes('filter: "a\\"b"'), "Aspas internas devem ser escapadas");

// 6. ensureEnvYamlExists cria o arquivo com o template completo na primeira
//    chamada e é idempotente (não sobrescreve edições do usuário depois)
const fileF = path.join(tmpDir, "f.yaml");
const createdFirstTime = ensureEnvYamlExists(fileF);
assert.equal(createdFirstTime, true, "Deve reportar que criou o arquivo na primeira chamada");
const contentF = fs.readFileSync(fileF, "utf-8");
assert.equal(contentF, ENV_TEMPLATE_CONTENT, "Conteúdo criado deve ser idêntico ao template (todos os comentários)");

fs.writeFileSync(fileF, "base-dir: \"editado-pelo-usuario\"\n");
const createdSecondTime = ensureEnvYamlExists(fileF);
assert.equal(createdSecondTime, false, "Não deve recriar o arquivo se ele já existe");
const contentFAfter = fs.readFileSync(fileF, "utf-8");
assert.equal(
  contentFAfter,
  "base-dir: \"editado-pelo-usuario\"\n",
  "Chamada subsequente não pode sobrescrever edições do usuário"
);

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("env_yaml_write_test: OK");
