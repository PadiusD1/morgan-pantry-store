import { defineConfig } from "@playwright/test";
import path from "node:path";

const baseURL = process.env.FRC_E2E_URL || "http://127.0.0.1:5055";
const authDirectory = process.env.FRC_E2E_AUTH_DIR || ".tmp/e2e-auth";
const resultDirectory = process.env.FRC_E2E_RESULT_DIR || "test-results/browser";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error("Browser tests create synthetic records and may only target a local FRC instance.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: path.join(resultDirectory, "e2e-results.json") }]],
  // Playwright clears only this child directory. Keep the running server log
  // and report metadata in the parent so test startup cannot unlink them.
  outputDir: path.join(resultDirectory, "artifacts"),
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/New_York",
    storageState: path.resolve(authDirectory, "admin.json"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.FRC_E2E_CHROMIUM ? { executablePath: process.env.FRC_E2E_CHROMIUM } : {}),
      args: process.env.FRC_E2E_CHROMIUM_ARGS ? JSON.parse(process.env.FRC_E2E_CHROMIUM_ARGS) : [],
    },
  },
});
