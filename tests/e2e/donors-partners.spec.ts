import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

// Authentication and the localhost-only target are supplied by playwright.config.ts.
// Each test uses unique synthetic records so rerunning against a local stack is safe.
const unique = (label: string) => `E2E ${label} ${randomUUID().slice(0, 8)}`;
const isWrite = (path: string, method: string) => (response: Response) =>
  new URL(response.url()).pathname === path && response.request().method() === method;

async function createDonorForm(page: Page, name: string, email = "") {
  await page.getByTestId("button-add-donor").click();
  await page.getByTestId("input-edit-donor-name").fill(name);
  if (email) await page.getByTestId("input-edit-donor-email").fill(email);
  const [response] = await Promise.all([
    page.waitForResponse(isWrite("/api/donors", "POST")),
    page.getByTestId("button-save-donor").click(),
  ]);
  expect(response.status()).toBe(201);
  const saved = await response.json();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId(`row-donor-${saved.id}`)).toBeVisible();
  return saved as { id: string; name: string };
}

async function seedDonor(request: APIRequestContext, name: string, fields: Record<string, unknown> = {}) {
  const response = await request.post("/api/donors", { data: { name, status: "active", ...fields } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; name: string }>;
}

test("a donor created in a filtered list stays visible through navigation and reload", async ({ page, request }) => {
  const name = unique("Visible donor");
  await page.goto("/donors");
  await page.getByTestId("input-donors-search").fill("a search that cannot match the new donor");
  const donor = await createDonorForm(page, name, "visible-donor@example.test");

  await expect(page.getByTestId("input-donors-search")).toHaveValue("");
  await expect(page.getByTestId(`text-donor-name-${donor.id}`)).toHaveText(name);
  await page.getByRole("link", { name: "Partners", exact: true }).click();
  await expect(page.getByTestId("card-partners-table")).toBeVisible();
  await page.getByRole("link", { name: "Donors", exact: true }).click();
  await expect(page.getByTestId(`row-donor-${donor.id}`)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`row-donor-${donor.id}`)).toBeVisible();
  await page.getByTestId(`row-donor-${donor.id}`).getByRole("link", { name, exact: true }).click();
  await expect(page.getByTestId("card-donor-profile")).toContainText(name);
  await expect(page.getByTestId("text-donor-email-detail")).toContainText("visible-donor@example.test");
  const persisted = await request.get(`/api/donors/${donor.id}`);
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({ id: donor.id, name, email: "visible-donor@example.test" });
});

test("a same-name donor response explains that the new details were not saved", async ({ page, request }) => {
  const name = unique("Existing donor");
  const donor = await seedDonor(request, name, { email: "original-donor@example.test" });
  await page.goto("/donors");
  await page.getByTestId("button-add-donor").click();
  await page.getByTestId("input-edit-donor-name").fill(`  ${name.toLowerCase()}  `);
  await page.getByTestId("input-edit-donor-email").fill("unsaved-donor@example.test");
  const [response] = await Promise.all([
    page.waitForResponse(isWrite("/api/donors", "POST")),
    page.getByTestId("button-save-donor").click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByTestId("alert-donor-exists")).toContainText("Your new details have not been saved");
  await expect(page.getByTestId("input-edit-donor-email")).toHaveValue("unsaved-donor@example.test");
  await expect(page.getByText("Donor created", { exact: true })).not.toBeVisible();

  const persisted = await (await request.get(`/api/donors/${donor.id}`)).json();
  expect(persisted.email).toBe("original-donor@example.test");
  const list = await (await request.get("/api/donors")).json();
  expect(list.filter((row: { name: string }) => row.name.trim().toLowerCase() === name.toLowerCase())).toHaveLength(1);

  await page.getByRole("button", { name: "Edit existing donor", exact: true }).click();
  await expect(page.getByTestId("text-edit-donor-heading")).toHaveText("Edit donor");
  await expect(page.getByTestId("input-edit-donor-email")).toHaveValue("original-donor@example.test");
});

test("a lost existing-donor response cannot turn an edited retry into an update to that donor", async ({ page, request }) => {
  const originalName = unique("Existing donor before lost response");
  const newName = unique("Different donor after lost response");
  const original = await seedDonor(request, originalName, { email: "original-replay@example.test" });
  let lostFirstReply = false;
  await page.route("**/api/donors", async (route) => {
    if (route.request().method() !== "POST" || lostFirstReply) return route.continue();
    lostFirstReply = true;
    // Complete the real request, including its idempotency record, then
    // simulate losing only the response on its way back to the browser.
    const saved = await route.fetch();
    expect(saved.status()).toBe(200);
    await route.abort("failed");
  });

  await page.goto("/donors");
  await page.getByTestId("button-add-donor").click();
  await page.getByTestId("input-edit-donor-name").fill(originalName);
  await page.getByTestId("input-edit-donor-email").fill("unsaved-replay@example.test");
  await page.getByTestId("button-save-donor").click();
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await page.getByTestId("input-edit-donor-name").fill(newName);
  await page.getByTestId("input-edit-donor-email").fill("new-replay@example.test");
  await page.getByTestId("button-save-donor").click();

  await expect(page.getByTestId("alert-donor-exists")).toContainText(originalName);
  await expect(page.getByTestId("text-edit-donor-heading")).toHaveText("Add new donor");
  await expect(page.getByTestId("input-edit-donor-name")).toHaveValue(newName);
  await expect(page.getByTestId("input-edit-donor-email")).toHaveValue("new-replay@example.test");
  expect(await (await request.get(`/api/donors/${original.id}`)).json()).toMatchObject({
    name: originalName, email: "original-replay@example.test",
  });

  // Keeping the different name creates a separate donor under a fresh key.
  // The user never chose the separate “Edit existing donor” action.
  const [created] = await Promise.all([
    page.waitForResponse(isWrite("/api/donors", "POST")),
    page.getByTestId("button-save-donor").click(),
  ]);
  expect(created.status()).toBe(201);
  const newDonor = await created.json();
  expect(newDonor).toMatchObject({ name: newName, email: "new-replay@example.test" });
  expect(newDonor.id).not.toBe(original.id);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await (await request.get(`/api/donors/${original.id}`)).json()).toMatchObject({
    id: original.id, name: originalName, email: "original-replay@example.test",
  });
});

test("cleared donor contact fields persist as empty after a fresh page load", async ({ page, request }) => {
  const name = unique("Contact donor");
  const fields = {
    organization: "Synthetic Organization", contactName: "Synthetic Contact", phone: "410-555-0108",
    email: "contact-donor@example.test", address: "123 Synthetic Street", notes: "Synthetic notes",
  };
  const donor = await seedDonor(request, name, fields);
  await page.goto("/donors");
  await page.getByTestId(`button-edit-donor-${donor.id}`).click();
  const testIds = ["org", "contact", "phone", "email", "address", "notes"];
  for (const field of testIds) await page.getByTestId(`input-edit-donor-${field}`).fill("");
  const [response] = await Promise.all([
    page.waitForResponse(isWrite(`/api/donors/${donor.id}`, "PATCH")),
    page.getByTestId("button-save-donor").click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const persisted = await (await request.get(`/api/donors/${donor.id}`)).json();
  for (const field of Object.keys(fields)) expect(persisted[field], `${field} should be cleared in storage`).toBeNull();

  await page.reload();
  await page.getByTestId(`button-edit-donor-${donor.id}`).click();
  for (const field of testIds) await expect(page.getByTestId(`input-edit-donor-${field}`)).toHaveValue("");
});

test("check-in refreshes a previously visited donor list and donation history", async ({ page, request }) => {
  const donor = await seedDonor(request, unique("Receiving donor"));
  const itemName = unique("Donated rice");
  const itemResponse = await request.post("/api/inventory", {
    data: { name: itemName, category: "Dry Goods", quantity: 0, weightPerUnitLbs: "1.5000", valuePerUnitUsd: "2.00" },
  });
  expect(itemResponse.status()).toBe(201);
  const item = await itemResponse.json();

  // Warm both caches before receiving stock. A full navigation here would
  // hide the regression by creating a new QueryClient, so use sidebar links.
  await page.goto("/donors");
  await expect(page.getByTestId(`text-donor-total-donations-${donor.id}`)).toHaveText("0");
  await page.getByTestId(`row-donor-${donor.id}`).getByRole("link").click();
  await expect(page.getByTestId("text-donor-no-donations")).toBeVisible();
  await page.getByRole("link", { name: "Check-In", exact: true }).click();
  await page.getByTestId("select-existing-item").click();
  await page.getByTestId(`option-existing-item-${item.id}`).click();
  await page.getByTestId("input-quantity-received").fill("4");
  await page.getByLabel("Source", { exact: true }).click();
  await page.getByRole("option", { name: "Donation", exact: true }).click();
  await page.getByLabel("Donor / Partner", { exact: true }).click();
  await page.getByRole("option", { name: donor.name, exact: true }).click();
  const [response] = await Promise.all([
    page.waitForResponse(isWrite("/api/transactions", "POST")),
    page.getByTestId("button-save-check-in").click(),
  ]);
  expect(response.status()).toBe(201);
  const transaction = await response.json();
  expect(transaction).toMatchObject({ donorId: donor.id, type: "IN" });
  await expect(page.getByTestId("input-quantity-received")).toHaveValue("0");

  await page.getByRole("link", { name: "Donors", exact: true }).click();
  await expect(page.getByTestId(`text-donor-total-donations-${donor.id}`)).toHaveText("1");
  await expect(page.getByTestId(`text-donor-total-items-${donor.id}`)).toHaveText("4");
  await page.getByTestId(`row-donor-${donor.id}`).getByRole("link").click();
  await expect(page.getByTestId(`row-donation-${transaction.id}`)).toContainText(itemName);
  await expect(page.getByTestId(`text-donation-qty-${transaction.id}`)).toHaveText("4");
  await expect(page.getByTestId("card-stat-total-weight")).toContainText("6.0");
  await expect(page.getByTestId("card-stat-estimated-value")).toContainText("$8.00");
  await expect(page.getByTestId("text-donor-no-donations")).not.toBeVisible();
});

test("a new partner with an existing identifier cannot rename the stored organization", async ({ page, request }) => {
  const originalName = unique("Original partner");
  const attemptedName = unique("Different partner");
  const identifier = `E2E-P-${randomUUID().slice(0, 8)}`;
  await page.goto("/partners");
  await page.getByTestId("button-add-partner").click();
  await page.getByTestId("input-edit-partner-name").fill(originalName);
  await page.getByTestId("input-edit-partner-identifier").fill(identifier);
  const [created] = await Promise.all([
    page.waitForResponse(isWrite("/api/clients", "POST")),
    page.getByTestId("button-save-partner").click(),
  ]);
  expect(created.status()).toBe(201);
  const original = await created.json();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId(`text-partner-name-${original.id}`)).toHaveText(originalName);

  await page.getByTestId("button-add-partner").click();
  await page.getByTestId("input-edit-partner-name").fill(attemptedName);
  await page.getByTestId("input-edit-partner-identifier").fill(identifier);
  const [duplicate] = await Promise.all([
    page.waitForResponse(isWrite("/api/clients", "POST")),
    page.getByTestId("button-save-partner").click(),
  ]);
  expect(duplicate.status()).toBe(409);
  await expect(page.getByText("Partner not saved", { exact: true })).toBeVisible();
  await expect(page.getByTestId("input-edit-partner-name")).toHaveValue(attemptedName);
  const clients = await (await request.get("/api/clients")).json();
  expect(clients.find((client: { id: string }) => client.id === original.id)).toMatchObject({ name: originalName, identifier, clientType: "partner" });
  expect(clients.filter((client: { identifier: string }) => client.identifier.toLowerCase() === identifier.toLowerCase())).toHaveLength(1);
  await page.getByTestId("button-cancel-edit-partner").click();
  await page.reload();
  await expect(page.getByTestId(`text-partner-name-${original.id}`)).toHaveText(originalName);
});
