import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useInput } from "ink";
import type { CommandParameters } from "./core/parameters.js";
import { Layout } from "./tui/layout.js";
import { useModalStateController } from "./tui/layoutContext.js";
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
    resolve(value);
    if (unmountRef.current) {
      setTimeout(() => unmountRef.current?.(), 0);
    }
  };

  const setUnmount = (unmount: () => void): void => {
    unmountRef.current = unmount;
  };

  return { finalize, setUnmount };
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
                <Text> {value || ""}</Text>
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
                <Text> {masked}</Text>
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
        const description = focusedField?.description;
        const orientation = buildOrientation(t("session.orientation.form"), description, inlineError);
        const parametersSnapshot = getParameters();
        const modalState = useModalStateController();

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

        return (
          <Layout
            title={options.title}
            orientation={orientation}
            parameters={parametersSnapshot}
            modalState={modalState}
            onEscape={() => resolver.finalize(null)}
          >
            <Box flexDirection="column" width="100%">
              {options.fields.map((field, index) => {
                const name = String(field.name);
                const value = values[name] ?? "";
                const masked = field.secret ? "*".repeat(value.length) : value;
                const isFocused = index === focusedIndex;
                return (
                  <Box key={name} flexDirection="column" marginBottom={1}>
                    <Text color={isFocused ? "cyan" : undefined}>{field.label}</Text>
                    <Box borderStyle="round" borderColor={isFocused ? "cyan" : "gray"}>
                      <Text> {masked}</Text>
                    </Box>
                  </Box>
                );
              })}
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
