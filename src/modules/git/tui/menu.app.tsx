import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useInput } from "ink";
import type { CommandParameters } from "../core/parameters.js";
import { Layout } from "./layout.js";
import { useModalStateController } from "./layoutContext.js";
import { appendLogEntry } from "./logStore.js";
import { t } from "../../../i18n/index.js";
import { PajeLogger } from "../logger.js";

export type MenuItem = {
  label: string;
  command: string;
  description: string;
  shortcut: string;
};

type MenuDashboardProps = {
  items: MenuItem[];
  selectedIndex: number;
};

export const MenuDashboard: React.FC<MenuDashboardProps> = ({ items, selectedIndex }) => {
  const selectedItem = items[selectedIndex];
  const description = selectedItem?.description ?? "";
  const commandHint = selectedItem ? t("menu.commandHint", { command: selectedItem.command }) : "";

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="row" width="100%" justifyContent="space-between">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box
              key={item.command}
              flexDirection="column"
              width="48%"
              borderStyle="round"
              borderColor={isSelected ? "cyan" : "gray"}
              paddingX={1}
            >
              <Text color={isSelected ? "cyan" : undefined}>{`${item.shortcut} — ${item.label}`}</Text>
              <Text dimColor>{`(${item.command})`}</Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">{t("menu.descriptionLabel")}</Text>
        <Text>{description}</Text>
        {commandHint && <Text dimColor>{commandHint}</Text>}
      </Box>
    </Box>
  );
};

export const MENU_ORIENTATION_MESSAGE = t("menu.orientation");

export const renderMenu = async (
  items: MenuItem[],
  parameters: CommandParameters[] = [],
  options?: { suppressInitialEscapeMs?: number; appendLog?: (message: string) => void }
): Promise<MenuItem | null> => {
  return new Promise((resolve) => {
    const resolveRef = { current: resolve };
    const resolvedRef = { current: false };
    const unmountRef: { current?: () => void } = {};
    const loggerRef: { current?: PajeLogger } = {};
    const instanceRef = { current: "menu-unknown" };

    const finalize = (result: MenuItem | null): void => {
      if (resolvedRef.current) {
        return;
      }
      resolvedRef.current = true;
      const command = result?.command ?? "null";
      loggerRef.current?.info(
        `[TUI][MENU] finalize instance=${instanceRef.current} result=${command} resolved=${resolvedRef.current}`
      );
      if (unmountRef.current) {
        unmountRef.current();
      }
      resolveRef.current(result);
    };

    const App: React.FC = () => {
      const [selectedIndex, setSelectedIndex] = useState(0);
      const modalState = useModalStateController();
      const parametersSnapshot = parameters;
      const suppressInitialEscapeMs = options?.suppressInitialEscapeMs ?? 0;
      const [escapeEnabled, setEscapeEnabled] = useState(suppressInitialEscapeMs === 0);
      const debugLogger = useMemo(() => new PajeLogger(), []);
      const instanceId = useMemo(() => `menu-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, []);

      const appendLog = options?.appendLog ?? ((message: string): void => {
        appendLogEntry(message, "debug");
      });

      useEffect(() => {
        loggerRef.current = debugLogger;
        instanceRef.current = instanceId;
        appendLog(t("menu.log.selectFeature"));
        debugLogger.info(
          `[TUI][MENU] mount instance=${instanceId} suppressInitialEscapeMs=${suppressInitialEscapeMs} escapeEnabled=${escapeEnabled}`
        );
        return () => {
          debugLogger.info(`[TUI][MENU] unmount instance=${instanceId}`);
        };
      }, [suppressInitialEscapeMs, debugLogger, instanceId, escapeEnabled]);

      useEffect(() => {
        if (suppressInitialEscapeMs <= 0) {
          return;
        }
        debugLogger.info(
          `[TUI][MENU] escapeEnabled=false (timeout armed ${suppressInitialEscapeMs}ms) instance=${instanceId}`
        );
        const timeoutId = setTimeout(() => {
          setEscapeEnabled(true);
          debugLogger.info(
            `[TUI][MENU] escapeEnabled=true (timeout ${suppressInitialEscapeMs}ms) instance=${instanceId}`
          );
        }, suppressInitialEscapeMs);
        return () => {
          clearTimeout(timeoutId);
          debugLogger.info(`[TUI][MENU] timeout cleared instance=${instanceId}`);
        };
      }, [suppressInitialEscapeMs, debugLogger, instanceId]);

      const clampIndex = (nextIndex: number): number => {
        if (items.length === 0) {
          return 0;
        }
        return Math.max(0, Math.min(items.length - 1, nextIndex));
      };

      useInput(
        (input, key) => {
          const normalizedInput = input.toLowerCase();
          if (key.escape || key.return || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.tab) {
            debugLogger.info(
              `[TUI][MENU] key input=${JSON.stringify(input)} escape=${Boolean(key.escape)} return=${Boolean(
                key.return
              )} arrows=${[key.leftArrow, key.rightArrow, key.upArrow, key.downArrow].some(Boolean)} tab=${Boolean(
                key.tab
              )} escapeEnabled=${escapeEnabled} instance=${instanceId}`
            );
          }
          if (!escapeEnabled) {
            if (key.escape) {
              debugLogger.info(`[TUI][MENU] ignoring ESC while escapeEnabled=false instance=${instanceId}`);
              return;
            }
            if (input) {
              setEscapeEnabled(true);
              debugLogger.info(`[TUI][MENU] escapeEnabled=true (input) instance=${instanceId}`);
            }
          }
          if (key.ctrl && normalizedInput === "s") {
            const selected = items[0];
            if (selected) {
              appendLog(t("menu.log.selected", { label: selected.label }));
              finalize(selected);
            }
            return;
          }
          if (key.ctrl && normalizedInput === "g") {
            const selected = items[clampIndex(1)];
            if (selected) {
              appendLog(t("menu.log.selected", { label: selected.label }));
              finalize(selected);
            }
            return;
          }
          if (key.leftArrow || key.upArrow) {
            setSelectedIndex((value: number) => {
              const nextIndex = clampIndex(value - 1);
              const selected = items[nextIndex];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
              }
              return nextIndex;
            });
          }
          if (key.rightArrow || key.downArrow || key.tab) {
            setSelectedIndex((value: number) => {
              const nextIndex = clampIndex(value + 1);
              const selected = items[nextIndex];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
              }
              return nextIndex;
            });
          }
          if (key.return) {
            finalize(items[clampIndex(selectedIndex)] ?? null);
          }
          if (normalizedInput === "1") {
            setSelectedIndex(0);
            const selected = items[0];
            if (selected) {
              appendLog(t("menu.log.selected", { label: selected.label }));
            }
          }
          if (normalizedInput === "2") {
            setSelectedIndex(clampIndex(1));
            const selected = items[clampIndex(1)];
            if (selected) {
              appendLog(t("menu.log.selected", { label: selected.label }));
            }
          }
        },
        { isActive: !modalState.modalOpen }
      );

      return (
        <Layout
          title={t("app.menuTitle")}
          workspaceLabel={t("menu.workspaceLabel")}
          orientation={t("menu.orientation")}
          parameters={parametersSnapshot}
          modalState={modalState}
          escapeEnabled={escapeEnabled}
          helpContext="menu"
          onHelpShortcut={(input, key) => {
            const normalizedInput = input.toLowerCase();
            if (normalizedInput === "s") {
              const selected = items[0];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
                finalize(selected);
              }
              return;
            }
            if (normalizedInput === "g") {
              const selected = items[clampIndex(1)];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
                finalize(selected);
              }
              return;
            }
            if (key.leftArrow || key.upArrow) {
              setSelectedIndex((value: number) => {
                const nextIndex = clampIndex(value - 1);
                const selected = items[nextIndex];
                if (selected) {
                  appendLog(t("menu.log.selected", { label: selected.label }));
                }
                return nextIndex;
              });
            }
            if (key.rightArrow || key.downArrow || key.tab) {
              setSelectedIndex((value: number) => {
                const nextIndex = clampIndex(value + 1);
                const selected = items[nextIndex];
                if (selected) {
                  appendLog(t("menu.log.selected", { label: selected.label }));
                }
                return nextIndex;
              });
            }
            if (key.return) {
              finalize(items[clampIndex(selectedIndex)] ?? null);
            }
            if (normalizedInput === "1") {
              setSelectedIndex(0);
              const selected = items[0];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
              }
            }
            if (normalizedInput === "2") {
              setSelectedIndex(clampIndex(1));
              const selected = items[clampIndex(1)];
              if (selected) {
                appendLog(t("menu.log.selected", { label: selected.label }));
              }
            }
          }}
          onEscape={() => {
            debugLogger.info(`[TUI][MENU] onEscape -> finalize(null) instance=${instanceId}`);
            finalize(null);
          }}
        >
          <MenuDashboard items={items} selectedIndex={selectedIndex} />
        </Layout>
      );
    };

    const { unmount } = render(<App />);
    unmountRef.current = unmount;
  });
};
