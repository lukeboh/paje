import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

// Regressão/cobertura de ponta a ponta do novo `--fix-remotes` em `git-sync`:
// deve carregar a árvore normalmente, mas em vez de clonar/sincronizar,
// corrigir o remote de cada repositório já clonado localmente e encerrar —
// sem nunca cair no fluxo normal de sync (que exigiria interação/TUI).

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalArgv = process.argv;
const originalPath = process.env.PATH;
const originalLog = console.log;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-fix-remotes-cli-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
const pajeDir = path.join(tempHome, ".paje");
fs.mkdirSync(pajeDir, { recursive: true });
fs.writeFileSync(
  path.join(pajeDir, "git-servers.json"),
  JSON.stringify([
    {
      id: "https://gitlab.example.com",
      name: "GitLab-Test",
      baseUrl: "https://gitlab.example.com",
      type: "gitlab",
      token: "glpat-x",
    },
  ]),
  "utf-8"
);

const project = {
  id: 1,
  name: "repo",
  path_with_namespace: "grupo/repo",
  ssh_url_to_repo: "git@gitlab.example.com:grupo/repo.git",
  http_url_to_repo: "https://gitlab.example.com/grupo/repo.git",
  default_branch: "main",
  visibility: "private",
  archived: false,
  namespace: { id: 10, full_path: "grupo" },
};

const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/v4/groups")) return jsonResponse([]);
  if (url.includes("/api/v4/projects")) return jsonResponse([project]);
  throw new Error(`URL inesperada: ${url}`);
};
globalThis.fetch = mockFetch as typeof fetch;

// Fake git: a única URL "get-url" existente hoje é SSH (o host não tem
// nenhuma associação SSH configurada nesta HOME de teste, então --fix-
// remotes deve migrá-la para HTTPS+token).
const binDir = path.join(tempHome, "bin");
fs.mkdirSync(binDir, { recursive: true });
const isWin = process.platform === "win32";
const fakeGitPath = isWin ? path.join(binDir, "git.exe") : path.join(binDir, "git");
const gitLogPath = path.join(tempHome, "git.log");

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
            Console.WriteLine("git@gitlab.example.com:grupo/repo.git");
            return 0;
        }
        return 0;
    }
}
`;
  const csFile = path.join(tempHome, "FakeGit.cs");
  fs.writeFileSync(csFile, csharpCode, "utf-8");
  const psCmd = `Add-Type -TypeDefinition (Get-Content '${csFile}' -Raw) -OutputAssembly '${fakeGitPath}' -OutputType ConsoleApplication`;
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`);
} else {
  fs.writeFileSync(
    fakeGitPath,
    "#!/usr/bin/env bash\n" +
      "echo \"$*\" >> \"${GIT_LOG_PATH:-/dev/null}\"\n" +
      "if [[ \"$*\" == *\"remote get-url origin\"* ]]; then\n" +
      "  echo \"git@gitlab.example.com:grupo/repo.git\"\n" +
      "  exit 0\n" +
      "fi\n" +
      "exit 0\n",
    "utf-8"
  );
  fs.chmodSync(fakeGitPath, 0o755);
}
process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
process.env.GIT_LOG_PATH = gitLogPath;

const baseDir = path.join(tempHome, "repos");
fs.mkdirSync(path.join(baseDir, "grupo", "repo", ".git"), { recursive: true });

let capturedLogs = "";
console.log = (...args: unknown[]) => {
  capturedLogs += `${args.map((item) => String(item)).join(" ")}\n`;
};

try {
  const { configureGitSyncCommand } = await import("../src/modules/git/gitCommand.js");

  const program = new Command();
  configureGitSyncCommand(program);
  process.argv = ["node", "cli.ts", "git-sync", "--base-dir", baseDir, "--fix-remotes"];
  await program.parseAsync(process.argv);

  assert.ok(
    capturedLogs.includes("grupo/repo") && /HTTPS/i.test(capturedLogs),
    `Deve informar que o remote de grupo/repo foi corrigido para HTTPS+token (host sem associação SSH). Log capturado:\n${capturedLogs}`
  );
  assert.ok(
    /Remotes corrigidos: 1 de 1|Remotes fixed: 1 of 1/.test(capturedLogs),
    `Deve exibir um resumo com 1 de 1 repositório corrigido. Log capturado:\n${capturedLogs}`
  );

  const gitLog = fs.readFileSync(gitLogPath, "utf-8");
  assert.ok(
    gitLog.includes("remote set-url origin https://oauth2:glpat-x@gitlab.example.com/grupo/repo.git"),
    "Deve ter reescrito o remote para a URL HTTPS+token (host sem associação SSH nesta HOME de teste)"
  );
  assert.ok(
    !gitLog.includes(" clone "),
    "--fix-remotes nunca deve clonar — só corrigir o remote de repositórios já existentes"
  );
} finally {
  console.log = originalLog;
  globalThis.fetch = originalFetch as typeof fetch;
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.argv = originalArgv;
  process.env.PATH = originalPath;
  delete process.env.GIT_LOG_PATH;
}

console.log("git_sync_fix_remotes_cli_test: OK");
