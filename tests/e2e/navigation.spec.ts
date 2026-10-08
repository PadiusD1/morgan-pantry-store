import { test, expect } from "@playwright/test";

test("sidebar portal controls fit their container and mobile navigation stays usable", async ({ page }, info) => {
  await page.goto("/donors");
  const dashboard = page.getByRole("link", { name: "Dashboard", exact: true });
  await expect(dashboard).toBeVisible();
  const menu = await dashboard.boundingBox();
  for (const name of ["Student Portal", "Kiosk Mode"]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(menu!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(menu!.x + menu!.width + 1);
    expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: info.outputPath("sidebar-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("button-mobile-menu").click();
  const kiosk = page.getByRole("link", { name: "Kiosk Mode", exact: true });
  await expect(kiosk).toBeVisible();
  // Check stability and hit testing without opening another page or signing out.
  await kiosk.click({ trial: true });
  await page.getByTestId("button-logout").click({ trial: true });
  await page.screenshot({ path: info.outputPath("sidebar-mobile.png"), fullPage: true, animations: "disabled" });
  await dashboard.click();
  await expect(page).toHaveURL(new URL("/", page.url()).toString());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("button-mobile-menu")).toBeVisible();
});
