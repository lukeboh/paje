import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Regressão/cobertura da funcionalidade que detecta e contorna a
// incompatibilidade do SSH embutido do Git for Windows (usr/bin/ssh.exe,
// OpenSSL 3.x) com chaves cujo formato/cifra de senha ele não suporta mais
// — resolveGitSshCommandOverride() só deve agir com uma confirmação
// positiva (a chave falha no ssh embutido do Git E funciona no OpenSSH
// nativo do Windows); qualquer outra combinação deve resultar em `null`,
// nunca numa suposição.

const originalPlatform = process.platform;
const setPlatform = (value: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-ssh-compat-"));
const garbageIdentityPath = path.join(tempDir, "not_a_real_key");
fs.writeFileSync(garbageIdentityPath, "isso nao e uma chave ssh valida\n");

try {
  const { resolveGitSshCommandOverride } = await import("../src/modules/git/sshManager.js");

  setPlatform("darwin");
  const macResult = await resolveGitSshCommandOverride(garbageIdentityPath);
  assert.strictEqual(macResult, null, "Fora do Windows, nunca deve tentar nenhum contorno");

  setPlatform("linux");
  const linuxResult = await resolveGitSshCommandOverride(garbageIdentityPath);
  assert.strictEqual(linuxResult, null, "Fora do Windows, nunca deve tentar nenhum contorno");

  if (originalPlatform === "win32") {
    setPlatform("win32");
    // Uma chave que nenhum dos dois ssh-keygen (o embutido do Git e o
    // nativo do Windows) consegue ler não deve resultar em contorno algum
    // — resolveGitSshCommandOverride só age numa comparação positiva
    // (falha no embutido, sucesso no nativo), nunca só porque o embutido
    // falhou.
    const bothFailResult = await resolveGitSshCommandOverride(garbageIdentityPath);
    assert.strictEqual(
      bothFailResult,
      null,
      "Uma chave inválida para os dois clientes SSH não deve gerar contorno nenhum"
    );

    const missingIdentityPath = path.join(tempDir, "does-not-exist");
    const missingResult = await resolveGitSshCommandOverride(missingIdentityPath);
    assert.strictEqual(missingResult, null, "Um caminho de identidade inexistente não deve gerar contorno nenhum");
  }
} finally {
  setPlatform(originalPlatform);
}

console.log("ssh_manager_git_compat_test: OK");
