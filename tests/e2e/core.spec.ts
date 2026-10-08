import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function createItem(request: APIRequestContext, quantity = 8, reservedQuantity = 0) {
  const response = await request.post("/api/inventory", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { name: `Core audit ${randomUUID()}`, quantity, reservedQuantity, category: "Grains", weightPerUnitLbs: "1", valuePerUnitUsd: "2" },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test("all staff pages render on desktop and fit a narrow mobile viewport", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const failedApi: string[] = [];
  const timings: { path: string; elapsedMs: number; responseBytes?: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 500) failedApi.push(`${url.pathname}: ${response.status()}`);
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of ["/", "/inventory", "/check-in", "/check-out", "/clients", "/partners", "/donors", "/item-groups", "/requests", "/reports", "/activity", "/settings"]) {
      const start = Date.now();
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(layout.scrollWidth, `${path} at ${width}px should not overflow the document`).toBeLessThanOrEqual(layout.width + 1);
      await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
      timings.push({ path: `${width}px ${path}`, elapsedMs: Date.now() - start });
      if (["/", "/inventory", "/reports", "/check-in"].includes(path)) {
        await page.screenshot({ path: testInfo.outputPath(`${width}-${path.slice(1) || "dashboard"}.png`), fullPage: true });
      }
    }
  }
  expect(errors).toEqual([]);
  expect(failedApi).toEqual([]);
  await testInfo.attach("local-page-readiness", { body: JSON.stringify({ note: "Synthetic local data; includes network-idle wait. Not a production latency measurement.", timings }, null, 2), contentType: "application/json" });
});

test("invalid and empty transactions cannot change stock or create history", async ({ request }) => {
  const item = await createItem(request);
  const line = { inventoryItemId: item.id, name: item.name, quantity: 2, weightPerUnitLbs: "1", valuePerUnitUsd: "2" };
  for (const body of [
    { type: "OUT" }, { type: "OUT", items: [] },
    ...[0, -3, 1.5].map((quantity) => ({ type: "OUT", items: [{ ...line, quantity }] })),
    ...["-1", "NaN", "0x10"].map((value) => ({ type: "IN", items: [{ ...line, valuePerUnitUsd: value }] })),
  ]) {
    const response = await request.post("/api/transactions", { data: body });
    expect(response.status(), await response.text()).toBe(400);
  }
  const missing = await request.post("/api/transactions", {
    data: { type: "OUT", items: [line, { ...line, inventoryItemId: randomUUID() }] },
  });
  expect(missing.status()).toBe(409);
  const inventory = await (await request.get(`/api/inventory/${item.id}`)).json();
  expect(inventory.quantity).toBe(8);
  const history = await (await request.get("/api/transactions")).json();
  expect(history.filter((tx: any) => tx.items.some((row: any) => row.inventoryItemId === item.id))).toHaveLength(0);
});

test("checkout records one shortage adjustment and preserves reservations on an identical retry", async ({ request }) => {
  const item = await createItem(request, 3, 2);
  const body = { type: "OUT", items: [{ inventoryItemId: item.id, name: item.name, quantity: 9, weightPerUnitLbs: "1", valuePerUnitUsd: "2" }] };
  const headers = { "Idempotency-Key": randomUUID() };
  const first = await request.post("/api/transactions", { headers, data: body });
  expect(first.status(), await first.text()).toBe(201);
  const saved = await first.json();
  expect(saved.stockAdjustments).toEqual([{ inventoryItemId: item.id, name: item.name, addedUnits: 8 }]);
  const again = await request.post("/api/transactions", { headers, data: body });
  expect((await again.json()).id).toBe(saved.id);
  const inventory = await (await request.get(`/api/inventory/${item.id}`)).json();
  expect(inventory).toMatchObject({ quantity: 2, reservedQuantity: 2 });
  const history = await (await request.get("/api/transactions")).json();
  expect(history.filter((tx: any) => tx.items.some((row: any) => row.inventoryItemId === item.id))).toHaveLength(1);
});

test("malformed cookies do not break valid sessions", async ({ request }) => {
  const state = await request.storageState();
  const session = state.cookies.find((cookie) => cookie.name === "frc_session");
  expect(session).toBeDefined();
  const valid = await request.get("/api/auth/me", { headers: { Cookie: `unrelated=%E0%A4%A; frc_session=${session!.value}` } });
  expect(valid.status()).toBe(200);
  const invalid = await request.get("/api/auth/me", { headers: { Cookie: "frc_session=%E0%A4%A" } });
  expect(invalid.status()).toBe(401);
});

test("mixed-case UUIDs identify the same inventory row", async ({ request }) => {
  const item = await createItem(request, 5);
  const line = { inventoryItemId: item.id, name: item.name, quantity: 2, weightPerUnitLbs: "1", valuePerUnitUsd: "2" };
  const response = await request.post("/api/transactions", {
    data: { type: "IN", items: [line, { ...line, inventoryItemId: item.id.toUpperCase(), quantity: 3 }] },
  });
  expect(response.status(), await response.text()).toBe(201);
  const inventory = await (await request.get(`/api/inventory/${item.id}`)).json();
  expect(inventory.quantity).toBe(10);
});

test("zero-item pickup cannot create a visit or consume reserved stock", async ({ request }) => {
  const item = await createItem(request, 10);
  const created = await request.post("/api/requests", { data: {
    clientName: "Synthetic Zero Pickup", clientIdentifier: `ZERO-${randomUUID().slice(0, 8)}`,
    reason: "Synthetic zero-pickup verification", items: [{ inventoryItemId: item.id, itemName: item.name, requestedQuantity: 2 }],
  } });
  expect(created.status(), await created.text()).toBe(201);
  const foodRequest = await created.json();
  expect((await request.post(`/api/requests/${foodRequest.id}/approve`, { data: {} })).status()).toBe(200);
  const zero = await request.post(`/api/requests/${foodRequest.id}/fulfill`, { data: { items: [{ id: foodRequest.items[0].id, fulfilledQuantity: 0 }] } });
  expect(zero.status()).toBe(400);
  const pending = await (await request.get(`/api/requests/${foodRequest.id}`)).json();
  expect(pending).toMatchObject({ status: "approved", transactionId: null });
  expect(await (await request.get(`/api/inventory/${item.id}`)).json()).toMatchObject({ quantity: 10, reservedQuantity: 2 });
});

test("anonymous, student and volunteer API permissions match their roles", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await anonymous.get("/api/inventory")).status()).toBe(401);
    expect((await anonymous.get("/api/public/inventory")).status()).toBe(200);
  } finally { await anonymous.dispose(); }

  for (const role of ["student", "volunteer"] as const) {
    const prefix = role.toUpperCase();
    const email = process.env[`FRC_E2E_${prefix}_EMAIL`];
    const password = process.env[`FRC_E2E_${prefix}_PASSWORD`];
    if (!email || !password) throw new Error(`Synthetic ${role} credentials must be supplied for role verification.`);
    const context = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const login = await context.post("/api/auth/login", { data: { email, password } });
      expect(login.status(), await login.text()).toBe(200);
      expect((await context.put("/api/settings/orgName", { data: { value: "Unauthorized audit value" } })).status()).toBe(403);
      expect((await context.delete(`/api/donors/${randomUUID()}`)).status()).toBe(403);
      expect((await context.get("/api/reports/monthly-csv?year=2026")).status()).toBe(403);
      if (role === "student") {
        expect((await context.get("/api/inventory")).status()).toBe(403);
        expect((await context.get("/api/clients")).status()).toBe(403);
        expect((await context.get("/api/portal/requests")).status()).toBe(200);
        expect((await context.post("/api/transactions", { data: { type: "OUT", items: [] } })).status()).toBe(403);
      } else {
        expect((await context.get("/api/inventory")).status()).toBe(200);
      }
    } finally { await context.dispose(); }
  }
});

test("dashboard aggregates return real counts and display a retryable failure", async ({ page, request }) => {
  const response = await request.get("/api/dashboard/stats");
  expect(response.status(), await response.text()).toBe(200);
  const stats = await response.json();
  const clients = await (await request.get("/api/clients")).json();
  expect(stats.totalClients).toBe(clients.length);
  expect(stats.activeClients).toBe(clients.filter((client: any) => client.status === "active").length);
  expect(stats.topDistributedItems.length).toBeLessThanOrEqual(10);
  expect(Number.isInteger(stats.pendingRequests)).toBeTruthy();
  await page.context().route("**/api/dashboard/stats", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Database temporarily unavailable" }) }));
  await page.goto("/");
  await expect(page.getByText(/unable to load request stats|could not load request|request stats.*unavailable/i)).toBeVisible();
});

test("Ready for Pickup opens every approved pickup state", async ({ page, request }) => {
  const item = await createItem(request, 10);
  const name = `Pickup audit ${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/requests", { data: {
    clientName: name, clientIdentifier: `PICKUP-${randomUUID().slice(0, 8)}`,
    reason: "Synthetic dashboard pickup verification", items: [{ inventoryItemId: item.id, itemName: item.name, requestedQuantity: 2 }],
  } });
  expect(created.status()).toBe(201);
  const foodRequest = await created.json();
  expect((await request.post(`/api/requests/${foodRequest.id}/approve`, { data: {} })).status()).toBe(200);
  await page.goto("/");
  await page.getByRole("link", { name: /Ready for Pickup/ }).click();
  await expect(page).toHaveURL(/status=pickup/);
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Approved");
  await expect(page.getByRole("button", { name: "Awaiting pickup", exact: true })).toBeVisible();
});

test("a donor with legacy name-only history cannot be deleted", async ({ request }) => {
  const name = `Protected legacy donor ${randomUUID()}`;
  const created = await request.post("/api/donors", { data: { name } });
  expect(created.status()).toBe(201);
  const donor = await created.json();
  const item = await createItem(request);
  const received = await request.post("/api/transactions", { data: {
    type: "IN", donor: name,
    items: [{ inventoryItemId: item.id, name: item.name, quantity: 1, weightPerUnitLbs: "1", valuePerUnitUsd: "2" }],
  } });
  expect(received.status()).toBe(201);
  expect((await request.delete(`/api/donors/${donor.id}`)).status()).toBe(409);
  expect((await request.get(`/api/donors/${donor.id}`)).status()).toBe(200);
  const history = await (await request.get(`/api/donors/${donor.id}/history`)).json();
  expect(history).toHaveLength(1);
});
