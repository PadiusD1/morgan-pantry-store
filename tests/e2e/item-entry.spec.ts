import { test, expect, type Page } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";

type SavedItem = { id: string; name: string; barcode: string; quantity: number; category: string; brand: string };

async function createItem(page: Page, overrides: Record<string, unknown> = {}): Promise<SavedItem> {
  const response = await page.request.post("/api/inventory", {
    headers: { "Idempotency-Key": randomUUID() },
    data: {
      name: `E2E Item Entry ${randomUUID().slice(0, 8)}`,
      barcode: `29${randomInt(100_000_000_000).toString().padStart(11, "0")}`,
      brand: "Synthetic Pantry Brand", category: "Grains", quantity: 7,
      weightPerUnitLbs: "1.2500", valuePerUnitUsd: "3.75", allergens: ["soy"], reorderThreshold: 3,
      ...overrides,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function readItem(page: Page, id: string) {
  const response = await page.request.get(`/api/inventory/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function heldResponse() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

test.beforeEach(async ({ context }) => {
  // Browser verification never contacts product providers or any live site.
  await context.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (["127.0.0.1", "localhost", "[::1]"].includes(host)) await route.continue();
    else await route.abort();
  });
});

test("Inventory name suggestion fills saved details and receives stock into the same row", async ({ page }) => {
  const item = await createItem(page);
  await page.goto("/inventory");
  await expect(page.getByTestId(`row-item-${item.id}`)).toBeVisible();
  await page.getByTestId("button-add-item").click();
  await page.getByTestId("input-item-name").fill(item.name.slice(0, -2));
  await page.getByTestId(`input-item-name-option-${item.id}`).click();
  await expect(page.getByTestId("input-item-name")).toHaveValue(item.name);
  await expect(page.getByTestId("input-item-brand")).toHaveValue("Synthetic Pantry Brand");
  await expect(page.getByTestId("input-item-category")).toHaveValue("Grains");
  await expect(page.getByTestId("input-item-barcode")).toHaveValue(item.barcode);
  await expect(page.getByTestId("input-item-weight")).toHaveValue("1.25");
  await expect(page.getByTestId("input-item-value")).toHaveValue("3.75");
  await expect(page.getByTestId("dialog-edit-item")).toContainText("soy");
  await expect(page.getByTestId("text-existing-item-selected")).toBeVisible();
  await page.locator("#initial-quantity").fill("3");
  await page.getByTestId("button-save-item").click();
  await expect(page.getByTestId("dialog-edit-item")).toBeHidden();
  await expect.poll(async () => (await readItem(page, item.id)).quantity).toBe(10);
  const all = await (await page.request.get("/api/inventory")).json();
  expect(all.filter((row: SavedItem) => row.name === item.name).map((row: SavedItem) => row.id)).toEqual([item.id]);
  await page.reload();
  await expect(page.getByTestId(`text-item-quantity-${item.id}`)).toHaveText("10");
});

test("fast item-name typing stays text, then a suggestion selects the correct Check-In item", async ({ page }) => {
  const item = await createItem(page);
  const lookups: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/barcode-lookup/")) lookups.push(request.url()); });
  await page.goto("/check-in");
  await page.getByTestId("button-mode-new-item").click();
  const typedName = `Fast Typed Food ${randomUUID().slice(0, 8)}`;
  const name = page.getByTestId("input-new-item-name");
  await name.pressSequentially(typedName, { delay: 1 });
  await name.press("Enter");
  await expect(name).toHaveValue(typedName);
  expect(lookups).toEqual([]);
  await name.press("Tab");
  await expect(page.getByTestId("input-new-item-brand")).toBeFocused();

  await name.fill(item.name.slice(0, -2));
  await page.getByTestId(`input-new-item-name-option-${item.id}`).click();
  await expect(page.getByTestId("input-existing-item-name")).toHaveValue(item.name);
  await expect(page.getByTestId("text-selected-item-details")).toContainText(item.barcode);
  await expect(page.getByTestId("text-selected-item-details")).toContainText("1.25 lbs/unit");
  await page.getByTestId("input-quantity-received").fill("2");
  await page.getByTestId("button-save-check-in").click();
  await expect(page.getByTestId("input-quantity-received")).toHaveValue("0");
  await expect.poll(async () => (await readItem(page, item.id)).quantity).toBe(9);
  const all = await (await page.request.get("/api/inventory")).json();
  expect(all.filter((row: SavedItem) => row.name === typedName)).toHaveLength(0);
});

for (const scanGapMs of [2, 60]) {
test(`two ${scanGapMs}ms physical scans of one barcode during a pending lookup both count`, async ({ page }) => {
  const item = await createItem(page, { quantity: 12 });
  const started = heldResponse();
  const responseHeld = heldResponse();
  await page.route(`**/api/barcode-lookup/${item.barcode}`, async (route) => {
    const response = await route.fetch();
    started.release();
    await responseHeld.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.goto("/check-in");
  const scan = page.getByTestId("input-checkin-barcode-scan");
  await scan.focus();
  try {
    await page.keyboard.type(item.barcode, { delay: scanGapMs });
    await page.keyboard.press("Enter");
    await started.promise;
    await page.keyboard.type(item.barcode, { delay: scanGapMs });
    await page.keyboard.press("Enter");
  } finally {
    responseHeld.release();
  }
  await expect(page.getByTestId("input-quantity-received")).toHaveValue("2");
  await page.getByTestId("button-save-check-in").click();
  await expect.poll(async () => (await readItem(page, item.id)).quantity).toBe(14);
});
}

test("a delayed Inventory barcode lookup cannot replace a later name selection", async ({ page }) => {
  const chosen = await createItem(page, { brand: "Chosen Brand", quantity: 4 });
  await page.goto("/inventory");
  await expect(page.getByTestId(`row-item-${chosen.id}`)).toBeVisible();
  // Create this after the page's inventory read, so its barcode requires the API.
  const delayed = await createItem(page, { brand: "Earlier Barcode Brand", quantity: 8 });
  const started = heldResponse();
  const responseHeld = heldResponse();
  const lookups: string[] = [];
  page.on("request", (request) => { if (request.url().includes("barcode") || request.url().includes("openfoodfacts")) lookups.push(request.url()); });
  await page.route(`**/api/barcode-lookup/${delayed.barcode}`, async (route) => {
    const response = await route.fetch();
    started.release();
    await responseHeld.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByTestId("button-add-item").click();
  await page.getByTestId("input-item-barcode").fill(delayed.barcode);
  await page.getByTestId("input-item-barcode").press("Enter");
  await started.promise;
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/inventory" && response.request().method() === "GET");
  try {
    await page.getByTestId("input-item-name").fill(chosen.name.slice(0, -2));
    await page.getByTestId(`input-item-name-option-${chosen.id}`).click();
  } finally {
    responseHeld.release();
  }
  await refreshed;
  await expect(page.getByTestId("input-item-name")).toHaveValue(chosen.name);
  await expect(page.getByTestId("input-item-barcode")).toHaveValue(chosen.barcode);
  await expect(page.getByTestId("input-item-brand")).toHaveValue("Chosen Brand");
  expect(lookups.length).toBeGreaterThan(0);
  expect(lookups.every((url) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname))).toBeTruthy();
  await page.locator("#initial-quantity").fill("2");
  await page.getByTestId("button-save-item").click();
  await expect(page.getByTestId("dialog-edit-item")).toBeHidden();
  expect((await readItem(page, chosen.id)).quantity).toBe(6);
  expect((await readItem(page, delayed.id)).quantity).toBe(8);
});

test("a fresh barcode item shows its allergy warning before cart confirmation and checkout", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const clientName = `E2E Allergy Client ${suffix}`;
  const clientResponse = await page.request.post("/api/clients", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { name: clientName, identifier: `E2E${suffix}`, classification: "Sophomore", allergies: ["almonds"] },
  });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);
  const client = await clientResponse.json();
  await page.goto("/check-out");
  await page.getByTestId("button-client-search").click();
  await page.getByTestId("input-client-search").fill(clientName);
  await page.getByTestId(`option-client-${client.id}`).click();
  await expect(page.getByTestId("input-client-name")).toHaveValue(clientName);
  // No inventory invalidation accompanies this direct synthetic setup write.
  const item = await createItem(page, { allergens: ["almonds"], quantity: 5 });
  const scan = page.getByTestId("input-barcode");
  await scan.fill(item.barcode);
  await scan.press("Enter");
  const warning = page.getByRole("dialog", { name: "Allergy Warning" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(item.name);
  await expect(warning).toContainText("almonds");
  await expect(page.getByTestId(`row-cart-${item.id}`)).toHaveCount(0);
  await warning.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId(`row-cart-${item.id}`)).toHaveCount(0);
  await scan.fill(item.barcode);
  await scan.press("Enter");
  await warning.getByRole("button", { name: "Confirm & Add Anyway", exact: true }).click();
  await expect(page.getByTestId(`input-cart-quantity-${item.id}`)).toHaveValue("1");
  await page.getByTestId("checkbox-emergency-shop").check();
  await expect(page.getByTestId("checkbox-emergency-shop")).toBeChecked();
  await page.getByTestId("checkbox-emergency-shop").uncheck();
  await expect(page.getByTestId("checkbox-emergency-shop")).not.toBeChecked();
  await page.getByTestId("button-save-check-out").click();
  const receipt = page.getByRole("dialog", { name: "Distribution Receipt" });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText(clientName);
  await expect(receipt).toContainText(item.name);
  expect((await readItem(page, item.id)).quantity).toBe(4);
});

test("queued allergenic scans wait for each confirmation or cancellation", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const clientName = `E2E Queued Allergy Client ${suffix}`;
  const clientResponse = await page.request.post("/api/clients", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { name: clientName, identifier: `E2EQ${suffix}`, classification: "Sophomore", allergies: ["almonds"] },
  });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);
  const client = await clientResponse.json();
  const first = await createItem(page, { allergens: ["almonds"] });
  const second = await createItem(page, { allergens: ["almonds"] });
  const third = await createItem(page, { allergens: ["almonds"] });
  await page.goto("/check-out");
  await page.getByTestId("button-client-search").click();
  await page.getByTestId("input-client-search").fill(clientName);
  await page.getByTestId(`option-client-${client.id}`).click();

  const started = heldResponse();
  const responseHeld = heldResponse();
  let lookupRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/barcode-lookup/")) lookupRequests += 1; });
  await page.route(`**/api/barcode-lookup/${first.barcode}`, async (route) => {
    const response = await route.fetch();
    started.release();
    await responseHeld.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByTestId("input-barcode").focus();
  try {
    await page.keyboard.type(first.barcode, { delay: 2 });
    await page.keyboard.press("Enter");
    await started.promise;
    for (const item of [second, third]) {
      await page.keyboard.type(item.barcode, { delay: 2 });
      await page.keyboard.press("Enter");
    }
  } finally {
    responseHeld.release();
  }
  const warning = page.getByRole("dialog", { name: "Allergy Warning" });
  await expect(warning).toContainText(first.name);
  // Staff need time to read the warning; queued lookups must stay paused.
  await page.waitForTimeout(250);
  expect(lookupRequests).toBe(1);
  await expect(page.getByTestId(`row-cart-${first.id}`)).toHaveCount(0);
  await warning.getByRole("button", { name: "Confirm & Add Anyway", exact: true }).click();

  await expect(warning).toContainText(second.name);
  expect(lookupRequests).toBe(2);
  await expect(page.getByTestId(`input-cart-quantity-${first.id}`)).toHaveValue("1");
  await warning.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(warning).toContainText(third.name);
  expect(lookupRequests).toBe(3);
  await expect(page.getByTestId(`row-cart-${second.id}`)).toHaveCount(0);
  await warning.getByRole("button", { name: "Confirm & Add Anyway", exact: true }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByTestId(`input-cart-quantity-${third.id}`)).toHaveValue("1");
});
