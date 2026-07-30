import * as vscode from "vscode";
import fs from "node:fs";
import { setLocale, t } from "../../src/i18n/index.js";
import {
  createGitSyncCore,
  mergeServer,
  withToken,
  type GitServerEntry,
  type GitSyncTreeView,
} from "../../src/modules/git/core/gitSyncService.js";
import { resolveGitSyncConfig } from "../../src/modules/git/core/gitSyncConfig.js";
import type { GitSyncConfig } from "../../src/modules/git/core/gitSyncConfig.js";
import { LoggerBroker } from "../../src/modules/git/core/loggerBroker.js";
import { createFileTransport, createPanelTransport } from "../../src/modules/git/core/loggerTransports.js";
import { resolveEnvFileFromCli } from "../../src/modules/git/core/envResolver.js";
import { ensureGitLabPersonalAccessToken } from "../../src/modules/git/sshManager.js";
import { readGitServers, writeGitServers } from "../../src/modules/git/persistence.js";
import {
  collectProjectNodesFromNode,
  recomputeTreeSelection,
  toggleTreeNode,
} from "../../src/modules/git/treeBuilder.js";
import type { GitLabTreeNode } from "../../src/modules/git/types.js";
import { PajeTreeProvider } from "./pajeTreeProvider.js";

const resolveConfig = (): GitSyncConfig => {
  // Same resolution pipeline as the CLI/TUI (env.yaml + built-in defaults),
  // just without CLI flags — the extension is a third presentation layer.
  const { config } = resolveGitSyncConfig({}, () => false, () => undefined);
  return config;
};

export const activate = (context: vscode.ExtensionContext): void => {
  setLocale(vscode.env.language.toLowerCase().startsWith("pt") ? "pt_BR" : "en_US");

  const channel = vscode.window.createOutputChannel("PAJÉ");
  const logger = new LoggerBroker();
  logger.addTransport(
    createPanelTransport("vscode-output", "info", (message) => channel.appendLine(message))
  );
  logger.addTransport(createFileTransport("file", "info"));

  const provider = new PajeTreeProvider();
  const treeView = vscode.window.createTreeView("pajeRepositories", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const core = createGitSyncCore();
  let currentView: GitSyncTreeView | null = null;
  let loading = false;

  const loadTree = async (): Promise<void> => {
    if (loading) {
      return;
    }
    loading = true;
    try {
      const config = resolveConfig();
      currentView = await core.loadTree({
        config,
        logger,
        onMissingCredentials: async (server: GitServerEntry, reason: "missing" | "invalid") => {
          const resolvedUsername = server.username?.trim();
          if (!resolvedUsername) {
            return null;
          }
          const promptKey = reason === "invalid" ? "vscodeExt.tokenExpiredPasswordPrompt" : "vscodeExt.passwordPrompt";
          const password = await vscode.window.showInputBox({
            prompt: t(promptKey, { server: server.name, username: resolvedUsername }),
            password: true,
            ignoreFocusOut: true,
          });
          if (!password) {
            return null;
          }
          try {
            const tokenResult = await ensureGitLabPersonalAccessToken({
              baseUrl: server.baseUrl,
              name: server.tokenName?.trim() || "paje",
              credentials: { username: resolvedUsername, password, source: "prompt" },
              fetchImpl: globalThis.fetch,
              logger: (message) => logger.info(message),
            });
            const existingServers = readGitServers<GitServerEntry[]>([]);
            const merged = mergeServer(existingServers, withToken(server, tokenResult.token));
            writeGitServers(merged.servers);
            return { token: tokenResult.token };
          } catch {
            return null;
          }
        },
        onStatusRefreshed: (projectId, status) => provider.applyStatus(projectId, status),
      });
      provider.setNodes(currentView.tree);
      treeView.description = currentView.header;
      if (currentView.tree.length === 0) {
        void vscode.window.showWarningMessage(t("vscodeExt.noServers"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      void vscode.window.showErrorMessage(t("vscodeExt.loadError", { message }));
    } finally {
      loading = false;
    }
  };

  const runSync = async (selectedProjects?: GitLabTreeNode[]): Promise<void> => {
    if (!currentView) {
      void vscode.window.showWarningMessage(t("vscodeExt.treeNotLoaded"));
      return;
    }
    const tree = currentView.tree;
    const projects = selectedProjects
      ?.flatMap((node) => collectProjectNodesFromNode(node))
      .map((node) => node.project)
      .filter((project): project is NonNullable<typeof project> => Boolean(project));

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("vscodeExt.syncTitle"),
        cancellable: false,
      },
      async (progress) => {
        let total = 0;
        let done = 0;
        let failed = 0;
        await core.syncSelected({
          config: resolveConfig(),
          logger,
          tree,
          selectedProjects: projects,
          handlers: {
            onBegin: (totalCount) => {
              total = totalCount;
              progress.report({ message: `0/${totalCount}` });
            },
            onResult: (result) => {
              done += 1;
              if (result.status === "failed") {
                failed += 1;
              }
              progress.report({
                increment: total > 0 ? 100 / total : undefined,
                message: `${done}/${total} — ${result.target.pathWithNamespace}`,
              });
            },
          },
        });
        const messageKey = failed > 0 ? "vscodeExt.syncDoneWithFailures" : "vscodeExt.syncDone";
        const show = failed > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
        void show(t(messageKey, { total: String(done), failed: String(failed) }));
      }
    );
    // Cache hit makes this instant; refreshes the per-repo statuses.
    await loadTree();
  };

  context.subscriptions.push(
    channel,
    treeView,
    treeView.onDidChangeCheckboxState((event) => {
      for (const [node, state] of event.items) {
        toggleTreeNode(node, state === vscode.TreeItemCheckboxState.Checked);
      }
      provider.getNodes().forEach((node) => recomputeTreeSelection(node));
      provider.refresh();
    }),
    vscode.commands.registerCommand("paje.refreshTree", () => loadTree()),
    vscode.commands.registerCommand("paje.syncSelected", () => runSync()),
    vscode.commands.registerCommand("paje.syncNode", (node: GitLabTreeNode | undefined) => {
      if (!node) {
        return runSync();
      }
      return runSync([node]);
    }),
    vscode.commands.registerCommand("paje.openRepository", (node: GitLabTreeNode | undefined) => {
      const localPath = node?.localPath;
      if (!localPath || !fs.existsSync(localPath)) {
        void vscode.window.showWarningMessage(t("vscodeExt.repoNotCloned"));
        return;
      }
      void vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(localPath), {
        forceNewWindow: true,
      });
    }),
    vscode.commands.registerCommand("paje.openEnvFile", async () => {
      const envFile = resolveEnvFileFromCli(undefined);
      if (!envFile) {
        return;
      }
      if (!fs.existsSync(envFile)) {
        void vscode.window.showWarningMessage(t("vscodeExt.envFileMissing", { path: envFile }));
        return;
      }
      const document = await vscode.workspace.openTextDocument(envFile);
      await vscode.window.showTextDocument(document);
    })
  );

  void loadTree();
};

export const deactivate = (): void => {
  // Nothing to clean up: subscriptions are disposed by VSCode.
};
