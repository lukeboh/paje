import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeEnvYamlUpdates } from "../src/modules/git/persistence.js";

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

// 3. Arquivo inexistente é criado
const fileC = path.join(tmpDir, "sub", "c.yaml");
writeEnvYamlUpdates({ baseDir: "nova" }, fileC);
const contentC = fs.readFileSync(fileC, "utf-8");
assert.ok(contentC.includes('base-dir: "nova"'), "Arquivo inexistente deve ser criado com a chave");

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

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("env_yaml_write_test: OK");
