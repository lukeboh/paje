import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import type { CommandParameters } from "./core/parameters.js";
import { Layout } from "./tui/layout.js";
import { useLayoutMetrics, useModalStateController } from "./tui/layoutContext.js";
import { appendLogEntry } from "./tui/logStore.js";
import { t } from "../../i18n/index.js";

export type ListChoice<T> = {
  label: string;
  value: T;
  description?: string;
};

export type TuiSession = {
  promptInput: (options: { title: string; message: string; defaultValue?: string; description?: string }) => Promise<string | null>;
  promptPassword: (options: { title: string; message: string; description?: string }) => Promise<string | null>;
  promptList: <T>(options: { title: string; message: string; choices: ListChoice<T>[] }) => Promise<T | null>;
  promptForm: <T extends Record<string, string>>(options: {
    title: string;
    fields: { name: keyof T; label: string; defaultValue?: string; secret?: boolean; description?: string }[];
  }) => Promise<T | null>;
  promptConfirm: (options: { title: string; message: string; defaultValue?: boolean }) => Promise<boolean | null>;
  showInlineError: (message: string) => void;
  showMessage: (options: { title: string; message: string }) => Promise<void>;
  setParameters: (parameters: CommandParameters[]) => void;
  getParameters: () => CommandParameters[];
  destroy: () => void;
};

export const buildOrientation = (base: string, description?: string, error?: string): string => {
  const parts = [base];
  if (description) {
    parts.push(description.trim());
  }
  if (error) {
    parts.push(t("session.errorPrefix", { error }));
  }
  return parts.filter(Boolean).join(" | ");
};

type PromptResolver<T> = {
  finalize: (value: T) => void;
  setUnmount: (unmount: () => void) => void;
};

const createPromptResolver = <T,>(resolve: (value: T) => void): PromptResolver<T> => {
  const resolvedRef = { current: false };
  const unmountRef: { current?: () => void } = {};

  const finalize = (value: T): void => {
    if (resolvedRef.current) {
      return;
    }
    resolvedRef.current = true;
    // Unmount before resolving (both deferred to the next tick, to avoid tearing
    // down the tree from inside Ink's own input handler). Ink caches a single
    // instance per stdout, so if resolve() ran first, the caller's `await` could
    // chain straight into the next prompt's render() — landing on the still-live
    // instance — before this unmount() fires and pulls it out from under that
    // new prompt (killing its input listeners and hanging the promise forever).
    setTimeout(() => {
      unmountRef.current?.();
      resolve(value);
    }, 0);
  };

  const setUnmount = (unmount: () => void): void => {
    unmountRef.current = unmount;
  };

  return { finalize, setUnmount };
};

// Layout only exposes the workspace's real content height via React context,
// provided to descendants of <Layout> — not to the component that builds
// <Layout>'s children (that component is Layout's ANCESTOR, so the hook
// would find no provider there). This bridge renders inside the subtree to
// read the value and hand it back up through a plain callback.
const WorkspaceHeightProbe: React.FC<{ onHeight: (height: number) => void }> = ({ onHeight }) => {
  const { workspaceHeight } = useLayoutMetrics();
  useEffect(() => {
    onHeight(workspaceHeight);
  }, [workspaceHeight, onHeight]);
  return null;
};

export const createTuiSession = (_title: string): TuiSession => {
  let inlineError = "";
  let parameters: CommandParameters[] = [];

  const setParameters = (nextParameters: CommandParameters[]): void => {
    parameters = [...nextParameters];
  };

  const getParameters = (): CommandParameters[] => parameters;

  const promptInput: TuiSession["promptInput"] = async (options) => {
    return new Promise((resolve) => {
      const resolver = createPromptResolver<string | null>(resolve);

      const App: React.FC = () => {
        const [value, setValue] = useState(options.defaultValue ?? "");
        useEffect(() => {
          appendLogEntry(t("session.log.input"));
        }, []);
        const orientation = buildOrientation(t("session.orientation.input"), options.description);
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();

        useInput(
          (input, key) => {
            if (key.return) {
              resolver.finalize(value);
              return;
            }
            if (key.backspace || key.delete) {
              setValue((current: string) => current.slice(0, -1));
              return;
            }
            if (key.ctrl || key.meta) {
              return;
            }
            if (input) {
              setValue((current: string) => `${current}${input}`);
            }
          },
          { isActive: !modalState.modalOpen }
        );

        return (
          <Layout
            title={options.title}
            orientation={orientation}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize(null)}
          >
            <Box flexDirection="column" width="100%">
              <Text>{options.message}</Text>
              <Box marginTop={1} borderStyle="round" borderColor="cyan">
                <Text wrap="truncate-start"> {value || ""}</Text>
              </Box>
            </Box>
          </Layout>
        );
      };

      const { unmount } = render(<App />);
      resolver.setUnmount(unmount);
    });
  };

  const promptPassword: TuiSession["promptPassword"] = async (options) => {
    return new Promise((resolve) => {
      const resolver = createPromptResolver<string | null>(resolve);

      const App: React.FC = () => {
        const [value, setValue] = useState("");
        useEffect(() => {
          appendLogEntry(t("session.log.password"));
        }, []);
        const orientation = buildOrientation(t("session.orientation.password"), options.description);
        const masked = "*".repeat(value.length);
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();

        useInput(
          (input, key) => {
            if (key.return) {
              resolver.finalize(value);
              return;
            }
            if (key.backspace || key.delete) {
              setValue((current: string) => current.slice(0, -1));
              return;
            }
            if (key.ctrl || key.meta) {
              return;
            }
            if (input) {
              setValue((current: string) => `${current}${input}`);
            }
          },
          { isActive: !modalState.modalOpen }
        );

        return (
          <Layout
            title={options.title}
            orientation={orientation}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize(null)}
          >
            <Box flexDirection="column" width="100%">
              <Text>{options.message}</Text>
              <Box marginTop={1} borderStyle="round" borderColor="cyan">
                <Text wrap="truncate-start"> {masked}</Text>
              </Box>
            </Box>
          </Layout>
        );
      };

      const { unmount } = render(<App />);
      resolver.setUnmount(unmount);
    });
  };

  const promptList: TuiSession["promptList"] = async <T,>(options: {
    title: string;
    message: string;
    choices: ListChoice<T>[];
  }): Promise<T | null> => {
    return new Promise<T | null>((resolve) => {
      const resolver = createPromptResolver<T | null>(resolve);

      const App: React.FC = () => {
        const [selectedIndex, setSelectedIndex] = useState(0);
        useEffect(() => {
          appendLogEntry(t("session.log.list"));
        }, []);
        const currentChoice = options.choices[selectedIndex];
        const orientation = buildOrientation(t("session.orientation.list"), currentChoice?.description);
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();

        useInput(
          (input, key) => {
            if (key.upArrow) {
              setSelectedIndex((current: number) => Math.max(0, current - 1));
              return;
            }
            if (key.downArrow) {
              setSelectedIndex((current: number) => Math.min(options.choices.length - 1, current + 1));
              return;
            }
            if (key.return) {
              resolver.finalize(options.choices[selectedIndex]?.value ?? null);
            }
          },
          { isActive: !modalState.modalOpen }
        );

        return (
          <Layout
            title={options.title}
            orientation={orientation}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize(null)}
          >
            <Box flexDirection="column" width="100%">
              <Text>{options.message}</Text>
              <Box flexDirection="column" marginTop={1}>
                {options.choices.map((choice, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <Text key={choice.label} color={isSelected ? "cyan" : undefined}>
                      {isSelected ? ">" : " "} {choice.label}
                    </Text>
                  );
                })}
              </Box>
            </Box>
          </Layout>
        );
      };

      const { unmount } = render(<App />);
      resolver.setUnmount(unmount);
    });
  };

  const promptForm: TuiSession["promptForm"] = async <T extends Record<string, string>>(options: {
    title: string;
    fields: { name: keyof T; label: string; defaultValue?: string; secret?: boolean; description?: string }[];
  }): Promise<T | null> => {
    return new Promise<T | null>((resolve) => {
      const resolver = createPromptResolver<T | null>(resolve);

      const App: React.FC = () => {
        const [focusedIndex, setFocusedIndex] = useState(0);
        const [values, setValues] = useState<T>(() =>
          options.fields.reduce((acc, field) => {
            (acc as Record<string, string>)[String(field.name)] = field.defaultValue ?? "";
            return acc;
          }, {} as T)
        );
        useEffect(() => {
          appendLogEntry(t("session.log.form"));
        }, []);
        const focusedField = options.fields[focusedIndex];
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();
        const { stdout } = useStdout();
        // The description used to ride along in the orientation bar, sharing
        // a single line with keybinding hints — easy to miss on a form with
        // several fields. It gets its own panel below; the orientation bar
        // keeps just the hints (still shows validation errors, if any).
        const orientation = buildOrientation(t("session.orientation.form"), undefined, inlineError);
        // Below this width the side panel would squeeze the inputs too much
        // to be usable — fall back to stacking the description under the
        // field list instead of beside it.
        const useSidePanel = (stdout?.columns ?? 80) >= 70;

        // The workspace has a fixed height (Layout/Workspace assign it, not
        // Yoga's natural sizing) — on a short terminal, a field list taller
        // than that gets silently flex-shrunk by Ink, collapsing each
        // bordered box's content and bottom border onto the same row. Rather
        // than let that happen, cap how many fields render at once and
        // scroll the window to keep the focused field in view, the same way
        // EditParamsModal/BranchModal handle overflowing lists.
        const [workspaceHeight, setWorkspaceHeight] = useState(24);
        // label line (1) + bordered box (top/content/bottom = 3) + the
        // marginBottom gap (1) below each field.
        const FIELD_ROW_HEIGHT = 5;
        const maxVisibleFields = Math.max(1, Math.floor(workspaceHeight / FIELD_ROW_HEIGHT));
        const needsScroll = options.fields.length > maxVisibleFields;
        const scrollOffset = needsScroll
          ? Math.max(
              0,
              Math.min(focusedIndex - Math.floor(maxVisibleFields / 2), options.fields.length - maxVisibleFields)
            )
          : 0;
        const visibleFields = needsScroll
          ? options.fields.slice(scrollOffset, scrollOffset + maxVisibleFields).map((field, i) => ({ field, index: scrollOffset + i }))
          : options.fields.map((field, index) => ({ field, index }));
        const hiddenAbove = scrollOffset;
        const hiddenBelow = options.fields.length - (scrollOffset + visibleFields.length);

        const updateField = (fieldName: string, updater: (current: string) => string): void => {
          setValues((current) => ({
            ...current,
            [fieldName]: updater(current[fieldName] ?? ""),
          }));
        };

        useInput(
          (input, key) => {
            if (key.tab || key.downArrow) {
              setFocusedIndex((current: number) => Math.min(options.fields.length - 1, current + 1));
              return;
            }
            if ((key.shift && key.tab) || key.upArrow) {
              setFocusedIndex((current: number) => Math.max(0, current - 1));
              return;
            }
            if (key.return) {
              if (focusedIndex >= options.fields.length - 1) {
                inlineError = "";
                resolver.finalize(values);
                return;
              }
              setFocusedIndex((current: number) => Math.min(options.fields.length - 1, current + 1));
              return;
            }
            if (key.backspace || key.delete) {
              const name = String(focusedField?.name ?? "");
              if (!name) {
                return;
              }
              updateField(name, (current) => current.slice(0, -1));
              return;
            }
            if (key.ctrl || key.meta) {
              return;
            }
            if (input && focusedField) {
              const name = String(focusedField.name);
              updateField(name, (current) => `${current}${input}`);
            }
          },
          { isActive: !modalState.modalOpen }
        );

        const fieldsColumn = (
          <Box flexDirection="column" width={useSidePanel ? "62%" : "100%"}>
            <WorkspaceHeightProbe onHeight={setWorkspaceHeight} />
            {hiddenAbove > 0 ? (
              <Text dimColor>{t("session.form.hiddenAbove", { count: String(hiddenAbove) })}</Text>
            ) : null}
            {visibleFields.map(({ field, index }) => {
              const name = String(field.name);
              const value = values[name] ?? "";
              const masked = field.secret ? "*".repeat(value.length) : value;
              const isFocused = index === focusedIndex;
              return (
                <Box key={name} flexDirection="column" marginBottom={1}>
                  <Text color={isFocused ? "cyan" : undefined}>{field.label}</Text>
                  <Box borderStyle="round" borderColor={isFocused ? "cyan" : "gray"}>
                    {/* truncate-start keeps the tail of the value visible —
                        typing always appends at the end, so that's where the
                        active cursor effectively is; a leading "…" shows
                        there is more text hidden to the left. */}
                    <Text wrap="truncate-start"> {masked}</Text>
                  </Box>
                </Box>
              );
            })}
            {hiddenBelow > 0 ? (
              <Text dimColor>{t("session.form.hiddenBelow", { count: String(hiddenBelow) })}</Text>
            ) : null}
          </Box>
        );

        const helpPanel = (
          <Box
            flexDirection="column"
            width={useSidePanel ? "36%" : "100%"}
            marginLeft={useSidePanel ? 1 : 0}
            marginTop={useSidePanel ? 0 : 1}
            borderStyle="round"
            borderColor="blue"
            paddingX={1}
          >
            <Text bold color="blue">
              {t("session.form.helpTitle")}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text bold>{focusedField?.label}</Text>
              <Text dimColor={!focusedField?.description}>
                {focusedField?.description || t("session.form.noDescription")}
              </Text>
            </Box>
          </Box>
        );

        return (
          <Layout
            title={options.title}
            orientation={orientation}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize(null)}
          >
            <Box flexDirection={useSidePanel ? "row" : "column"} width="100%">
              {fieldsColumn}
              {helpPanel}
            </Box>
          </Layout>
        );
      };

      const { unmount } = render(<App />);
      resolver.setUnmount(unmount);
    });
  };

  const promptConfirm: TuiSession["promptConfirm"] = async (options) => {
    const defaultValue = options.defaultValue ?? false;
    return promptList<boolean>({
      title: options.title,
      message: options.message,
      choices: [
        { label: t("session.confirm.yes"), value: true },
        { label: t("session.confirm.no"), value: false },
      ],
    }).then((value) => (value === null ? defaultValue : value));
  };

  const showMessage: TuiSession["showMessage"] = async (options) => {
    return new Promise((resolve) => {
      const resolver = createPromptResolver<void>(resolve);

      const App: React.FC = () => {
        useEffect(() => {
          appendLogEntry(t("session.log.message"));
        }, []);
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();

        useInput(
          (input, key) => {
            if (key.return) {
              resolver.finalize();
            }
          },
          { isActive: !modalState.modalOpen }
        );

        return (
          <Layout
            title={options.title}
            orientation={t("session.orientation.message")}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize()}
          >
            <Box flexDirection="column" width="100%">
              <Text>{options.message}</Text>
            </Box>
          </Layout>
        );
      };

      const { unmount } = render(<App />);
      resolver.setUnmount(unmount);
    });
  };

  const showInlineError = (message: string): void => {
    inlineError = message;
  };

  const destroy = (): void => {
    inlineError = "";
    parameters = [];
  };

  return {
    promptInput,
    promptPassword,
    promptList,
    promptForm,
    promptConfirm,
    showInlineError,
    showMessage,
    setParameters,
    getParameters,
    destroy,
  };
};
