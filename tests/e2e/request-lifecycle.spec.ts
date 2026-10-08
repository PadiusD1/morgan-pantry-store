import { randomUUID } from "node:crypto";
import { expect, test, type Response } from "@playwright/test";

const isPost = (path: string) => (response: Response) => new URL(response.url()).pathname === path && response.request().method() === "POST";

test("a failed request leaves no partial record and does not consume the last daily slot", async ({ request }) => {
  const identifier = `E2E-ATOMIC-${randomUUID().slice(0, 8)}`;
  const configured = await request.get("/api/settings/maxRequestsPerDay");
  expect([200, 404]).toContain(configured.status());
  const previousLimit = configured.ok() ? (await configured.json()).value : "5";
  expect((await request.put("/api/settings/maxRequestsPerDay", { data: { value: "1" } })).status()).toBe(200);
  try {
    const seeded = await request.post("/api/inventory", { data: { name: `E2E Atomic Rice ${identifier}`, quantity: 10 } });
    expect(seeded.status()).toBe(201);
    const item = await seeded.json();
    const body = {
      clientName: "Synthetic Atomic Request Student", clientIdentifier: identifier,
      reason: "Synthetic request for transaction rollback verification.",
      items: [{ inventoryItemId: item.id, itemName: "Stale cached item name", itemCategory: "Old category", requestedQuantity: 2 }],
    };

    const failed = await request.post("/api/requests", { data: {
      ...body,
      items: [...body.items, { inventoryItemId: randomUUID(), itemName: "Inventory removed before submit", requestedQuantity: 1 }],
    } });
    expect(failed.status()).toBe(409);
    expect(await failed.json()).toMatchObject({ message: expect.stringContaining("Refresh the item list") });
    const emptyHistory = await request.get(`/api/requests/lookup/${identifier}`);
    expect(emptyHistory.status()).toBe(200);
    expect(await emptyHistory.json()).toEqual([]);
    expect(await (await request.get(`/api/notifications/${identifier}`)).json()).toEqual([]);

    const saved = await request.post("/api/requests", { data: body });
    expect(saved.status()).toBe(201);
    const foodRequest = await saved.json();
    expect(foodRequest.items).toHaveLength(1);
    expect(foodRequest.items[0]).toMatchObject({ inventoryItemId: item.id, itemName: item.name, itemCategory: item.category ?? null, requestedQuantity: 2 });
    const denied = await request.post("/api/requests", { data: { ...body, clientIdentifier: identifier.toLowerCase() } });
    expect(denied.status()).toBe(429);
    expect(await denied.json()).toMatchObject({ message: "Rate limit exceeded. Maximum 1 requests per day." });
    const history = await (await request.get(`/api/requests/lookup/${identifier}`)).json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: foodRequest.id, status: "pending" });
    const detail = await (await request.get(`/api/requests/${foodRequest.id}`)).json();
    expect(detail.auditLog.filter((entry: { action: string }) => entry.action === "created")).toHaveLength(1);
    const notifications = await (await request.get(`/api/notifications/${identifier}`)).json();
    expect(notifications.filter((entry: { type: string }) => entry.type === "request_submitted")).toHaveLength(1);
  } finally {
    expect((await request.put("/api/settings/maxRequestsPerDay", { data: { value: previousLimit } })).status()).toBe(200);
  }
});

test("a supervised request is submitted, approved, and picked up with one complete stock movement", async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `E2E Request Student ${suffix}`;
  const identifier = `E2E-REQ-${suffix}`;
  const itemName = `E2E Request Rice ${suffix}`;
  const seeded = await request.post("/api/inventory", {
    data: { name: itemName, category: "Dry Goods", quantity: 10, weightPerUnitLbs: "1.5000", valuePerUnitUsd: "2.00" },
  });
  expect(seeded.status()).toBe(201);
  const item = await seeded.json();

  await page.goto("/kiosk");
  await page.getByRole("button", { name: "Start a Request", exact: true }).click();
  await page.getByTestId("input-req-client-name").fill(name);
  await page.getByTestId("input-req-client-identifier").fill(identifier);
  await page.getByTestId("button-req-continue").click();
  await page.getByTestId("input-item-search").fill(itemName);
  await page.getByTestId(`button-item-plus-${item.id}`).click();
  await page.getByTestId(`button-item-plus-${item.id}`).click();
  await page.getByRole("button", { name: "Continue with 1 item(s)", exact: true }).click();
  await page.getByTestId("textarea-req-reason").fill("Synthetic local request for pantry support.");
  await page.getByTestId("textarea-req-student-note").fill("Synthetic pickup note.");
  await page.getByTestId("button-reason-submit").click();
  const [submitted] = await Promise.all([
    page.waitForResponse(isPost("/api/requests")),
    page.getByRole("button", { name: "Confirm and Submit", exact: true }).click(),
  ]);
  expect(submitted.status()).toBe(201);
  await expect(page.getByTestId("text-success-heading")).toHaveText("Request Submitted!");
  const savedRequests = await (await request.get(`/api/requests/lookup/${identifier}`)).json();
  expect(savedRequests).toHaveLength(1);
  const foodRequest = savedRequests[0];
  expect(foodRequest).toMatchObject({ clientName: name, clientIdentifier: identifier, status: "pending", studentNote: "Synthetic pickup note." });
  expect(foodRequest.items).toHaveLength(1);
  expect(foodRequest.items[0]).toMatchObject({ inventoryItemId: item.id, requestedQuantity: 2 });

  const initialDetail = await (await request.get(`/api/requests/${foodRequest.id}`)).json();
  expect(initialDetail.auditLog.filter((entry: { action: string }) => entry.action === "created")).toHaveLength(1);
  const notifications = await (await request.get(`/api/notifications/${identifier}`)).json();
  expect(notifications.filter((entry: { requestId: string; type: string }) => entry.requestId === foodRequest.id && entry.type === "request_submitted")).toHaveLength(1);

  await page.goto("/requests");
  await page.getByPlaceholder("Search name or ID...").fill(identifier);
  const row = page.getByRole("row").filter({ hasText: identifier });
  await expect(row).toContainText("Pending");
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  const [approved] = await Promise.all([
    page.waitForResponse(isPost(`/api/requests/${foodRequest.id}/approve`)),
    page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click(),
  ]);
  expect(approved.status()).toBe(200);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(row).toContainText("Approved");
  expect(await (await request.get(`/api/requests/${foodRequest.id}`)).json()).toMatchObject({ status: "approved" });
  const reserved = await (await request.get("/api/inventory")).json();
  expect(reserved.find((entry: { id: string }) => entry.id === item.id)).toMatchObject({ quantity: 10, reservedQuantity: 2 });

  await row.getByRole("button", { name: "Fulfill", exact: true }).click();
  const [fulfilled] = await Promise.all([
    page.waitForResponse(isPost(`/api/requests/${foodRequest.id}/fulfill`)),
    page.getByRole("dialog").getByRole("button", { name: "Confirm Fulfillment", exact: true }).click(),
  ]);
  expect(fulfilled.status()).toBe(200);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(row).toContainText("Completed");
  const completed = await (await request.get(`/api/requests/${foodRequest.id}`)).json();
  expect(completed).toMatchObject({ status: "completed" });
  expect(completed.transactionId).toEqual(expect.any(String));
  const inventory = await (await request.get("/api/inventory")).json();
  expect(inventory.find((entry: { id: string }) => entry.id === item.id)).toMatchObject({ quantity: 8, reservedQuantity: 0 });
  const transactions = await (await request.get("/api/transactions")).json();
  const movements = transactions.filter((entry: { id: string }) => entry.id === completed.transactionId);
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({ type: "OUT" });
  expect(movements[0].items).toHaveLength(1);
  expect(movements[0].items[0]).toMatchObject({ inventoryItemId: item.id, quantity: 2 });
});
