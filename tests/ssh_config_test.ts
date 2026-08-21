import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import {
  getIdentityFileForHostFromContents,
  isHostInKnownHostsFromContents,
  resolveSshIdentityPath,
  upsertSshConfigContents,
} from "../src/modules/git/sshManager.js";

const initialConfig = `Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_github
  IdentitiesOnly yes

Host gitlab.example.com
  HostName gitlab.example.com
  User git
  IdentityFile ~/.ssh/id_gitlab
  IdentitiesOnly yes
`;

const identity = getIdentityFileForHostFromContents(initialConfig, "gitlab.example.com");
assert.strictEqual(identity, "~/.ssh/id_gitlab", "Deve localizar IdentityFile pelo Host");

const newIdentityPath = path.join(os.homedir(), ".ssh", "id_gitlab_new");
const updatedConfig = upsertSshConfigContents(initialConfig, "gitlab.example.com", newIdentityPath);
assert.ok(updatedConfig.includes("IdentityFile ~/.ssh/id_gitlab_new"), "Deve atualizar IdentityFile existente");
assert.strictEqual(
  updatedConfig.split("Host gitlab.example.com").length - 1,
  1,
  "Não deve criar bloco duplicado"
);

const appendedConfig = upsertSshConfigContents("", "gitlab.seuorgao.gov.br", path.join(os.homedir(), ".ssh", "id_paje_rsa"));
assert.ok(appendedConfig.includes("Host gitlab.seuorgao.gov.br"), "Deve criar bloco novo");
assert.ok(appendedConfig.includes("IdentitiesOnly yes"), "Deve manter IdentitiesOnly yes");

const resolved = resolveSshIdentityPath("~/my_key");
assert.ok(resolved.endsWith(`${path.sep}my_key`), "Deve resolver caminho com ~");

const knownHostsSample = "gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockedKey\n";
assert.ok(
  isHostInKnownHostsFromContents(knownHostsSample, "gitlab.com"),
  "Deve detectar host no known_hosts por conteúdo"
);

console.log("ssh_config_test: OK");
