import { test, expect } from "@playwright/test";

test("firm identity, accessible navigation and mobile controls survive the visual redesign", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/reports");
  await expect(page.getByTestId("sbd-brand-signature")).toContainText("Systems by Design");
  await expect(page.getByTestId("text-app-title")).toHaveText("Morgan State Repository");
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  const summary = page.getByTestId("card-board-summary");
  await expect(summary).toBeVisible();
  expect(await summary.evaluate(el => getComputedStyle(el).backdropFilter)).toBe("none");
  expect(await page.locator(".app-shell").evaluate(el => getComputedStyle(el).backgroundImage)).toBe("none");
  expect(await page.getByTestId("text-page-title").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Source Serif 4");
  await page.screenshot({ path: info.outputPath("sbd-reports-desktop.png"), fullPage: true });
  await page.getByTestId("button-toggle-sidebar").click();
  await expect(page.getByTestId("sbd-brand-signature")).toBeHidden();
  await expect(page.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByTestId("button-toggle-sidebar").click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByTestId("button-mobile-menu").click();
    await page.getByRole("link", { name: "Donors", exact: true }).click();
    await expect(page).toHaveURL(/\/donors$/);
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByTestId("button-add-donor")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByTestId("button-mobile-menu").click();
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(summary).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
    const button = await page.getByTestId("button-print-board").boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`sbd-reports-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/reports");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to workspace" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-main")).toBeFocused();
  expect(errors).toEqual([]);
});

test("the exported document carries the same brand and renders an actual PDF", async ({ page }, info) => {
  await page.context().addInitScript(() => { window.print = () => {}; });
  await page.goto("/reports");
  await expect(page.getByTestId("card-board-summary")).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("button-print-board").click();
  const printed = await popup;
  await expect(printed.getByRole("heading", { name: "Board Summary", exact: true })).toBeVisible();
  await expect(printed.locator(".signature").first()).toContainText("Systems by Design");
  await expect(printed.locator(".client").first()).toContainText("Morgan State University");
  await expect(printed.locator(".report-page")).toHaveCount(3);
  expect(await printed.evaluate(() => window.opener === null)).toBe(true);
  await printed.screenshot({ path: info.outputPath("sbd-board-document.png"), fullPage: true });
  await printed.pdf({ path: info.outputPath("sbd-board-document.pdf"), printBackground: true, preferCSSPageSize: true });
  await printed.setViewportSize({ width: 390, height: 844 });
  expect(await printed.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await printed.close();
});
