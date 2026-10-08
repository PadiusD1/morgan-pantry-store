import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("compiled application boots under the actual Vercel CSP and serves real API responses", async ({ page, request }) => {
  test.skip(process.env.FRC_E2E_PRODUCTION !== "1", "Requires the compiled Vercel test server.");
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  const globalHeaders = config.headers.find((rule: { source: string }) => rule.source === "/(.*)").headers;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__testCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as any).__testCspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
    });
  });
  const response = await page.goto("/reports");
  expect(response?.status()).toBe(200);
  for (const header of globalHeaders) expect(response?.headers()[header.key.toLowerCase()]).toBe(header.value);
  await expect(page.getByTestId("card-board-summary")).toBeVisible();
  expect(await page.locator('script[src*="/assets/"]').count()).toBeGreaterThan(0);
  await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__testCspViolations)).toEqual([]);
  expect(errors).toEqual([]);
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const missing = await request.get("/api/nonexistent-e2e-route");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
});
