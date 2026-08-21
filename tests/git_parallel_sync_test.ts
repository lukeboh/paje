import assert from "node:assert";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureParentDir, resolveConcurrency, syncRepository } from "../src/modules/git/parallelSync.js";

assert.ok(resolveConcurrency({ concurrency: 1 }) === 1, "Concorrência mínima = 1");
assert.ok(resolveConcurrency({ concurrency: 4 }) === 4, "Concorrência customizada");
assert.ok(resolveConcurrency({ concurrency: "auto" }) >= 2, "Concorrência auto >= 2");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-parallel-"));
const targetPath = path.join(tempDir, "grupo", "repo");
const binDir = path.join(tempDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
const isWin = process.platform === "win32";
const fakeGitPath = isWin ? path.join(binDir, "git.exe") : path.join(binDir, "git");
const gitLogPath = path.join(tempDir, "git.log");

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
        if (line.Contains("remote get-url origin")) {
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NO_REMOTE"))) return 1;
            Console.WriteLine("git@exemplo.com:grupo/repo.git");
            return 0;
        }
        if (line.Contains("rev-parse --abbrev-ref HEAD")) {
            string b = Environment.GetEnvironmentVariable("CURRENT_BRANCH");
            Console.WriteLine(string.IsNullOrEmpty(b) ? "main" : b);
            return 0;
        }
        if (line.Contains("rev-list --left-right --count")) {
            string r = Environment.GetEnvironmentVariable("REV_LIST_OUTPUT");
            Console.WriteLine(string.IsNullOrEmpty(r) ? "0 0" : r);
            return 0;
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
      "args=\"$*\"\n" +
      "if [[ \"$args\" == *\"remote get-url origin\"* ]]; then\n" +
      "  if [[ -n \"$NO_REMOTE\" ]]; then\n" +
      "    exit 1\n" +
      "  fi\n" +
      "  echo \"git@exemplo.com:grupo/repo.git\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$args\" == *\"rev-parse --abbrev-ref HEAD\"* ]]; then\n" +
      "  echo \"${CURRENT_BRANCH:-main}\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$args\" == *\"rev-list --left-right --count\"* ]]; then\n" +
      "  echo \"${REV_LIST_OUTPUT:-0 0}\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
    "utf-8"
  );
  fs.chmodSync(fakeGitPath, 0o755);
}
const originalPath = process.env.PATH;
process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
process.env.GIT_LOG_PATH = gitLogPath;
try {
  await ensureParentDir(targetPath);
  assert.ok(fs.existsSync(path.dirname(targetPath)), "Deve criar diretório pai");

  const progressEvents: Array<{ percent?: number }> = [];
  const result = await syncRepository(
    {
      id: 1,
      name: "Repo",
      pathWithNamespace: "grupo/repo",
      sshUrl: "git@exemplo.com:grupo/repo.git",
      localPath: targetPath,
      gitUserName: "Usuario Teste",
      gitUserEmail: "usuario@exemplo.com",
    },
    undefined,
    1,
    (event) => {
      progressEvents.push({ percent: event.percent });
    }
  );
  assert.ok(result.status === "cloned" || result.status === "failed", "Deve tentar clonar repositório");
  assert.ok(progressEvents.length >= 0, "Deve aceitar callback de progresso");
  const gitLog = fs.existsSync(gitLogPath) ? fs.readFileSync(gitLogPath, "utf-8") : "";
  assert.ok(gitLog.includes("config user.name Usuario Teste"), "Deve configurar user.name após clone");
  assert.ok(gitLog.includes("config user.email usuario@exemplo.com"), "Deve configurar user.email após clone");

  const gitDir = path.join(targetPath, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  process.env.NO_REMOTE = "1";
  const resultSkip = await syncRepository({
    id: 1,
    name: "Repo",
    pathWithNamespace: "grupo/repo",
    sshUrl: "git@exemplo.com:grupo/repo.git",
    localPath: targetPath,
    gitUserName: "Usuario Teste",
    gitUserEmail: "usuario@exemplo.com",
  });
  assert.ok(resultSkip.status === "skipped", "Deve ignorar repositório sem remoto configurado");
  const gitLogAfterSkip = fs.existsSync(gitLogPath) ? fs.readFileSync(gitLogPath, "utf-8") : "";
  assert.ok(gitLogAfterSkip.includes("config user.name Usuario Teste"), "Deve configurar user.name quando ausente");
  assert.ok(gitLogAfterSkip.includes("config user.email usuario@exemplo.com"), "Deve configurar user.email quando ausente");

  delete process.env.NO_REMOTE;
  process.env.REV_LIST_OUTPUT = "2 0";
  const resultBehind = await syncRepository({
    id: 1,
    name: "Repo",
    pathWithNamespace: "grupo/repo",
    sshUrl: "git@exemplo.com:grupo/repo.git",
    localPath: targetPath,
  });
  assert.ok(resultBehind.status === "pulled", "Deve realizar pull quando repositório está BEHIND");

  process.env.REV_LIST_OUTPUT = "0 3";
  const resultAhead = await syncRepository({
    id: 1,
    name: "Repo",
    pathWithNamespace: "grupo/repo",
    sshUrl: "git@exemplo.com:grupo/repo.git",
    localPath: targetPath,
  });
  assert.ok(resultAhead.status === "pushed", "Deve realizar push quando repositório está AHEAD");

  process.env.REV_LIST_OUTPUT = "0 0";
  const resultSynced = await syncRepository({
    id: 1,
    name: "Repo",
    pathWithNamespace: "grupo/repo",
    sshUrl: "git@exemplo.com:grupo/repo.git",
    localPath: targetPath,
  });
  assert.ok(resultSynced.status === "skipped", "Deve ignorar quando não há diferenças");
} finally {
  process.env.PATH = originalPath;
  delete process.env.GIT_LOG_PATH;
  delete process.env.NO_REMOTE;
  delete process.env.REV_LIST_OUTPUT;
  delete process.env.CURRENT_BRANCH;
}

console.log("git_parallel_sync_test: OK");
