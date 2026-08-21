import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePajeKeyPair } from "../src/modules/git/sshManager.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-home-overwrite-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const sshDir = path.join(tempHome, ".ssh");
fs.mkdirSync(sshDir, { recursive: true });

const privateKeyPath = path.join(sshDir, "paje");
const publicKeyPath = `${privateKeyPath}.pub`;
fs.writeFileSync(privateKeyPath, "PRIVATE", "utf-8");
fs.writeFileSync(publicKeyPath, "PUBLIC", "utf-8");

const reused = await ensurePajeKeyPair({ keyLabel: "paje" });
assert.strictEqual(reused.privateKeyPath, privateKeyPath, "Deve reutilizar a chave existente");
assert.strictEqual(reused.publicKeyPath, publicKeyPath, "Deve reutilizar a chave pública existente");

await ensurePajeKeyPair({ keyLabel: "paje", overwrite: true });
assert.ok(fs.existsSync(`${privateKeyPath}.bak`), "Deve mover chave privada para .bak");
assert.ok(fs.existsSync(`${publicKeyPath}.pub.bak`), "Deve mover chave pública para .pub.bak");

process.env.HOME = originalHome;
process.env.USERPROFILE = originalUserProfile;

console.log("ssh_key_overwrite_test: OK");
