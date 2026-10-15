import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

async function create(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: { "Idempotency-Key": randomUUID() } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test("catalog completion persists evidence, refuses a stale save and never changes stock", async ({ page, request }, testInfo) => {
  const name = `Catalog UI ${randomUUID()}`;
  const item = await create(request, "/api/inventory", { name, quantity: 7, reservedQuantity: 2 });
  await page.goto("/inventory");
  await page.getByTestId("button-catalog-review").click();
  await page.getByRole("textbox", { name: "Find catalog item", exact: true }).fill(name);
  await page.getByTestId(`edit-catalog-${item.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Complete catalog data", exact: true });
  await dialog.getByLabel("Unit weight (lbs)", { exact: true }).fill("1.5");
  await dialog.getByLabel("Estimated unit value (USD)", { exact: true }).fill("2.75");
  await dialog.getByLabel("Source and date for these entries", { exact: true }).fill("Synthetic package label and documented price, 2026-10-15");
  // Another staff edit wins first. The form must retain its entries and require review.
  const changed = await request.patch(`/api/inventory/${item.id}/catalog`, { data: { expectedUpdatedAt: item.updatedAt, evidence: "Concurrent synthetic estimate", valuePerUnitUsd: 2.5 } });
  expect(changed.status(), await changed.text()).toBe(200);
  const failed = page.waitForResponse(r => r.url().endsWith(`/api/inventory/${item.id}/catalog`) && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Save catalog data", exact: true }).click();
  expect((await failed).status()).toBe(409);
  await expect(dialog.getByLabel("Unit weight (lbs)", { exact: true })).toHaveValue("1.5");
  await dialog.getByRole("button", { name: "Refresh saved item", exact: true }).click();
  await expect(dialog).toContainText("$2.50 per unit");
  const success = page.waitForResponse(r => r.url().endsWith(`/api/inventory/${item.id}/catalog`) && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Save catalog data", exact: true }).click();
  expect((await success).status()).toBe(200);
  await expect(dialog).not.toBeVisible();
  const saved = await (await request.get(`/api/inventory/${item.id}`)).json();
  expect(saved).toMatchObject({ quantity: 7, reservedQuantity: 2, weightPerUnitLbs: "1.5000", valuePerUnitUsd: "2.75", weightIsEstimated: true, costIsEstimated: true });
  expect(saved.rawPayload.frcCatalog.valueEvidence.source).toContain("Synthetic package label");
  await page.reload();
  await page.getByTestId("button-catalog-review").click();
  await page.getByRole("textbox", { name: "Find catalog item", exact: true }).fill(name);
  await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("Missing: photo");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("catalog-review-mobile.png"), fullPage: true });
});

test("request catalog shows an allowlisted photo and a truthful broken-image fallback without leaking evidence", async ({ page, request }, testInfo) => {
  const name = `Catalog Photo ${randomUUID()}`;
  const goodUrl = "https://images.openfoodfacts.org/images/products/123/456/789/0123/front_en.1.400.jpg";
  const badUrl = "https://images.openfoodfacts.org/images/products/123/456/789/0123/front_en.2.400.jpg";
  const first = await create(request, "/api/inventory", { name, quantity: 5 });
  const second = await create(request, "/api/inventory", { name: name + " unavailable", quantity: 5 });
  for (const [item, imageUrl] of [[first, goodUrl], [second, badUrl]] as const) {
    const response = await request.patch(`/api/inventory/${item.id}/catalog`, { data: { expectedUpdatedAt: item.updatedAt, imageUrl, imageAlt: item.name, imageSource: "Private supplier source", evidence: "PRIVATE SOURCE NOTE" } });
    expect(response.status()).toBe(200);
  }
  const publicRows = await (await request.get("/api/public/inventory")).json();
  const row = publicRows.find((r: { id: string }) => r.id === first.id);
  expect(row).toMatchObject({ imageUrl: goodUrl, imageSource: "Open Food Facts" });
  expect(JSON.stringify(publicRows)).not.toContain("PRIVATE SOURCE NOTE");
  expect(JSON.stringify(publicRows)).not.toContain("Private supplier source");
  expect(row).not.toHaveProperty("rawPayload");
  // Synthetic pixels only. Do not rely on third-party network or product data in CI.
  await page.context().route(goodUrl, route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6i8AAAAASUVORK5CYII=", "base64") }));
  await page.context().route(badUrl, route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/kiosk");
  await page.getByRole("button", { name: "Start a Request", exact: true }).click();
  await page.getByTestId("input-req-client-name").fill("Synthetic Catalog Student");
  await page.getByTestId("input-req-client-identifier").fill(`CAT-${randomUUID().slice(0,8)}`);
  await page.getByTestId("button-req-continue").click();
  await page.getByTestId("input-item-search").fill(name);
  const photo = page.getByTestId(`photo-item-${first.id}`);
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(page.getByTestId(`card-item-${second.id}`)).toContainText("Photo not available");
  await page.getByTestId(`button-item-plus-${first.id}`).click();
  await expect(page.getByRole("button", { name: "Continue with 1 item(s)", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("request-photo-mobile.png"), fullPage: true });
});

test("directory download buttons export all registered donors and partners independently", async ({ page, request }, testInfo) => {
  const donor = await create(request, "/api/donors", { name: `Directory Donor ${randomUUID()}`, email: "private-directory@example.invalid", notes: "PRIVATE DIRECTORY NOTE", status: "active" });
  const partner = await create(request, "/api/clients", { name: `Directory Partner ${randomUUID()}`, identifier: `PARTNER-${randomUUID()}`, clientType: "partner", status: "active" });
  for (const [kind, record] of [["donor", donor], ["partner", partner]] as const) {
    await page.goto(`/${kind}s`);
    if (kind === "donor") await page.getByTestId("input-donors-search").fill("no visible matches");
    const pending = page.waitForEvent("download");
    await page.getByTestId(`export-${kind}-directory`).click();
    const file = await pending;
    const path = testInfo.outputPath(`${kind}-directory.csv`);
    await file.saveAs(path);
    const csv = await readFile(path, "utf8");
    expect(csv).toContain(record.id);
    expect(csv).toContain(record.name);
    expect(csv).not.toContain(kind === "donor" ? partner.id : donor.id);
    expect(csv).not.toContain("PRIVATE DIRECTORY NOTE");
    expect(csv).not.toContain("private-directory@example.invalid");
  }
});
