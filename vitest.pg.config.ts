import { defineConfig } from "vitest/config";
import path from "path";

// Real Postgres integration suite. Run with
//   npx vitest run --config vitest.pg.config.ts
// The default vitest.config.ts includes only *.test.ts, so these files never
// run, and Postgres never starts, from a plain `npx vitest run`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    include: ["tests/**/*.pgtest.ts"],
    environment: "node",
    globalSetup: ["tests/helpers/pg-global-setup.ts"],
    env: { TZ: "UTC" },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
