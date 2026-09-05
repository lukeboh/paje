import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectFixRemoteTargets, fixRemotesForTargets } from "../src/modules/git/core/gitSyncService.js";
import type { GitLabProject, GitLabTreeNode } from "../src/modules/git/types.js";

// Regressão/cobertura da nova funcionalidade "corrigir remotes" (Ctrl+U na
// TUI, --fix-remotes na CLI): dado o conjunto de projetos já conhecidos
// (árvore carregada), só os que já têm um clone local em disco devem ser
// considerados, e cada um deve ter o remote "origin" alinhado com o que o
// core resolveu (sshUrl quando o host tem associação SSH válida, httpUrl
// caso contrário) — nas duas direções, e nunca tocando um remote HTTPS
// configurado manualmente pelo usuário.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-fix-remotes-"));
const binDir = path.join(tempDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
const isWin = process.platform === "win32";
const fakeGitPath = isWin ? path.join(binDir, "git.exe") : path.join(binDir, "git");
const gitLogPath = path.join(tempDir, "git.log");
const remotesMapPath = path.join(tempDir, "remotes-map.txt");

const repoSshPath = path.join(tempDir, "repo-should-migrate-to-ssh");
const repoHttpPath = path.join(tempDir, "repo-should-migrate-to-http");
const repoManualPath = path.join(tempDir, "repo-manual-https-untouched");
const repoNotClonedPath = path.join(tempDir, "repo-not-cloned-yet");

fs.mkdirSync(path.join(repoSshPath, ".git"), { recursive: true });
fs.mkdirSync(path.join(repoHttpPath, ".git"), { recursive: true });
fs.mkdirSync(path.join(repoManualPath, ".git"), { recursive: true });
// repoNotClonedPath deliberately has no .git directory.

const DELIM = "::=>";
fs.writeFileSync(
  remotesMapPath,
  [
    `${repoSshPath}${DELIM}https://oauth2:oldtoken@exemplo.com/grupo/repo-ssh.git`,
    `${repoHttpPath}${DELIM}git@exemplo.com:grupo/repo-http.git`,
    `${repoManualPath}${DELIM}https://meuservidor.example.com/grupo/repo-manual.git`,
  ].join("\n")
);

if (isWin) {
  const csharpCode = `
using System;
using System.IO;

public class Program {
    public static int Main(string[] args) {
        string logPath = Environment.GetEnvironmentVariable("GIT_LOG_PATH");
        string line = string.Join(" ", args);
        if (!string.IsNullOrEmpty(logPath)) {
            File.AppendAllText(logPath, line + "\\n");
        }
        string cpath = "";
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-C" && i + 1 < args.Length) { cpath = args[i + 1]; break; }
        }
        if (line.Contains("remote get-url origin")) {
            string mapFile = Environment.GetEnvironmentVariable("REMOTES_MAP_FILE");
            if (!string.IsNullOrEmpty(mapFile) && File.Exists(mapFile)) {
                string prefix = cpath + "::=>";
                foreach (var l in File.ReadAllLines(mapFile)) {
                    if (l.StartsWith(prefix)) {
                        Console.WriteLine(l.Substring(prefix.Length));
                        return 0;
                    }
                }
            }
            return 1;
        }
        return 0;
    }
}
`;
  const csFile = path.join(tempDir, "FakeGit.cs");
  fs.writeFileSync(csFile, csharpCode, "utf-8");
  const psCmd = `Add-Type -TypeDefinition (Get-Content '${csFile}' -Raw) -OutputAssembly '${fakeGitPath}' -OutputType ConsoleApplication`;
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`);
} else {
  fs.writeFileSync(
    fakeGitPath,
    "#!/usr/bin/env bash\n" +
      "echo \"$*\" >> \"${GIT_LOG_PATH:-/dev/null}\"\n" +
      "cpath=\"\"\n" +
      "args=(\"$@\")\n" +
      "for ((i=0; i<${#args[@]}; i++)); do\n" +
      "  if [[ \"${args[$i]}\" == \"-C\" ]]; then cpath=\"${args[$((i+1))]}\"; break; fi\n" +
      "done\n" +
      "if [[ \"$*\" == *\"remote get-url origin\"* ]]; then\n" +
      "  if [[ -f \"$REMOTES_MAP_FILE\" ]]; then\n" +
      "    line=$(grep -F \"${cpath}::=>\" \"$REMOTES_MAP_FILE\" | head -1)\n" +
      "    if [[ -n \"$line\" ]]; then echo \"${line#*::=>}\"; exit 0; fi\n" +
      "  fi\n" +
      "  exit 1\n" +
      "fi\n" +
      "exit 0\n",
    "utf-8"
  );
  fs.chmodSync(fakeGitPath, 0o755);
}

const originalPath = process.env.PATH;
process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
process.env.GIT_LOG_PATH = gitLogPath;
process.env.REMOTES_MAP_FILE = remotesMapPath;

const makeProject = (overrides: Partial<GitLabProject> & { id: number; path_with_namespace: string }): GitLabProject => ({
  name: overrides.path_with_namespace.split("/").pop() ?? "repo",
  ssh_url_to_repo: `git@exemplo.com:${overrides.path_with_namespace}.git`,
  http_url_to_repo: `https://exemplo.com/${overrides.path_with_namespace}.git`,
  visibility: "private",
  archived: false,
  default_branch: "main",
  namespace: { id: overrides.id * 10, full_path: "grupo" },
  ...overrides,
});

const projectNode = (id: number, localPath: string, project: GitLabProject): GitLabTreeNode => ({
  id: String(id),
  label: project.name,
  type: "project",
  project,
  localPath,
});

try {
  const tree: GitLabTreeNode[] = [
    projectNode(
      1,
      repoSshPath,
      makeProject({
        id: 1,
        path_with_namespace: "grupo/repo-ssh",
        // Host has a valid SSH association: no pajeHttpUrl.
        pajeHttpUrl: undefined,
      })
    ),
    projectNode(
      2,
      repoHttpPath,
      makeProject({
        id: 2,
        path_with_namespace: "grupo/repo-http",
        // Host has no SSH association: pajeHttpUrl is set.
        pajeHttpUrl: "https://oauth2:newtoken@exemplo.com/grupo/repo-http.git",
      })
    ),
    projectNode(
      3,
      repoManualPath,
      makeProject({
        id: 3,
        path_with_namespace: "grupo/repo-manual",
        pajeHttpUrl: undefined,
      })
    ),
    projectNode(
      4,
      repoNotClonedPath,
      makeProject({
        id: 4,
        path_with_namespace: "grupo/repo-not-cloned",
        pajeHttpUrl: undefined,
      })
    ),
  ];

  const targets = await collectFixRemoteTargets(tree);
  assert.equal(targets.length, 3, "Só os 3 repositórios com clone local (.git) devem virar alvo");
  assert.ok(
    !targets.some((target) => target.localPath === repoNotClonedPath),
    "Repositório ainda não clonado não deve ser considerado"
  );

  const results = await fixRemotesForTargets(targets);
  const byPath = new Map(results.map((result) => [result.localPath, result]));

  assert.equal(byPath.get(repoSshPath)?.outcome, "migrated-to-ssh", "Remote HTTPS+token deve migrar para SSH quando o host tem associação válida");
  assert.equal(byPath.get(repoHttpPath)?.outcome, "migrated-to-http", "Remote SSH deve migrar para HTTPS+token quando o host não tem associação SSH");
  assert.equal(byPath.get(repoManualPath)?.outcome, "unchanged", "Remote HTTPS configurado manualmente nunca deve ser reescrito");

  const gitLog = fs.readFileSync(gitLogPath, "utf-8");
  assert.ok(
    gitLog.includes(`remote set-url origin git@exemplo.com:grupo/repo-ssh.git`),
    "Deve ter chamado remote set-url para a URL SSH do repositório 1"
  );
  assert.ok(
    gitLog.includes(`remote set-url origin https://oauth2:newtoken@exemplo.com/grupo/repo-http.git`),
    "Deve ter chamado remote set-url para a URL HTTPS+token do repositório 2"
  );
  const gitLogLines = gitLog.split(/\r?\n/);
  assert.ok(
    !gitLogLines.some((line) => line.includes(repoManualPath) && line.includes("set-url")),
    "Não deve haver nenhuma chamada set-url envolvendo o repositório com remote manual"
  );

  // Nenhuma tentativa de reconciliar o repositório ainda não clonado —
  // confirma que collectFixRemoteTargets realmente o excluiu antes, e não
  // que fixRemotesForTargets apenas "não mudou nada" para ele.
  assert.ok(
    !gitLog.includes(repoNotClonedPath),
    "Repositório não clonado não deve gerar nenhuma chamada git"
  );

  // onResult é chamado exatamente uma vez por alvo, na ordem dos resultados.
  const onResultCalls: string[] = [];
  await fixRemotesForTargets(targets, (result) => onResultCalls.push(`${result.localPath}:${result.outcome}`));
  assert.equal(onResultCalls.length, 3, "onResult deve ser chamado uma vez por alvo");
} finally {
  process.env.PATH = originalPath;
  delete process.env.GIT_LOG_PATH;
  delete process.env.REMOTES_MAP_FILE;
}

console.log("git_sync_fix_remotes_test: OK");
