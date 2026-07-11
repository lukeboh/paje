import React, { createContext, useContext, useMemo, useState } from "react";

export type LayoutMetrics = {
  workspaceHeight: number;
  logHeight: number;
};

export type PanelState = {
  logMaximized: boolean;
  workspaceMaximized: boolean;
  toggleLog: () => void;
  toggleWorkspace: () => void;
  resetPanels: () => void;
};

export type ModalType = "parameters" | "branch" | "help" | "edit-params";

export type ModalState = {
  modalOpen: boolean;
  modalType?: ModalType;
  toggleModal: () => void;
  openModal: (type: ModalType) => void;
  closeModal: () => void;
};

export const useModalStateController = (): ModalState => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ModalType | undefined>(undefined);

  const toggleModal = (): void => {
    setModalOpen((current) => {
      if (current && modalType === "parameters") {
        setModalType(undefined);
        return false;
      }
      setModalType("parameters");
      return true;
    });
  };

  const openModal = (type: ModalType): void => {
    setModalType(type);
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalType(undefined);
    setModalOpen(false);
  };

  return useMemo(
    () => ({
      modalOpen,
      modalType,
      toggleModal,
      openModal,
      closeModal,
    }),
    [modalOpen, modalType]
  );
};

const LayoutMetricsContext = createContext<LayoutMetrics>({
  workspaceHeight: 0,
  logHeight: 0,
});

const PanelStateContext = createContext<PanelState>({
  logMaximized: false,
  workspaceMaximized: false,
  toggleLog: () => undefined,
  toggleWorkspace: () => undefined,
  resetPanels: () => undefined,
});

const ModalStateContext = createContext<ModalState>({
  modalOpen: false,
  modalType: undefined,
  toggleModal: () => undefined,
  openModal: () => undefined,
  closeModal: () => undefined,
});

export const LayoutMetricsProvider = LayoutMetricsContext.Provider;
export const PanelStateProvider = PanelStateContext.Provider;
export const ModalStateProvider = ModalStateContext.Provider;

export const useLayoutMetrics = (): LayoutMetrics => {
  return useContext(LayoutMetricsContext);
};

export const usePanelState = (): PanelState => {
  return useContext(PanelStateContext);
};

export const useLayoutModal = (): ModalState => {
  return useContext(ModalStateContext);
};

export type PanelStateInitial = {
  logMaximized?: boolean;
  workspaceMaximized?: boolean;
};

export const usePanelStateController = (initial?: PanelStateInitial): PanelState => {
  const [logMaximized, setLogMaximized] = useState(Boolean(initial?.logMaximized));
  const [workspaceMaximized, setWorkspaceMaximized] = useState(Boolean(initial?.workspaceMaximized));

  const toggleLog = (): void => {
    setLogMaximized((current) => {
      const next = !current;
      if (next) {
        setWorkspaceMaximized(false);
      }
      return next;
    });
  };

  const toggleWorkspace = (): void => {
    setWorkspaceMaximized((current) => {
      const next = !current;
      if (next) {
        setLogMaximized(false);
      }
      return next;
    });
  };

  const resetPanels = (): void => {
    setLogMaximized(false);
    setWorkspaceMaximized(false);
  };

  return useMemo(
    () => ({
      logMaximized,
      workspaceMaximized,
      toggleLog,
      toggleWorkspace,
      resetPanels,
    }),
    [logMaximized, workspaceMaximized]
  );
};
