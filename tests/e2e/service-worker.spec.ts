import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ serviceWorkers: "allow" });

test("an activated service worker never caches inventory or invents an offline API success", async ({ page, request, context }) => {
  test.skip(process.env.FRC_E2E_PRODUCTION !== "1", "Requires the generated production service worker.");
  const created = await request.post("/api/inventory", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { name: `Service worker synthetic ${randomUUID()}`, quantity: 4, weightPerUnitLbs: "1", valuePerUnitUsd: "2" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const item = await created.json();
  await page.goto("/inventory");
  await expect(page.getByTestId(`text-item-quantity-${item.id}`)).toHaveText("4");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state), { timeout: 20_000 }).toBe("activated");

  const received = await request.post("/api/transactions", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { type: "IN", items: [{ inventoryItemId: item.id, name: item.name, quantity: 2, weightPerUnitLbs: "1", valuePerUnitUsd: "2" }] },
  });
  expect(received.status(), await received.text()).toBe(201);
  await page.reload();
  await expect(page.getByTestId(`text-item-quantity-${item.id}`)).toHaveText("6");
  const readInventory = () => page.evaluate(async (id) => {
    try {
      const response = await fetch(`/api/inventory/${id}`, { cache: "no-store" });
      return { status: response.status, data: await response.json() };
    } catch { return { status: 0, data: null }; }
  }, item.id);
  expect((await readInventory()).data.quantity).toBe(6);

  await context.setOffline(true);
  try { expect((await readInventory()).status).toBe(0); }
  finally { await context.setOffline(false); }
  expect((await readInventory()).data.quantity).toBe(6);
  const cachedUrls = await page.evaluate(async () => {
    const stores = await caches.keys();
    const requests = await Promise.all(stores.map(async (key) => (await caches.open(key)).keys()));
    return requests.flat().map((entry) => entry.url);
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls.filter((url) => new URL(url).pathname.startsWith("/api/"))).toEqual([]);
});
