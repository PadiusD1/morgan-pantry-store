import { test, expect } from "@playwright/test";

test("sidebar portal controls fit their container and mobile navigation stays usable", async ({ page }, info) => {
  await page.goto("/donors");
  await expect(page.getByTestId("nav-dashboard")).toBeVisible();
  const menu = await page.getByTestId("nav-dashboard").boundingBox();
  for (const name of ["Student Portal", "Kiosk Mode"]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(menu!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(menu!.x + menu!.width + 1);
    expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: info.outputPath("sidebar-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("button-mobile-menu").click();
  await expect(page.getByRole("link", { name: "Kiosk Mode", exact: true })).toBeVisible();
  await expect(page.getByTestId("button-logout")).toBeVisible();
  await page.screenshot({ path: info.outputPath("sidebar-mobile.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("button-mobile-menu")).toBeVisible();
});
