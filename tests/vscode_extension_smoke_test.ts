import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

// Funcionalidade coberta: ativação real da extensão VSCode.
// Carrega o bundle empacotado (dist/extension.cjs) com um mock do módulo
// "vscode", ativa a extensão com HOME temporário (servidores + cache do
// PAJÉ) e verifica que a árvore é carregada e os comandos registrados.

const bundlePath = path.resolve("vscode-extension/dist/extension.cjs");
if (!fs.existsSync(bundlePath)) {
  console.log("vscode_extension_smoke_test: SKIP (bundle ausente — rode npm run build:vscode)");
} else {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paje-vscode-home-"));
  const tmpRepos = fs.mkdtempSync(path.join(os.tmpdir(), "paje-vscode-repos-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  try {
    const pajeDir = path.join(tmpHome, ".paje");
    fs.mkdirSync(pajeDir, { recursive: true });
    const servers = [
      { id: "https://git.exemplo.com", name: "Exemplo", baseUrl: "https://git.exemplo.com", useBasicAuth: false },
    ];
    fs.writeFileSync(path.join(pajeDir, "git-servers.json"), JSON.stringify(servers));

    const { computeConfigHash } = await import("../src/modules/git/core/gitSyncService.js");
    const groups = [{ id: 1, name: "grupo", full_path: "grupo" }];
    const projects = [
      {
        id: 101,
        name: "proj-a",
        path_with_namespace: "grupo/proj-a",
        ssh_url_to_repo: "git@git.exemplo.com:grupo/proj-a.git",
        http_url_to_repo: "https://git.exemplo.com/grupo/proj-a.git",
        default_branch: "main",
        visibility: "private",
        namespace: { id: 1, full_path: "grupo" },
      },
    ];
    fs.writeFileSync(
      path.join(pajeDir, "git-tree-cache.json"),
      JSON.stringify({
        version: 1,
        configHash: computeConfigHash(servers.map((s) => ({ ...s }))),
        servers: [{ serverName: "Exemplo", groups, projects }],
        statusMap: {},
      })
    );
    fs.writeFileSync(path.join(tmpHome, ".paje", "env.yaml"), `base-dir: "${tmpRepos}"\n`);

    // --- mock mínimo do módulo "vscode" ---
    const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
    let treeProvider: {
      getChildren: (element?: unknown) => unknown[];
      getTreeItem: (node: unknown) => unknown;
    } | null = null;
    const treeViewState: { description?: string } = {};
    const messages: string[] = [];

    class MockEventEmitter {
      listeners: Array<(value: unknown) => void> = [];
      event = (listener: (value: unknown) => void) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      };
      fire = (value: unknown) => {
        this.listeners.forEach((listener) => listener(value));
      };
    }
    class MockTreeItem {
      constructor(public label: string, public collapsibleState: number) {}
    }
    class MockThemeIcon {
      constructor(public id: string, public color?: unknown) {}
    }
    class MockThemeColor {
      constructor(public id: string) {}
    }
    const vscodeMock = {
      env: { language: "pt-br" },
      EventEmitter: MockEventEmitter,
      TreeItem: MockTreeItem,
      ThemeIcon: MockThemeIcon,
      ThemeColor: MockThemeColor,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
      ProgressLocation: { Notification: 15 },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      window: {
        createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
        createTreeView: (_id: string, options: { treeDataProvider: typeof treeProvider }) => {
          treeProvider = options.treeDataProvider;
          return {
            onDidChangeCheckboxState: () => ({ dispose: () => undefined }),
            set description(value: string) {
              treeViewState.description = value;
            },
            dispose: () => undefined,
          };
        },
        showInputBox: async () => "",
        showInformationMessage: (message: string) => {
          messages.push(message);
          return Promise.resolve(undefined);
        },
        showWarningMessage: (message: string) => {
          messages.push(message);
          return Promise.resolve(undefined);
        },
        showErrorMessage: (message: string) => {
          messages.push(message);
          return Promise.resolve(undefined);
        },
        withProgress: async (_options: unknown, task: (progress: { report: () => void }) => Promise<unknown>) =>
          task({ report: () => undefined }),
      },
      commands: {
        registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
          registeredCommands.set(id, handler);
          return { dispose: () => undefined };
        },
        executeCommand: async () => undefined,
      },
      workspace: {
        openTextDocument: async () => ({}),
      },
    };

    type ModuleLoader = { _load: (request: string, ...rest: unknown[]) => unknown };
    const moduleLoader = Module as unknown as ModuleLoader;
    const originalLoad = moduleLoader._load;
    moduleLoader._load = function (request: string, ...rest: unknown[]) {
      if (request === "vscode") {
        return vscodeMock;
      }
      return originalLoad.call(this, request, ...rest);
    };

    try {
      const require = createRequire(import.meta.url);
      const extension = require(bundlePath) as {
        activate: (context: { subscriptions: unknown[] }) => void;
      };
      const context = { subscriptions: [] as unknown[] };
      extension.activate(context);

      // aguarda o loadTree inicial (cache hit → rápido)
      const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return predicate();
      };

      const loaded = await waitFor(() => Boolean(treeProvider && treeProvider.getChildren().length > 0));
      assert.ok(loaded, "A árvore deve ser carregada na ativação (cache hit)");

      const roots = treeProvider!.getChildren() as Array<{ label: string; children?: unknown[] }>;
      assert.equal(roots[0]?.label, "grupo", "O grupo do cache deve aparecer na raiz");

      const item = treeProvider!.getTreeItem(roots[0]) as { label: string; collapsibleState: number };
      assert.equal(item.label, "grupo");
      assert.equal(item.collapsibleState, 1, "Grupo com filhos deve ser colapsável");

      const expectedCommands = [
        "paje.refreshTree",
        "paje.syncSelected",
        "paje.syncNode",
        "paje.openRepository",
        "paje.openEnvFile",
      ];
      expectedCommands.forEach((id) => {
        assert.ok(registeredCommands.has(id), `Comando ${id} deve estar registrado`);
      });

      assert.ok(
        (treeViewState.description ?? "").length > 0,
        "A view deve exibir o cabeçalho agregado dos servidores"
      );

      // recarregar via comando não pode lançar
      await (registeredCommands.get("paje.refreshTree") as () => Promise<void>)();
      assert.ok(treeProvider!.getChildren().length > 0, "Recarregar deve manter a árvore populada");

      assert.ok(context.subscriptions.length >= 6, "Ativação deve registrar descartáveis no contexto");
    } finally {
      moduleLoader._load = originalLoad;
    }

    console.log("vscode_extension_smoke_test: OK");
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRepos, { recursive: true, force: true });
  }
}
