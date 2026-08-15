import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasGitDir } from "../src/modules/git/gitRepoScanner.js";

// Regressão: parallelSync.ts costumava ter sua PRÓPRIA cópia de hasGitDir
// que detectava um repositório já clonado chamando `execFile("test", ["-d",
// gitDir])` — "test" é um binário/builtin do shell POSIX que não existe no
// Windows. Essa chamada falhava silenciosamente lá (o erro era engolido por
// `.then(() => true, () => false)`), então TODO repositório era tratado como
// "não clonado ainda", mesmo os que já existiam — quebrando a detecção de
// status. parallelSync.ts agora reusa esta mesma implementação, que só usa
// fs.promises.stat (portátil em qualquer SO, sem shell nenhum). Este teste
// não depende de nenhum comando externo nem de barra "/" vs "\\" — só das
// APIs de fs do Node, então o comportamento esperado é idêntico em Windows,
// macOS e Linux.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-has-git-dir-"));

const emptyRepoPath = path.join(tempDir, "sem-git");
fs.mkdirSync(emptyRepoPath, { recursive: true });
assert.strictEqual(
  await hasGitDir(emptyRepoPath),
  false,
  "Um diretório sem .git não deve ser detectado como repositório"
);

const missingPath = path.join(tempDir, "nao-existe");
assert.strictEqual(
  await hasGitDir(missingPath),
  false,
  "Um diretório que nem existe não deve ser detectado como repositório"
);

const clonedRepoPath = path.join(tempDir, "com-git");
fs.mkdirSync(path.join(clonedRepoPath, ".git"), { recursive: true });
assert.strictEqual(
  await hasGitDir(clonedRepoPath),
  true,
  "Um diretório com .git/ deve ser detectado como repositório já clonado"
);

// .git também pode ser um arquivo comum (worktrees/submodules do git usam
// isso), não um diretório — hasGitDir checa isDirectory() especificamente.
const fileGitPath = path.join(tempDir, "git-como-arquivo");
fs.mkdirSync(fileGitPath, { recursive: true });
fs.writeFileSync(path.join(fileGitPath, ".git"), "gitdir: ../outro/lugar\n", "utf-8");
assert.strictEqual(
  await hasGitDir(fileGitPath),
  false,
  "Um .git que é arquivo (não diretório) não deve ser tratado como repositório completo"
);

console.log("git_has_git_dir_portable_test: OK");
