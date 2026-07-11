import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { configureGitSyncCommand } from "../src/modules/git/gitCommand.js";
import { writeGitServers } from "../src/modules/git/persistence.js";

const originalFetch = globalThis.fetch;

const mainProjects = [
  {
    id: 1,
    name: "Public Repo",
    path_with_namespace: "grupo/public-repo",
    ssh_url_to_repo: "git@git.tse.jus.br:grupo/public-repo.git",
    http_url_to_repo: "https://git.tse.jus.br/grupo/public-repo.git",
    visibility: "public",
    archived: false,
    default_branch: "main",
  },
  {
    id: 2,
    name: "Archived Repo",
    path_with_namespace: "grupo/archived-repo",
    ssh_url_to_repo: "git@git.tse.jus.br:grupo/archived-repo.git",
    http_url_to_repo: "https://git.tse.jus.br/grupo/archived-repo.git",
    visibility: "private",
    archived: true,
    default_branch: "main",
  },
  {
    id: 3,
    name: "Private Repo",
    path_with_namespace: "grupo/private-repo",
    ssh_url_to_repo: "git@git.tse.jus.br:grupo/private-repo.git",
    http_url_to_repo: "https://git.tse.jus.br/grupo/private-repo.git",
    visibility: "private",
    archived: false,
    default_branch: "main",
  },
];

const devProjects = [
  {
    id: 11,
    name: "Dev Repo",
    path_with_namespace: "devops/dev-repo",
    ssh_url_to_repo: "git@gitlab.dev.local:devops/dev-repo.git",
    http_url_to_repo: "https://gitlab.dev.local/devops/dev-repo.git",
    visibility: "private",
    archived: false,
    default_branch: "develop",
  },
  {
    id: 12,
    name: "Dev Public",
    path_with_namespace: "devops/dev-public",
    ssh_url_to_repo: "git@gitlab.dev.local:devops/dev-public.git",
    http_url_to_repo: "https://gitlab.dev.local/devops/dev-public.git",
    visibility: "public",
    archived: false,
    default_branch: "main",
  },
];

const mainGroups = [{ id: 10, name: "Grupo", full_path: "grupo", parent_id: null }];
const devGroups = [{ id: 20, name: "DevOps", full_path: "devops", parent_id: null }];

const resolveApiResponse = (url: string): Response => {
  if (url.startsWith("https://git.tse.jus.br")) {
    if (url.includes("/api/v4/groups")) {
      return new Response(JSON.stringify(mainGroups), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/v4/projects?visibility=public")) {
      return new Response(
        JSON.stringify(mainProjects.filter((project) => project.visibility === "public")),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/api/v4/projects")) {
      return new Response(JSON.stringify(mainProjects), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  if (url.startsWith("https://gitlab.dev.local")) {
    if (url.includes("/api/v4/groups")) {
      return new Response(JSON.stringify(devGroups), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/v4/projects?visibility=public")) {
      return new Response(
        JSON.stringify(devProjects.filter((project) => project.visibility === "public")),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/api/v4/projects")) {
      return new Response(JSON.stringify(devProjects), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

globalThis.fetch = (async (url: string): Promise<Response> => resolveApiResponse(url)) as typeof fetch;

const runSummaryTests = async (): Promise<void> => {
  let output = "";
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    output += `${String(message ?? "")}\n`;
    originalLog(message);
  };

  const originalHome = process.env.HOME;
  const originalArgv = process.argv;
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "paje-summary-home-"));
  const homeDir = process.env.HOME;
  const sshDir = path.join(homeDir, ".ssh");
  fs.mkdirSync(sshDir, { recursive: true });
  const keyPath = path.join(sshDir, "paje");
  fs.writeFileSync(keyPath, "dummy-private-key", "utf-8");
  const sshConfigPath = path.join(sshDir, "config");
  fs.writeFileSync(
    sshConfigPath,
    "Host git.tse.jus.br\n  HostName git.tse.jus.br\n  User git\n  IdentityFile ~/.ssh/paje\n  IdentitiesOnly yes\nHost gitlab.dev.local\n  HostName gitlab.dev.local\n  User git\n  IdentityFile ~/.ssh/paje\n  IdentitiesOnly yes\n",
    "utf-8"
  );
  const knownHostsPath = path.join(sshDir, "known_hosts");
  fs.writeFileSync(
    knownHostsPath,
    "git.tse.jus.br ssh-rsa ********************... [SSH KEY MASKED]\n" +
      "gitlab.dev.local ssh-rsa ********************... [SSH KEY MASKED]\n",
    "utf-8"
  );
  const envPath = path.join(homeDir, "env-test.yaml");
  fs.writeFileSync(envPath, "", "utf-8");

  const program = new Command();
  configureGitSyncCommand(program);
  const runCli = async (args: string[]): Promise<void> => {
    process.argv = ["node", "cli.ts", ...args];
    await program.parseAsync(["node", "cli.ts", ...args]);
  };
  writeGitServers([
    {
      id: "https://git.tse.jus.br",
      name: "TSE-GIT",
      baseUrl: "https://git.tse.jus.br",
      token: "glpat-test-token",
    },
    {
      id: "https://gitlab.dev.local",
      name: "DEV-GIT",
      baseUrl: "https://gitlab.dev.local",
      token: "glpat-dev-token",
    },
  ]);
  await runCli(["git-sync", "--base-dir", "repos", "--env-file", envPath, "--no-summary=true"]);

  assert.ok(!output.includes("Resumo"), "Não deve exibir resumo quando --no-summary=true");

  output = "";
  await runCli(["git-sync", "--base-dir", "repos", "--env-file", envPath]);
  const summaryShown =
    output.includes("Resumo") ||
    output.includes("Summary") ||
    output.includes("Repositories identified");
  assert.ok(summaryShown, "Deve exibir resumo por padrão");
  const repositoriesIdentified =
    output.includes("Repositórios identificados") ||
    output.includes("Reposit?rios identificados") ||
    output.includes("Repositories identified");
  assert.ok(repositoriesIdentified, "Deve contar todos os repositórios");
  const repositoriesIdentifiedCount =
    output.includes("Repositórios identificados:  5") ||
    output.includes("Reposit?rios identificados:  5") ||
    output.includes("Repositories identified:  5");
  assert.ok(repositoriesIdentifiedCount, "Deve contar todos os repositórios no resumo");
  const publicCount =
    output.includes("Públicos                     2") ||
    output.includes("P?blicos                     2") ||
    output.includes("Public                    2");
  assert.ok(publicCount, "Deve contar repositórios públicos");
  const publicLabel =
    output.includes("Públicos") || output.includes("P?blicos") || output.includes("Public");
  assert.ok(publicLabel, "Deve contar repositórios públicos");
  const archivedLabel = output.includes("Arquivados") || output.includes("Archived");
  assert.ok(archivedLabel, "Deve contar repositórios arquivados");

  output = "";
  await runCli(["git-sync", "--base-dir", "repos", "--env-file", envPath, "--no-public-repos=true"]);
  assert.ok(!output.includes("public-repo"), "Não deve listar repositórios públicos");
  const publicFilterSummary =
    output.includes("Repositórios identificados:  3") ||
    output.includes("Reposit?rios identificados:  3") ||
    output.includes("Repositories identified:  3");
  assert.ok(publicFilterSummary, "Resumo deve respeitar filtros de público");

  output = "";
  await runCli(["git-sync", "--base-dir", "repos", "--env-file", envPath, "--no-archived-repos=true"]);
  assert.ok(!output.includes("archived-repo"), "Não deve listar repositórios arquivados");
  const archivedFilterSummary =
    output.includes("Repositórios identificados:  4") ||
    output.includes("Reposit?rios identificados:  4") ||
    output.includes("Repositories identified:  4");
  assert.ok(archivedFilterSummary, "Resumo deve respeitar filtros de arquivados");

  output = "";
  await runCli(["git-sync", "--base-dir", "repos", "--env-file", envPath, "--filter=devops/*"]);
  const filterSummary =
    output.includes("Repositórios identificados:  2") ||
    output.includes("Reposit?rios identificados:  2") ||
    output.includes("Repositories identified:  2");
  assert.ok(filterSummary, "Resumo deve respeitar filtro por padrão");

  console.log = originalLog;
  process.env.HOME = originalHome;
  process.argv = originalArgv;
  globalThis.fetch = originalFetch as typeof fetch;

  console.log("git_sync_summary_test: OK");
};

const summaryPromise = runSummaryTests();
const globalBucket = globalThis as { __pajeTests?: Promise<void>[] };
if (globalBucket.__pajeTests) {
  globalBucket.__pajeTests.push(summaryPromise);
} else {
  globalBucket.__pajeTests = [summaryPromise];
}
