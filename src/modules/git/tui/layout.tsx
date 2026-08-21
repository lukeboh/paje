import React, { useMemo, useState } from "react";
import { useLogEntries } from "./logStore.js";
import { Box, Text, useApp, useInput, useStdout, type Key } from "ink";
import type { CommandParameters } from "../core/parameters.js";
import type { LogEntry } from "./logger.js";
import { LayoutMetricsProvider, ModalStateProvider, PanelStateProvider, useModalStateController, usePanelStateController } from "./layoutContext.js";
import { LoggerPanel } from "./components/LoggerPanel.js";
import { OrientationBar } from "./components/OrientationBar.js";
import { TitleBar } from "./components/TitleBar.js";
import { Workspace } from "./components/Workspace.js";
import { PanelFrame } from "./components/PanelFrame.js";
import { ParametersModal } from "./components/ParametersModal.js";
import { EditParamsModal } from "./components/EditParamsModal.js";
import { BranchModal, type BranchChoice } from "./components/BranchModal.js";
import { ExcludeModal } from "./components/ExcludeModal.js";
import { ConfirmModal } from "./components/ConfirmModal.js";
import { TextInputModal } from "./components/TextInputModal.js";
import { HelpModal, type HelpContext } from "./components/HelpModal.js";
import { t } from "../../../i18n/index.js";
import { PajeLogger } from "../logger.js";

export type LayoutProps = {
  title: string;
  breadcrumbs?: string[];
  orientation: string;
  logEntries?: LogEntry[];
  parameters?: CommandParameters[];
  workspaceLabel?: string;
  initialLogMaximized?: boolean;
  initialWorkspaceMaximized?: boolean;
  modalState?: ReturnType<typeof useModalStateController>;
  onEscape?: () => void;
  onCtrlC?: () => void;
  escapeEnabled?: boolean;
  branchModal?: {
    branches: string[];
    currentBranch?: string;
    onConfirm: (choice: BranchChoice) => void;
    onCancel: () => void;
  };
  excludeModal?: {
    label: string;
    pattern: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  confirmModal?: {
    title: string;
    message: string;
    detail?: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  textInputModal?: {
    title: string;
    label: string;
    initialValue?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  };
  helpContext?: HelpContext;
  onHelpShortcut?: (input: string, key: Key) => void;
  envFilePath?: string;
  helpOnBackspace?: boolean;
  children: React.ReactNode;
};

const formatHeaderLeft = (title: string, breadcrumbs?: string[]): string => {
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return title;
  }
  return `${title} > ${breadcrumbs.join(" > ")}`;
};

export const Layout: React.FC<LayoutProps> = ({
  title,
  breadcrumbs,
  orientation,
  logEntries,
  parameters,
  workspaceLabel,
  initialLogMaximized,
  initialWorkspaceMaximized,
  modalState: modalStateOverride,
  onEscape,
  onCtrlC,
  escapeEnabled = true,
  branchModal,
  excludeModal,
  confirmModal,
  textInputModal,
  helpContext,
  onHelpShortcut,
  envFilePath,
  helpOnBackspace = false,
  children,
}) => {
  const panelState = usePanelStateController({
    logMaximized: initialLogMaximized,
    workspaceMaximized: initialWorkspaceMaximized,
  });
  const debugLogger = useMemo(() => new PajeLogger(), []);
  const modalState = modalStateOverride ?? useModalStateController();
  const { exit } = useApp();
  const { stdout } = useStdout();
  // One row below the terminal height: when a frame is as tall as the
  // terminal, Ink abandons incremental rendering and clears the whole screen
  // (ESC[2J) on every frame — the entire TUI flashes on each update,
  // painfully so over SSH. Staying below the threshold keeps Ink on the
  // erase-lines path: a single atomic write per frame, no blank flash.
  const terminalHeight = Math.max(8, (stdout?.rows ?? 24) - 1);
  const terminalWidth = stdout?.columns ?? 80;
  const headerLeft = useMemo(() => formatHeaderLeft(title, breadcrumbs), [title, breadcrumbs]);
  const globalLogEntries = useLogEntries();
  const resolvedLogEntries = logEntries ?? globalLogEntries;
  const workspaceLegend = workspaceLabel ?? title;
  const modalWidth = Math.max(40, Math.min(terminalWidth - 4, 120));
  const modalHeight = Math.max(10, Math.min(terminalHeight - 4, 30));
  const modalLeft = Math.max(0, Math.floor((terminalWidth - modalWidth) / 2));
  const modalTop = Math.max(0, Math.floor((terminalHeight - modalHeight) / 2));
  // Values written to ~/.paje/env.yaml via the editor (Ctrl+E) this session.
  // `parameters` is a one-time snapshot the caller took before the tree/menu
  // screen mounted and is never re-fetched from disk; EditParamsModal itself
  // unmounts every time the modal closes (see the conditional render below),
  // so any state it kept locally about a just-saved value was lost the
  // moment the user closed and reopened the editor. Holding the overrides
  // here — in Layout, which stays mounted for the whole screen — is what
  // makes a saved value keep showing instead of reverting to the stale
  // snapshot.
  const [envOverrides, setEnvOverrides] = useState<Map<string, string>>(new Map());
  const resolvedParameters = useMemo(() => {
    const base = parameters ?? [];
    if (envOverrides.size === 0) {
      return base;
    }
    return base.map((group) => ({
      ...group,
      parameters: group.parameters.map((param) =>
        envOverrides.has(param.name)
          ? { ...param, value: envOverrides.get(param.name)!, source: "env" as const }
          : param
      ),
    }));
  }, [parameters, envOverrides]);
  const modalBackgroundColor = "#2C2C2C";
  const modalBackgroundLines = useMemo(
    () => Array.from({ length: modalHeight }, () => " ".repeat(Math.max(1, modalWidth))),
    [modalHeight, modalWidth]
  );

  const layoutMetrics = useMemo(() => {
    const titleHeight = 1;
    const orientationHeight = 1;
    const containerHeight = Math.max(0, terminalHeight - titleHeight);
    const availablePanelsHeight = Math.max(0, containerHeight - orientationHeight);
    const FRAME_DECORATION = 2;
    const FRAME_HEADER_HEIGHT = 1;
    const MIN_CONTENT_HEIGHT = 2;
    const MIN_FRAME_HEIGHT = FRAME_DECORATION + FRAME_HEADER_HEIGHT + MIN_CONTENT_HEIGHT;

    const computeFrameHeight = (total: number): number => {
      if (total <= 0) {
        return 0;
      }
      return Math.min(availablePanelsHeight, Math.max(MIN_FRAME_HEIGHT, total));
    };

    const desiredLogFrame = panelState.logMaximized
      ? availablePanelsHeight
      : panelState.workspaceMaximized
      ? Math.min(FRAME_DECORATION, availablePanelsHeight)
      : Math.max(MIN_FRAME_HEIGHT, Math.round(availablePanelsHeight * 0.2));

    let logFrameHeight = computeFrameHeight(desiredLogFrame);
    let workspaceFrameHeight = panelState.logMaximized ? 0 : availablePanelsHeight - logFrameHeight;

    if (panelState.workspaceMaximized) {
      workspaceFrameHeight = computeFrameHeight(availablePanelsHeight);
      logFrameHeight = Math.max(0, availablePanelsHeight - workspaceFrameHeight);
    }

    if (!panelState.logMaximized && !panelState.workspaceMaximized) {
      if (workspaceFrameHeight > 0 && workspaceFrameHeight < MIN_FRAME_HEIGHT && availablePanelsHeight >= MIN_FRAME_HEIGHT * 2) {
        const deficit = MIN_FRAME_HEIGHT - workspaceFrameHeight;
        workspaceFrameHeight += deficit;
        logFrameHeight = Math.max(0, logFrameHeight - deficit);
      }
      if (logFrameHeight > 0 && logFrameHeight < MIN_FRAME_HEIGHT && availablePanelsHeight >= MIN_FRAME_HEIGHT * 2) {
        const deficit = MIN_FRAME_HEIGHT - logFrameHeight;
        logFrameHeight += deficit;
        workspaceFrameHeight = Math.max(0, workspaceFrameHeight - deficit);
      }
    }

    if (logFrameHeight < 0) {
      logFrameHeight = 0;
    }
    if (workspaceFrameHeight < 0) {
      workspaceFrameHeight = 0;
    }

    const normalize = logFrameHeight + workspaceFrameHeight;
    if (normalize > availablePanelsHeight && normalize > 0) {
      const scale = availablePanelsHeight / normalize;
      logFrameHeight = Math.max(FRAME_DECORATION, Math.floor(logFrameHeight * scale));
      workspaceFrameHeight = Math.max(FRAME_DECORATION, Math.floor(workspaceFrameHeight * scale));
    }

    if (panelState.logMaximized) {
      logFrameHeight = availablePanelsHeight;
      workspaceFrameHeight = 0;
    }
    if (panelState.workspaceMaximized) {
      workspaceFrameHeight = availablePanelsHeight;
      logFrameHeight = 0;
    }

    const computeContentHeight = (frameHeight: number): number => {
      if (frameHeight <= 0) {
        return 0;
      }
      const interiorHeight = frameHeight - (FRAME_DECORATION + FRAME_HEADER_HEIGHT);
      return Math.max(0, interiorHeight);
    };

    const workspaceContentHeight = computeContentHeight(workspaceFrameHeight);
    const logContentHeight = computeContentHeight(logFrameHeight);

    return {
      containerHeight,
      workspaceFrameHeight,
      logFrameHeight,
      workspaceContentHeight,
      logContentHeight,
    };
  }, [terminalHeight, panelState.logMaximized, panelState.workspaceMaximized]);

  React.useEffect(() => {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(true);
      } catch {}
    }
  }, []);

  useInput((input = "", key) => {
    const lower = typeof input === "string" ? input.toLowerCase() : "";
    // Ctrl+C must always work, even with a modal open.
    if (key.ctrl && input === "c") {
      onCtrlC?.();
      exit();
      return;
    }
    // Workflow modals own the keyboard while open: edit-params handles its own
    // Esc (cancel edit vs close) and branch handles its own Esc (onCancel).
    // Switching to another modal from here would silently discard their state.
    const workflowModalOpen =
      modalState.modalOpen &&
      (modalState.modalType === "edit-params" || modalState.modalType === "branch");
    if (key.escape) {
      debugLogger.info(
        `[TUI][ESC] layout escapeEnabled=${escapeEnabled} modalOpen=${modalState.modalOpen} logMax=${panelState.logMaximized} workspaceMax=${panelState.workspaceMaximized}`
      );
      if (!escapeEnabled) {
        debugLogger.info("[TUI][ESC] layout ignored (escapeEnabled=false)");
        return;
      }
      if (workflowModalOpen) {
        debugLogger.info("[TUI][ESC] layout deferring ESC to workflow modal");
        return;
      }
      if (modalState.modalOpen) {
        debugLogger.info("[TUI][ESC] layout closing modal");
        modalState.closeModal();
        return;
      }
      if (panelState.logMaximized || panelState.workspaceMaximized) {
        debugLogger.info("[TUI][ESC] layout resetting panels");
        panelState.resetPanels();
        return;
      }
      debugLogger.info("[TUI][ESC] layout delegating onEscape");
      onEscape?.();
      return;
    }
    if (workflowModalOpen) {
      return;
    }
    // Terminals send byte 0x08 for Ctrl+H, which Ink reports as key.backspace
    // (the physical Backspace key sends 0x7f = key.delete). Accepting
    // key.backspace here is opt-in per screen so text prompts keep erasing.
    if ((key.ctrl && lower === "h") || (helpOnBackspace && key.backspace)) {
      modalState.openModal("help");
      return;
    }
    if (key.ctrl && lower === "p") {
      modalState.toggleModal();
      return;
    }
    if (key.ctrl && lower === "e") {
      modalState.openModal("edit-params");
      return;
    }
    if (modalState.modalOpen) {
      return;
    }
    if (key.ctrl && lower === "l") {
      panelState.toggleLog();
      return;
    }
    if (key.ctrl && lower === "w") {
      panelState.toggleWorkspace();
      return;
    }
  });

  return (
    <PanelStateProvider value={panelState}>
      <ModalStateProvider value={modalState}>
        <LayoutMetricsProvider
          value={{
            workspaceHeight: layoutMetrics.workspaceContentHeight,
            logHeight: layoutMetrics.logContentHeight,
          }}
        >
          <Box flexDirection="column" width="100%" height={terminalHeight}>
            <TitleBar left={headerLeft} right={t("layout.rightTitle")} />
            <Box flexDirection="column" width="100%" height={layoutMetrics.containerHeight}>
              <PanelFrame title={workspaceLegend} height={layoutMetrics.workspaceFrameHeight}>
                <Workspace height={layoutMetrics.workspaceContentHeight}>{children}</Workspace>
              </PanelFrame>
              <OrientationBar message={orientation} />
              <PanelFrame title={t("layout.logTitle")} height={layoutMetrics.logFrameHeight}>
                <LoggerPanel entries={resolvedLogEntries} height={layoutMetrics.logContentHeight} />
              </PanelFrame>
            </Box>
            {modalState.modalOpen ? (
              <>
                <Box position="absolute" marginLeft={modalLeft} marginTop={modalTop}>
                  <Box flexDirection="column" width={modalWidth} height={modalHeight}>
                    {modalBackgroundLines.map((line, index) => (
                      <Text key={`modal-bg-${index}`} backgroundColor={modalBackgroundColor} color={modalBackgroundColor}>
                        {line}
                      </Text>
                    ))}
                  </Box>
                </Box>
                <Box position="absolute" marginLeft={modalLeft} marginTop={modalTop}>
                  {modalState.modalType === "branch" && branchModal ? (
                    <BranchModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      branches={branchModal.branches}
                      currentBranch={branchModal.currentBranch}
                      onConfirm={branchModal.onConfirm}
                      onCancel={branchModal.onCancel}
                    />
                  ) : modalState.modalType === "exclude" && excludeModal ? (
                    <ExcludeModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      label={excludeModal.label}
                      pattern={excludeModal.pattern}
                      onConfirm={excludeModal.onConfirm}
                      onCancel={excludeModal.onCancel}
                    />
                  ) : modalState.modalType === "confirm" && confirmModal ? (
                    <ConfirmModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      title={confirmModal.title}
                      message={confirmModal.message}
                      detail={confirmModal.detail}
                      onConfirm={confirmModal.onConfirm}
                      onCancel={confirmModal.onCancel}
                    />
                  ) : modalState.modalType === "text-input" && textInputModal ? (
                    <TextInputModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      title={textInputModal.title}
                      label={textInputModal.label}
                      initialValue={textInputModal.initialValue}
                      onConfirm={textInputModal.onConfirm}
                      onCancel={textInputModal.onCancel}
                    />
                  ) : modalState.modalType === "help" ? (
                    <HelpModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      context={helpContext ?? "menu"}
                      logMaximized={panelState.logMaximized}
                      workspaceMaximized={panelState.workspaceMaximized}
                      onClose={() => modalState.closeModal()}
                      onShortcut={(input, key) => onHelpShortcut?.(input, key)}
                    />
                  ) : modalState.modalType === "edit-params" ? (
                    <EditParamsModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      parameters={resolvedParameters}
                      envFilePath={envFilePath}
                      onClose={() => modalState.closeModal()}
                      onSaved={(updates) =>
                        setEnvOverrides((prev) => {
                          const next = new Map(prev);
                          Object.entries(updates).forEach(([key, value]) => next.set(key, value));
                          return next;
                        })
                      }
                    />
                  ) : (
                    <ParametersModal
                      isOpen={modalState.modalOpen}
                      width={modalWidth}
                      height={modalHeight}
                      parameters={resolvedParameters}
                    />
                  )}
                </Box>
              </>
            ) : null}
          </Box>
        </LayoutMetricsProvider>
      </ModalStateProvider>
    </PanelStateProvider>
  );
};
