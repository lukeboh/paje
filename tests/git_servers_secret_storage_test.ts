import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The token stays in ~/.paje/git-servers.json on purpose: PAJÉ itself needs
// it for every REST call (listing groups/projects, validating, rotating),
// and the Git Credential Helper can't reliably give it back (cache helper
// expires, keyrings are locked on headless sessions, git runs
// `credential reject` on a failed auth, GCM may return its own credential).
// See docs/arquitetura.md, "Onde o token fica". So instead of moving it out:
//
// 1. The file is owner-only (0600) inside an owner-only dir (0700) — on
//    write, and on read for files left 0644 by an older PAJÉ version.
// 2. Writes are atomic (temp file + rename) and leave no temp file behind.
// 3. The token is registered in the credential helper even for servers whose
//    host has an SSH key, so HTTPS still authenticates and the helper is
//    restored from git-servers.json on every load.

const isWindows = process.platform === "win32";
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-secret-storage-home-"));
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalFetch = globalThis.fetch;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const modeOf = (target: string): number => fs.statSync(target).mode & 0o777;

try {
  const { readGitServers, writeGitServers, resolvePajePaths } = await import("../src/modules/git/persistence.js");
  const paths = resolvePajePaths();

  // --- 1/2. Permissions and atomic write ---------------------------------
  writeGitServers([{ id: "https://a.example.test", name: "A", baseUrl: "https://a.example.test", token: "secret-a" }]);
  assert.deepStrictEqual(
    readGitServers<Array<{ token?: string }>>([]).map((server) => server.token),
    ["secret-a"],
    "O conteúdo gravado deve ser lido de volta"
  );
  assert.deepStrictEqual(
    fs.readdirSync(paths.baseDir).filter((name) => name.endsWith(".tmp")),
    [],
    "A gravação atômica não pode deixar arquivo temporário para trás"
  );
  if (!isWindows) {
    assert.strictEqual(modeOf(paths.serversFile), 0o600, "git-servers.json deve ser 0600 após gravar");
    assert.strictEqual(modeOf(paths.baseDir), 0o700, "~/.paje deve ser 0700 após gravar");

    // A file left world-readable by an older version is fixed on read.
    fs.chmodSync(paths.serversFile, 0o644);
    fs.chmodSync(paths.baseDir, 0o755);
    readGitServers([]);
    assert.strictEqual(modeOf(paths.serversFile), 0o600, "Um git-servers.json 0644 antigo deve virar 0600 na leitura");
    assert.strictEqual(modeOf(paths.baseDir), 0o700, "Um ~/.paje 0755 antigo deve virar 0700 na leitura");

    // Overwriting an existing 0644 file must also end up 0600.
    fs.chmodSync(paths.serversFile, 0o644);
    writeGitServers([]);
    assert.strictEqual(modeOf(paths.serversFile), 0o600, "Sobrescrever um arquivo 0644 deve deixá-lo 0600");
  }

  // --- 3. SSH-associated server still registers its token in the helper ---
  const { createGitSyncCore, computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
  const { LoggerBroker } = await import("../src/modules/git/core/loggerBroker.js");
  const { upsertSshConfigHost } = await import("../src/modules/git/sshManager.js");

  const host = "gitlab.ssh-credential.example.test";
  const sshDir = path.join(tmpHome, ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });
  const keyPath = path.join(sshDir, "id_ed25519_test");
  fs.writeFileSync(keyPath, "not-a-real-key");
  upsertSshConfigHost(host, keyPath);
  fs.writeFileSync(
    path.join(sshDir, "known_hosts"),
    `${host} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyDataForTesting1234567890\n`
  );

  const servers = [
    {
      id: `https://${host}`,
      name: "GitLab-SSH",
      baseUrl: `https://${host}`,
      type: "gitlab" as const,
      username: "dev",
      token: "glpat-ssh-server-token",
    },
  ];
  writeGitServers(servers);
  fs.writeFileSync(
    paths.treeCacheFile,
    JSON.stringify({
      version: 1,
      configHash: computeConfigHash(servers),
      servers: [{ serverName: "GitLab-SSH", groups: [], projects: [] }],
      statusMap: {},
    })
  );

  // The background remote refresh after a cache hit must not reach the network.
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const logger = new LoggerBroker();
  logger.addTransport({ name: "collector", minLevel: "info", log: () => {} });
  const config = {
    baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "paje-secret-storage-repos-")),
    prepareLocalDirs: false,
    noPublicRepos: false,
    noArchivedRepos: false,
    filter: "",
    syncRepos: "",
    verbose: false,
  } as unknown as import("../src/modules/git/core/gitSyncConfig.js").GitSyncConfig;

  await createGitSyncCore().loadTree({ config, logger });

  // approveGitCredential runs fire-and-forget; wait for git to write it.
  const credentialsFile = path.join(tmpHome, ".git-credentials");
  const deadline = Date.now() + 10000;
  let credentials = "";
  while (Date.now() < deadline) {
    credentials = fs.existsSync(credentialsFile) ? fs.readFileSync(credentialsFile, "utf-8") : "";
    if (credentials.includes("glpat-ssh-server-token")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    credentials.includes(`dev:glpat-ssh-server-token@${host}`),
    "O token de um servidor com chave SSH também deve ser registrado no credential helper"
  );

  // Let the background refresh settle before restoring HOME.
  await new Promise((resolve) => setTimeout(resolve, 200));
} finally {
  globalThis.fetch = originalFetch;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
}

console.log("git_servers_secret_storage_test: OK");
