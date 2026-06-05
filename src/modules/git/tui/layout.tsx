import React, { useMemo } from "react";
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
import { BranchModal, type BranchChoice } from "./components/BranchModal.js";
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
  helpContext?: HelpContext;
  onHelpShortcut?: (input: string, key: Key) => void;
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
  helpContext,
  onHelpShortcut,
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
  const terminalHeight = stdout?.rows ?? 24;
  const terminalWidth = stdout?.columns ?? 80;
  const headerLeft = useMemo(() => formatHeaderLeft(title, breadcrumbs), [title, breadcrumbs]);
  const globalLogEntries = useLogEntries();
  const resolvedLogEntries = logEntries ?? globalLogEntries;
  const workspaceLegend = workspaceLabel ?? title;
  const modalWidth = Math.max(40, Math.min(terminalWidth - 4, 120));
  const modalHeight = Math.max(10, Math.min(terminalHeight - 4, 30));
  const modalLeft = Math.max(0, Math.floor((terminalWidth - modalWidth) / 2));
  const modalTop = Math.max(0, Math.floor((terminalHeight - modalHeight) / 2));
  const resolvedParameters = parameters ?? [];
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

  useInput((input = "", key) => {
    const lower = typeof input === "string" ? input.toLowerCase() : "";
    if (key.escape) {
      debugLogger.info(
        `[TUI][ESC] layout escapeEnabled=${escapeEnabled} modalOpen=${modalState.modalOpen} logMax=${panelState.logMaximized} workspaceMax=${panelState.workspaceMaximized}`
      );
      if (!escapeEnabled) {
        debugLogger.info("[TUI][ESC] layout ignored (escapeEnabled=false)");
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
    if (key.ctrl && lower === "h") {
      modalState.openModal("help");
      return;
    }
    if (key.ctrl && lower === "p") {
      modalState.toggleModal();
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
    if (key.ctrl && input === "c") {
      onCtrlC?.();
      exit();
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
