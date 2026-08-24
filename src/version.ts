import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const findPackageJson = (startDir: string): string => {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("package.json not found");
    }
    dir = parent;
  }
};

const packageJsonPath = findPackageJson(dirname(fileURLToPath(import.meta.url)));

export const APP_VERSION: string = JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;
