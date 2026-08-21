import React, { useSyncExternalStore } from "react";
import { render, type RenderOptions } from "ink";

export type ScreenHost = {
  // Mounts `node` as the current screen, replacing whatever was there.
  // Returns a key identifying this specific screen instance.
  mount: (node: React.ReactNode) => number;
  // Clears the screen to blank, but only if `key` is still the current one —
  // a no-op if something else already replaced it (e.g. a prompt nested
  // inside a fire-and-forget loading screen resolving before the loading
  // screen's own stop() runs).
  release: (key: number) => void;
  // Unmounts the underlying Ink instance for good (end of the TUI session).
  destroy: () => void;
};

type ScreenEntry = { key: number; node: React.ReactNode } | null;

// Ink caches one render() instance per stdout stream and tears down its
// internal frame-diffing state on unmount() — call render() again afterwards
// and it starts from a blank slate, writing the whole new frame disconnected
// from whatever was on screen before (the visible "flicker" between screens).
// Keeping ONE render() call alive for the whole session and just swapping
// which subtree it renders keeps Ink on its normal incremental-update path.
export const createScreenHost = (renderOptions?: RenderOptions): ScreenHost => {
  let entry: ScreenEntry = null;
  let nextKey = 0;
  const listeners = new Set<() => void>();
  let inkUnmount: (() => void) | null = null;

  const getSnapshot = (): ScreenEntry => entry;
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  // useSyncExternalStore (rather than a useState+useEffect callback bridge)
  // avoids a race where a second mount()/release() lands before the first
  // screen's effect has registered its listener — it re-checks the snapshot
  // right after subscribing and forces a re-render if it already changed.
  const Root: React.FC = () => {
    const current = useSyncExternalStore(subscribe, getSnapshot);
    if (!current) {
      return null;
    }
    return <React.Fragment key={current.key}>{current.node}</React.Fragment>;
  };

  const ensureRawMode = (): void => {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(true);
      } catch {}
    }
  };

  const ensureStarted = (): void => {
    ensureRawMode();
    if (inkUnmount) {
      return;
    }
    const { unmount } = render(<Root />, renderOptions);
    inkUnmount = unmount;
  };

  const mount = (node: React.ReactNode): number => {
    ensureRawMode();
    const key = nextKey++;
    entry = { key, node };
    // Set before the first render() call so Root's initial snapshot already
    // reflects this screen; notify() is a no-op until a listener subscribes.
    ensureStarted();
    notify();
    return key;
  };

  const release = (key: number): void => {
    if (entry?.key !== key) {
      return;
    }
    entry = null;
    notify();
  };

  const destroy = (): void => {
    inkUnmount?.();
    inkUnmount = null;
    entry = null;
    listeners.clear();
  };

  return { mount, release, destroy };
};
