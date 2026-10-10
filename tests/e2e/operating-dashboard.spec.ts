import { expect, test } from "@playwright/test";

test("dashboard charts expose saved stock and keyboard-readable quantities without the chart runtime", async ({ page, request }, info) => {
  const inventory = await (await request.get("/api/inventory")).json();
  const total = inventory.reduce((sum: number, item: { quantity: number }) => sum + Math.max(0, item.quantity), 0);
  const assets: string[] = [];
  page.on("request", req => { const path = new URL(req.url()).pathname; if (path.startsWith("/assets/") && path.endsWith(".js")) assets.push(path); });
  await page.goto("/");
  await expect(page.getByTestId("category-inventory-figure")).toContainText(`${total.toLocaleString("en-US")} units`);
  await expect(page.getByTestId("weekly-movement-figure")).toBeVisible();
  const numbers = page.getByText("View the weekly numbers", { exact: true });
  await numbers.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: "Weekly movement in units" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Weekly movement in units" }).locator("tbody tr")).toHaveCount(7);
  await expect(page.locator(".recharts-wrapper, canvas")).toHaveCount(0);
  expect(assets.some(path => /\/charts-/.test(path))).toBe(false);
  await numbers.click();
  await page.screenshot({ path: info.outputPath("sbd-operating-dashboard-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("sbd-operating-dashboard-mobile.png"), fullPage: true });
  await info.attach("dashboard-assets", { body: JSON.stringify({ note: "Compiled synthetic local run; not a production latency or billing measurement.", javascriptRequests: [...new Set(assets)] }, null, 2), contentType: "application/json" });
});
