import { expect, test, type APIRequestContext, type Response } from "@playwright/test";
import { randomUUID } from "node:crypto";
const unique = (label: string) => `E2E ${label} ${randomUUID().slice(0, 8)}`;
const write = (pathname: string) => (response: Response) => new URL(response.url()).pathname === pathname && response.request().method() === "POST";
async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test("newest zero-donation additions are visible after refreshing an already open donor list", async ({ page, request }) => {
  await post(request, "/api/donors", { name: unique("A older donor"), status: "active" });
  await page.goto("/donors");
  await expect(page.getByTestId("card-donors-table")).toBeVisible();
  const donor = await post(request, "/api/donors", { name: unique("Z newest donor"), status: "active" });
  await page.getByTestId("button-refresh-donors").click();
  await expect(page.locator('[data-testid^="row-donor-"]').first()).toHaveAttribute("data-testid", `row-donor-${donor.id}`);
  await expect(page.getByTestId(`text-donor-total-donations-${donor.id}`)).toHaveText("0");
  await page.reload();
  await expect(page.locator('[data-testid^="row-donor-"]').first()).toHaveAttribute("data-testid", `row-donor-${donor.id}`);
});

test("registration from Donors can create a partner in the correct directory and source list", async ({ page, request }) => {
  const name = unique("Registered partner");
  await page.goto("/donors");
  await page.getByTestId("button-add-donor").click();
  await page.getByTestId("select-registration-type").selectOption("partner");
  await page.getByTestId("input-edit-donor-name").fill(name);
  const [response] = await Promise.all([page.waitForResponse(write("/api/clients")), page.getByTestId("button-save-donor").click()]);
  expect(response.status()).toBe(201);
  const partner = await response.json();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByTestId(`text-partner-name-${partner.id}`)).toHaveText(name);
  const sources = await (await request.get("/api/donation-sources")).json();
  expect(sources).toContainEqual(expect.objectContaining({ key: `partner:${partner.id}`, kind: "partner", name }));
  const donors = await (await request.get("/api/donors")).json();
  expect(donors.some((row: { name: string }) => row.name === name)).toBe(false);
  await page.reload();
  await expect(page.getByTestId(`text-partner-name-${partner.id}`)).toHaveText(name);
});

test("the new-client form offers Partner without creating a student record", async ({ page, request }) => {
  const name = unique("Client form partner");
  await page.goto("/clients");
  await page.getByTestId("button-add-client").click();
  await page.locator("#client-registration-type").selectOption("partner");
  await page.getByTestId("input-edit-client-name").fill(name);
  await page.getByTestId("input-edit-client-identifier").fill(`PARTNER-${randomUUID()}`);
  const [response] = await Promise.all([page.waitForResponse(write("/api/clients")), page.getByTestId("button-save-client").click()]);
  expect(response.status()).toBe(201);
  const partner = await response.json();
  expect(partner.clientType).toBe("partner");
  await expect(page.getByTestId(`text-partner-name-${partner.id}`)).toHaveText(name);
  const records = await (await request.get("/api/clients")).json();
  expect(records.filter((row: { name: string }) => row.name === name)).toHaveLength(1);
});

test("inline receiving reuses the newly registered partner for the next stock entry", async ({ page, request }) => {
  const name = unique("Inline partner");
  const item = await post(request, "/api/inventory", { name: unique("Received rice"), quantity: 0, weightPerUnitLbs: "1", valuePerUnitUsd: "2" });
  await page.goto("/check-in");
  await page.getByTestId("select-existing-item").click();
  await page.getByTestId(`option-existing-item-${item.id}`).click();
  await page.getByTestId("input-quantity-received").fill("2");
  await page.getByLabel("Source", { exact: true }).click();
  await page.getByRole("option", { name: "Donation", exact: true }).click();
  await page.getByLabel("Donor / Partner", { exact: true }).click();
  await page.getByRole("option", { name: "+ Register Donor / Partner", exact: true }).click();
  await page.getByTestId("select-inline-source-kind").selectOption("partner");
  await page.getByRole("textbox", { name: "New partner name", exact: true }).fill(name);
  const [first] = await Promise.all([page.waitForResponse(write("/api/transactions")), page.getByTestId("button-save-check-in").click()]);
  expect(first.status()).toBe(201);
  const firstTx = await first.json();
  expect(firstTx.clientId).toEqual(expect.any(String));
  expect(firstTx.donorId).toBeNull();
  await expect(page.getByTestId("input-quantity-received")).toHaveValue("0");
  await expect(page.getByTestId("select-inline-source-kind")).not.toBeVisible();
  await page.getByTestId("input-quantity-received").fill("1");
  const [second] = await Promise.all([page.waitForResponse(write("/api/transactions")), page.getByTestId("button-save-check-in").click()]);
  expect(second.status()).toBe(201);
  expect((await second.json()).clientId).toBe(firstTx.clientId);
  const partners = await (await request.get("/api/clients")).json();
  expect(partners.filter((row: { name: string }) => row.name === name)).toHaveLength(1);
});

test("partner registration preserves the checkout cart and receipts keep saved value, weight and savings", async ({ page, request }, testInfo) => {
  await page.context().addInitScript(() => { window.print = () => {}; });
  const name = unique("Checkout partner");
  const rice = await post(request, "/api/inventory", { name: unique("Receipt rice"), quantity: 10, weightPerUnitLbs: "0.5", valuePerUnitUsd: "1.25" });
  const beans = await post(request, "/api/inventory", { name: unique("Receipt beans"), quantity: 10, weightPerUnitLbs: "1", valuePerUnitUsd: "2" });
  await page.goto("/check-out");
  for (const item of [rice, beans]) {
    await page.getByTestId("select-cart-item").click();
    await page.getByTestId(`option-cart-item-${item.id}`).click();
  }
  await page.getByTestId(`input-cart-quantity-${rice.id}`).fill("2");
  await page.getByTestId(`input-cart-quantity-${beans.id}`).fill("3");
  await page.getByTestId("button-client-search").click();
  await page.getByTestId("option-partner-new").click();
  await page.getByTestId("input-checkout-partner-name").fill(name);
  await page.getByTestId("button-save-checkout-partner").click();
  await expect(page.getByRole("dialog", { name: "Register partner", exact: true })).not.toBeVisible();
  await expect(page.getByTestId("input-client-name")).toHaveValue(name);
  await expect(page.getByTestId("input-client-identifier")).toHaveAttribute("readonly", "");
  await expect(page.getByTestId(`input-cart-quantity-${rice.id}`)).toHaveValue("2");
  await expect(page.getByTestId(`input-cart-quantity-${beans.id}`)).toHaveValue("3");
  const [saved] = await Promise.all([page.waitForResponse(write("/api/transactions")), page.getByTestId("button-save-check-out").click()]);
  expect(saved.status()).toBe(201);
  const receipt = page.getByRole("dialog", { name: "Distribution Receipt" });
  await receipt.hover();
  await expect(page.getByTestId("receipt-weight")).toHaveText("4.00 lbs");
  await expect(page.getByTestId("receipt-value")).toHaveText("$8.50");
  await expect(page.getByTestId("receipt-savings")).toHaveText("−$8.50");
  await expect(page.getByTestId("receipt-amount-due")).toHaveText("$0.00");
  expect((await request.patch(`/api/inventory/${rice.id}`, { data: { valuePerUnitUsd: "99.00" } })).status()).toBe(200);
  await receipt.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("button-reprint-last-receipt").click();
  await receipt.hover();
  await expect(page.getByTestId("receipt-value")).toHaveText("$8.50");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await receipt.screenshot({ path: testInfo.outputPath("receipt-mobile.png") });
  const opened = page.waitForEvent("popup");
  await page.getByTestId("button-print-receipt").click();
  const printed = await opened;
  await expect(printed.getByTestId("receipt-value")).toHaveText("$8.50");
  await expect(printed.getByTestId("receipt-amount-due")).toHaveText("$0.00");
  await printed.pdf({ path: testInfo.outputPath("receipt-values.pdf"), format: "Letter", printBackground: true, tagged: true });
  await printed.screenshot({ path: testInfo.outputPath("receipt-print.png"), fullPage: true });
  await printed.close();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByTestId("button-print-receipt").click();
  await expect(page.getByText("Allow pop-ups for this site, then choose Print Receipt again.", { exact: true })).toBeVisible();
});
