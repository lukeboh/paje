import { createTuiSession } from "./modules/git/tuiSession.js";
import type { ScreenHost } from "./modules/git/tui/screenHost.js";

export const createSessionForCommand = (command: string, screenHost?: ScreenHost) => {
  if (command === "git-sync" || command === "git-server-store") {
    return createTuiSession("PAJÉ", { screenHost });
  }
  return undefined;
};
