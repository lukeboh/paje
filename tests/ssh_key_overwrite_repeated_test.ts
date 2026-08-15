import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePajeKeyPair } from "../src/modules/git/sshManager.js";

// Regressão: no Windows, fs.renameSync lança EEXIST quando o destino já
// existe — diferente do POSIX, onde rename() sobrescreve silenciosamente.
// Sobrescrever a mesma chave PAJÉ duas vezes seguidas deixa um .bak da
// primeira vez; a segunda sobrescrita tentava renomear para cima desse .bak
// e só falhava nesse SO. Simulamos esse comportamento aqui — mesmo rodando
// em Linux — trocando fs.renameSync por uma versão que lança EEXIST quando
// o destino já existe, para provar que o código remove um .bak antigo antes
// de renomear, em vez de depender da semântica de rename do SO hospedeiro.

const originalHome = process.env.HOME;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-home-overwrite-repeat-"));
process.env.HOME = tempHome;

const sshDir = path.join(tempHome, ".ssh");
fs.mkdirSync(sshDir, { recursive: true });

const privateKeyPath = path.join(sshDir, "paje");
const publicKeyPath = `${privateKeyPath}.pub`;
fs.writeFileSync(privateKeyPath, "PRIVATE-1", "utf-8");
fs.writeFileSync(publicKeyPath, "PUBLIC-1", "utf-8");

const originalRenameSync = fs.renameSync;
fs.renameSync = ((oldPath: fs.PathOrFileDescriptor, newPath: fs.PathOrFileDescriptor) => {
  if (fs.existsSync(newPath as fs.PathLike)) {
    const error = new Error(
      `EEXIST: file already exists, rename '${String(oldPath)}' -> '${String(newPath)}'`
    ) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  return originalRenameSync(oldPath as fs.PathLike, newPath as fs.PathLike);
}) as typeof fs.renameSync;

try {
  await ensurePajeKeyPair({ keyLabel: "paje", overwrite: true });
  assert.ok(fs.existsSync(`${privateKeyPath}.bak`), "Primeira sobrescrita deve criar o .bak");
  assert.ok(fs.existsSync(`${publicKeyPath}.pub.bak`), "Primeira sobrescrita deve criar o .pub.bak");

  // Segunda sobrescrita: já existe um .bak da primeira vez. No Windows isso
  // lançava EEXIST antes de conseguir renomear a chave atual — reproduzido
  // aqui pelo substituto de renameSync acima.
  await ensurePajeKeyPair({ keyLabel: "paje", overwrite: true });
  assert.ok(fs.existsSync(`${privateKeyPath}.bak`), "Segunda sobrescrita deve manter um .bak, sem lançar erro");
  assert.ok(fs.existsSync(`${publicKeyPath}.pub.bak`), "Segunda sobrescrita deve manter um .pub.bak, sem lançar erro");
  assert.ok(fs.existsSync(privateKeyPath), "Segunda sobrescrita deve gerar uma chave privada nova no lugar de sempre");
  assert.ok(fs.existsSync(publicKeyPath), "Segunda sobrescrita deve gerar uma chave pública nova no lugar de sempre");
} finally {
  fs.renameSync = originalRenameSync;
  process.env.HOME = originalHome;
}

console.log("ssh_key_overwrite_repeated_test: OK");
