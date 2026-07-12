import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Bundles the extension AND the PAJÉ core it imports (../src/...) into a
// single CJS file — VSCode extensions must be CommonJS and vsce only packages
// files inside this folder, so the shared core has to be inlined.
await build({
  entryPoints: [path.join(here, "src", "extension.ts")],
  outfile: path.join(here, "dist", "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});
