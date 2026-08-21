import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LogEntry } from "../src/modules/git/core/loggerBroker.js";

// Regressão: loadTree() precisa garantir known_hosts para os hosts SSH dos
// servidores resolvidos MESMO quando responde a partir do cache (o laço de
// fetch por servidor, onde isso também acontece via ensureSshKey, é
// inteiramente pulado nesse caminho) — sem isso, um known_hosts incompleto
// só era descoberto quando o clone/fetch em paralelo já estava em
// andamento, com cada processo git preso numa pergunta interativa do SSH
// que ninguém tinha como responder.

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-known-hosts-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

try {
  const { createGitSyncCore, computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const { upsertSshConfigHost } = await import("../src/modules/git/sshManager.js");
  const paths = resolvePajePaths();
  fs.mkdirSync(paths.baseDir, { recursive: true });

  const sshDir = path.join(tmpHome, ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });

  const dummyKeyPath = path.join(sshDir, "id_ed25519_test");
  fs.writeFileSync(dummyKeyPath, "not-a-real-key");

  const knownHost = "known.example.test";
  const missingHost = "missing.example.test";

  // Ambos os hosts têm associação SSH válida (Host block + IdentityFile
  // existente em disco) — é isso que faz hasValidSshAssociation() considerá-
  // los candidatos à checagem de known_hosts.
  upsertSshConfigHost(knownHost, dummyKeyPath);
  upsertSshConfigHost(missingHost, dummyKeyPath);

  // Só knownHost já está em known_hosts; missingHost está deliberadamente
  // ausente — é o caso que a correção precisa detectar.
  fs.writeFileSync(
    path.join(sshDir, "known_hosts"),
    `${knownHost} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyDataForTesting1234567890\n`
  );

  const servers = [
    { id: `https://${knownHost}`, name: "Conhecido", baseUrl: `https://${knownHost}` },
    { id: `https://${missingHost}`, name: "Ausente", baseUrl: `https://${missingHost}` },
  ];
  fs.writeFileSync(paths.serversFile, JSON.stringify(servers, null, 2));

  // Cache válido para os dois servidores — força loadTree() pelo caminho de
  // cache-hit, que é exatamente o que pulava a checagem antes da correção.
  const configHash = computeConfigHash(servers.map((s) => ({ ...s })));
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash,
      servers: [
        { serverName: "Conhecido", groups: [], projects: [] },
        { serverName: "Ausente", groups: [], projects: [] },
      ],
      statusMap: {},
    })
  );

  const config = {
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "paje-known-hosts-repos-")),
    prepareLocalDirs: false,
    noPublicRepos: false,
    noArchivedRepos: false,
    filter: "",
    syncRepos: "",
    verbose: false,
  } as unknown as import("../src/modules/git/core/gitSyncConfig.js").GitSyncConfig;

  const logs: LogEntry[] = [];
  const logger = new LoggerBroker();
  logger.addTransport({
    name: "collector",
    minLevel: "info",
    log: (entry) => logs.push(entry),
  });

  const core = createGitSyncCore();
  const started = Date.now();
  const view = await core.loadTree({ config, logger });
  const elapsed = Date.now() - started;

  assert.equal(view.fromCache, true, "loadTree deve responder a partir do cache (é o caminho sob teste)");
  assert.ok(elapsed < 5000, `Checagem de known_hosts não deve travar o loadTree (levou ${elapsed}ms)`);

  const messages = logs.map((entry) => entry.message);
  assert.ok(
    !messages.some((m) => m.includes(knownHost)),
    "Host já presente em known_hosts não deve gerar nenhuma mensagem de log"
  );
  assert.ok(
    messages.some((m) => m.includes(missingHost) && m.includes("known_hosts")),
    "Host ausente de known_hosts deve ser detectado e logado, mesmo com loadTree respondendo do cache"
  );

  const knownHostsContent = fs.readFileSync(path.join(sshDir, "known_hosts"), "utf-8");
  assert.ok(
    knownHostsContent.includes(knownHost),
    "Entrada pré-existente de known_hosts não deve ser afetada"
  );
} finally {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log("git_sync_known_hosts_test: OK");
