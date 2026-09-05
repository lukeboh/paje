import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncRepository } from "../src/modules/git/parallelSync.js";
import type { GitRepositoryTarget } from "../src/modules/git/types.js";

// Regressão: parallelSync.ts precisa manter o remote "origin" alinhado com a
// URL que o core resolveu (target.httpUrl ?? target.sshUrl), nas duas
// direções — não só SSH -> HTTPS+token (comportamento pré-existente), mas
// também HTTPS+token -> SSH, que é o caso que passou a ocorrer depois que
// gitSyncService.ts parou de preencher pajeHttpUrl para hosts com associação
// SSH válida. A migração de volta só deve disparar quando o remote atual
// tem o prefixo oauth2:/x-access-token: que o próprio PAJÉ embute — nunca
// para um remote https:// qualquer configurado manualmente pelo usuário.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paje-parallel-migration-"));
const targetPath = path.join(tempDir, "grupo", "repo");
fs.mkdirSync(path.join(targetPath, ".git"), { recursive: true });
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
            string remote = Environment.GetEnvironmentVariable("CURRENT_REMOTE");
            Console.WriteLine(string.IsNullOrEmpty(remote) ? "git@exemplo.com:grupo/repo.git" : remote);
            return 0;
        }
        if (line.Contains("rev-parse --abbrev-ref HEAD")) {
            Console.WriteLine("main");
            return 0;
        }
        if (line.Contains("rev-list --left-right --count")) {
            Console.WriteLine("0 0");
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
      "  echo \"${CURRENT_REMOTE:-git@exemplo.com:grupo/repo.git}\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$args\" == *\"rev-parse --abbrev-ref HEAD\"* ]]; then\n" +
      "  echo \"main\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "if [[ \"$args\" == *\"rev-list --left-right --count\"* ]]; then\n" +
      "  echo \"0 0\"\n" +
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

const baseTarget: GitRepositoryTarget = {
  id: 1,
  name: "Repo",
  pathWithNamespace: "grupo/repo",
  sshUrl: "git@exemplo.com:grupo/repo.git",
  localPath: targetPath,
};

const resetLog = () => fs.writeFileSync(gitLogPath, "");
const readLog = () => (fs.existsSync(gitLogPath) ? fs.readFileSync(gitLogPath, "utf-8") : "");

try {
  // Caso 1 (pré-existente): remote SSH, target resolvido para HTTPS+token
  // (host sem associação SSH válida) -> deve migrar SSH -> HTTPS.
  resetLog();
  process.env.CURRENT_REMOTE = "git@exemplo.com:grupo/repo.git";
  await syncRepository({
    ...baseTarget,
    httpUrl: "https://oauth2:newtoken@exemplo.com/grupo/repo.git",
  });
  assert.ok(
    readLog().includes("remote set-url origin https://oauth2:newtoken@exemplo.com/grupo/repo.git"),
    "Deve migrar remote SSH para HTTPS+token quando target.httpUrl está presente"
  );

  // Caso 2 (nova correção): remote HTTPS+token deixado por uma sincronização
  // anterior (ou por versões antes desta correção), target agora resolvido
  // para SSH (host passou a ter associação SSH válida) -> deve migrar de
  // volta HTTPS -> SSH.
  resetLog();
  process.env.CURRENT_REMOTE = "https://oauth2:oldtoken@exemplo.com/grupo/repo.git";
  await syncRepository({
    ...baseTarget,
    httpUrl: undefined,
  });
  assert.ok(
    readLog().includes("remote set-url origin git@exemplo.com:grupo/repo.git"),
    "Deve migrar remote HTTPS+token de volta para SSH quando target.httpUrl deixou de existir"
  );

  // Caso 3: remote HTTPS configurado manualmente pelo usuário (sem os
  // prefixos oauth2:/x-access-token: que só o PAJÉ embute) -> nunca deve
  // ser reescrito, mesmo com target.sshUrl disponível.
  resetLog();
  process.env.CURRENT_REMOTE = "https://meuservidor.example.com/grupo/repo.git";
  await syncRepository({
    ...baseTarget,
    httpUrl: undefined,
  });
  assert.ok(
    !readLog().includes("remote set-url"),
    "Não deve reescrever um remote HTTPS configurado manualmente pelo usuário"
  );
} finally {
  process.env.PATH = originalPath;
  delete process.env.GIT_LOG_PATH;
  delete process.env.CURRENT_REMOTE;
}

console.log("git_parallel_sync_remote_migration_test: OK");
