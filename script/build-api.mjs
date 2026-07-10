/**
 * Bundle the Express serverless entry into a single self-contained
 * ESM function at api/index.js. Bundling avoids cross-file extensionless
 * ESM imports (which Node's ESM loader rejects on Vercel) and the tsconfig
 * path aliases (@shared, @/…) that Vercel's function tracer does not resolve.
 */

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await mkdir(path.join(root, "api"), { recursive: true });

await build({
  entryPoints: [path.join(root, "server", "serverless.ts")],
  outfile: path.join(root, "api", "index.js"),
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  minify: true,
  logLevel: "info",
  // Native/optional deps that must not be bundled
  external: ["pg-native"],
  // Resolve the tsconfig path aliases at bundle time
  alias: {
    "@shared": path.join(root, "shared"),
    "@": path.join(root, "client", "src"),
  },
  // Some bundled CJS deps (pg) still call require() at runtime; provide it.
  banner: {
    js: "import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);",
  },
});

console.log("[build-api] api/index.js bundled");
