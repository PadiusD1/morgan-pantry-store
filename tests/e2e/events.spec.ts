import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const unique = (label: string) => `E2E ${label} ${randomUUID().slice(0, 8)}`;
const write = (pathname: string, method = "POST") => (response: Response) => new URL(response.url()).pathname === pathname && response.request().method() === method;
const idem = () => ({ "Idempotency-Key": randomUUID() });

async function signIn(browser: Browser, baseURL: string | undefined, role: "staff" | "volunteer" | "student", viewport = { width: 1440, height: 1000 }): Promise<BrowserContext> {
  const email = process.env[`FRC_E2E_${role.toUpperCase()}_EMAIL`];
  const password = process.env[`FRC_E2E_${role.toUpperCase()}_PASSWORD`];
  if (!email || !password) throw new Error(`Synthetic ${role} credentials are required.`);
  const context = await browser.newContext({ baseURL, viewport, timezoneId: "America/New_York", storageState: { cookies: [], origins: [] } });
  await context.addInitScript(() => { window.print = () => {}; });
  const login = await context.request.post("/api/auth/login", { data: { email, password } });
  expect(login.status(), await login.text()).toBe(200);
  return context;
}

async function created(response: Promise<import("@playwright/test").APIResponse>) {
  const res = await response;
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}
const newItem = (api: APIRequestContext, quantity = 40, weight = "1", value = "2.50") =>
  created(api.post("/api/inventory", { headers: idem(), data: { name: unique("Event item"), quantity, category: "Grains", weightPerUnitLbs: weight, valuePerUnitUsd: value } }));
const newEvent = (api: APIRequestContext, name = unique("Event")) =>
  created(api.post("/api/frc-events", { headers: idem(), data: { name, startsAt: new Date().toISOString() } }));
async function seededClient(api: APIRequestContext, identifier: string) {
  const clients = await (await api.get("/api/clients")).json();
  const client = clients.find((row: { identifier: string }) => row.identifier === identifier);
  expect(client, `seeded client ${identifier}`).toBeTruthy();
  return client as { id: string; name: string };
}

async function fillCart(page: Page, client: { id: string; name: string }, itemId: string) {
  await page.getByTestId("select-cart-item").click();
  await page.getByTestId(`option-cart-item-${itemId}`).click();
  await page.getByTestId("button-client-search").click();
  await page.getByTestId("input-client-search").fill(client.name);
  await page.getByTestId(`option-client-${client.id}`).click();
  await expect(page.getByTestId("input-client-name")).toHaveValue(client.name);
}
async function saveCheckout(page: Page) {
  const [response] = await Promise.all([page.waitForResponse(write("/api/transactions")), page.getByTestId("button-save-check-out").click()]);
  return response;
}
async function completeCheckout(page: Page, client: { id: string; name: string }, itemId: string, eventName: string | null) {
  await fillCart(page, client, itemId);
  const response = await saveCheckout(page);
  expect(response.status(), await response.text()).toBe(201);
  const saved = await response.json();
  const receipt = page.getByRole("dialog", { name: "Distribution Receipt" });
  await expect(receipt).toBeVisible();
  await receipt.hover();
  if (eventName) await expect(page.getByTestId("receipt-event")).toContainText(eventName);
  else await expect(page.getByTestId("receipt-event")).toHaveCount(0);
  await receipt.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(receipt).toBeHidden();
  return saved as { id: string; eventId: string | null; eventName: string | null };
}
async function chooseEvent(page: Page, eventId: string | null) {
  await page.getByTestId("select-active-event").click();
  const [response] = await Promise.all([
    page.waitForResponse(write("/api/frc-events/session", "PUT")),
    page.getByTestId(eventId ? `option-event-${eventId}` : "option-event-none").click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
}

test("staff keep one event through checkouts, reloads and pages, and switch or clear it explicitly", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const context = await signIn(browser, baseURL, "staff");
  try {
    const api = context.request;
    const item = await newItem(api);
    const student = await seededClient(api, "T0000001");
    const page = await context.newPage();
    await page.goto("/check-out");
    await expect(page.getByTestId("text-active-event")).toContainText("No event selected");

    // Create from checkout, which selects it for this session.
    const firstName = unique("Saturday Market");
    await page.getByTestId("button-new-event").click();
    await page.getByTestId("input-event-name").fill(firstName);
    const [createdEvent] = await Promise.all([page.waitForResponse(write("/api/frc-events")), page.getByTestId("button-save-event").click()]);
    expect(createdEvent.status()).toBe(201);
    const first = await createdEvent.json();
    await expect(page.getByTestId("text-active-event")).toHaveText(firstName);

    const one = await completeCheckout(page, student, item.id, firstName);
    const two = await completeCheckout(page, student, item.id, firstName);
    expect([one.eventId, two.eventId]).toEqual([first.id, first.id]);

    await page.reload();
    await expect(page.getByTestId("text-active-event")).toHaveText(firstName);
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    await nav.getByRole("link", { name: "Inventory", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
    await nav.getByRole("link", { name: "Check-Out", exact: true }).click();
    await expect(page.getByTestId("text-active-event")).toHaveText(firstName);

    // Switching keeps the cart that is being built.
    const secondName = unique("Evening Pantry");
    const second = await newEvent(api, secondName);
    await page.reload();
    await page.getByTestId("select-cart-item").click();
    await page.getByTestId(`option-cart-item-${item.id}`).click();
    await chooseEvent(page, second.id);
    await expect(page.getByTestId("text-active-event")).toHaveText(secondName);
    await expect(page.getByTestId(`row-cart-${item.id}`)).toBeVisible();
    await page.getByTestId("button-client-search").click();
    await page.getByTestId("input-client-search").fill(student.name);
    await page.getByTestId(`option-client-${student.id}`).click();
    const switchedResponse = await saveCheckout(page);
    expect(switchedResponse.status()).toBe(201);
    expect((await switchedResponse.json()).eventId).toBe(second.id);
    await page.getByRole("dialog", { name: "Distribution Receipt" }).getByRole("button", { name: "Close", exact: true }).first().click();

    await page.getByTestId("button-clear-event").click();
    await expect(page.getByTestId("text-active-event")).toContainText("No event selected");
    const general = await completeCheckout(page, student, item.id, null);
    expect(general.eventId).toBeNull();

    const history = await (await api.get("/api/transactions")).json();
    const mine = history.filter((tx: any) => tx.items.some((line: any) => line.inventoryItemId === item.id));
    expect(mine.map((tx: any) => tx.eventId).sort()).toEqual([first.id, first.id, second.id, null].sort());
    await page.screenshot({ path: testInfo.outputPath("checkout-with-event.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("a checkout whose answer was lost is recorded once with its event when saved again", async ({ browser, baseURL }) => {
  const context = await signIn(browser, baseURL, "staff");
  try {
    const api = context.request;
    const item = await newItem(api);
    const student = await seededClient(api, "T0000002");
    const event = await newEvent(api);
    expect((await api.put("/api/frc-events/session", { data: { eventId: event.id } })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto("/check-out");
    await expect(page.getByTestId("text-active-event")).toHaveText(event.name);
    let lost = false;
    await context.route("**/api/transactions", async (route) => {
      if (route.request().method() === "POST" && !lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await fillCart(page, student, item.id);
    await page.getByTestId("button-save-check-out").click();
    await expect(page.getByText("Save not confirmed").first()).toBeVisible();
    await expect(page.getByTestId(`row-cart-${item.id}`)).toBeVisible();
    const retry = await saveCheckout(page);
    expect(retry.status()).toBe(201);
    expect((await retry.json()).eventId).toBe(event.id);
    const history = await (await api.get("/api/transactions")).json();
    expect(history.filter((tx: any) => tx.items.some((line: any) => line.inventoryItemId === item.id))).toHaveLength(1);
    expect((await (await api.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(39);
  } finally {
    await context.close();
  }
});

test("an event ended while the cart was open records nothing, keeps the cart and says why", async ({ browser, baseURL }) => {
  const context = await signIn(browser, baseURL, "staff");
  try {
    const api = context.request;
    const item = await newItem(api);
    const student = await seededClient(api, "T0000003");
    const event = await newEvent(api);
    expect((await api.put("/api/frc-events/session", { data: { eventId: event.id } })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto("/check-out");
    await fillCart(page, student, item.id);
    expect((await api.post(`/api/frc-events/${event.id}/close`, { headers: idem() })).status()).toBe(200);
    const refused = await saveCheckout(page);
    expect(refused.status()).toBe(409);
    await expect(page.getByText(`${event.name} has ended`).first()).toBeVisible();
    await expect(page.getByTestId(`row-cart-${item.id}`)).toBeVisible();
    await expect(page.getByTestId("text-event-ended")).toContainText(event.name);
    expect((await (await api.get(`/api/inventory/${item.id}`)).json()).quantity).toBe(40);
    const history = await (await api.get("/api/transactions")).json();
    expect(history.filter((tx: any) => tx.eventId === event.id)).toHaveLength(0);
    // Saving again records the same cart as general distribution.
    const saved = await saveCheckout(page);
    expect(saved.status()).toBe(201);
    expect((await saved.json()).eventId).toBeNull();
  } finally {
    await context.close();
  }
});

test("volunteers choose events but cannot create or end them, students never reach them, and sessions never share a choice", async ({ browser, baseURL }) => {
  const staff = await signIn(browser, baseURL, "staff");
  const volunteer = await signIn(browser, baseURL, "volunteer");
  const student = await signIn(browser, baseURL, "student");
  try {
    const event = await newEvent(staff.request);
    expect((await staff.request.put("/api/frc-events/session", { data: { eventId: event.id } })).status()).toBe(200);
    const page = await volunteer.newPage();
    await page.goto("/check-out");
    await expect(page.getByTestId("text-active-event")).toContainText("No event selected");
    await expect(page.getByTestId("button-new-event")).toHaveCount(0);
    await chooseEvent(page, event.id);
    await expect(page.getByTestId("text-active-event")).toHaveText(event.name);
    expect((await volunteer.request.post("/api/frc-events", { headers: idem(), data: { name: unique("Volunteer"), startsAt: new Date().toISOString() } })).status()).toBe(403);
    expect((await volunteer.request.post(`/api/frc-events/${event.id}/close`, { headers: idem() })).status()).toBe(403);
    await page.goto("/reports");
    await expect(page.getByTestId("card-event-board")).toBeVisible();
    await expect(page.getByTestId("button-export-event-csv")).toHaveCount(0);

    // A second sign in of the staff account is a different session.
    const again = await signIn(browser, baseURL, "staff");
    try {
      expect((await (await again.request.get("/api/frc-events/session")).json()).selection).toBeNull();
    } finally { await again.close(); }
    expect((await (await staff.request.get("/api/frc-events/session")).json()).selection.event.id).toBe(event.id);

    expect((await student.request.get("/api/frc-events")).status()).toBe(403);
    expect((await student.request.get("/api/frc-events/session")).status()).toBe(403);
    const studentPage = await student.newPage();
    await studentPage.goto("/check-out");
    await expect(studentPage).toHaveURL(/\/portal/);
    await expect(studentPage.getByTestId("event-bar")).toHaveCount(0);
  } finally {
    await Promise.all([staff.close(), volunteer.close(), student.close()]);
  }
});

test("the board keeps history unassigned, ranks recorded donors, separates IN and OUT, and exports the same selection", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.context().addInitScript(() => { window.print = () => {}; });
  const item = await newItem(request, 200, "1", "2.50");
  const unweighed = await newItem(request, 200, "0", "1.00");
  const event = await newEvent(request, unique("Board Drive"));
  const donors = await (await request.get("/api/donors")).json();
  const grocery = donors.find((row: { name: string }) => row.name === "Test Donor Grocery");
  const church = donors.find((row: { name: string }) => row.name === "Test Donor Church");
  const partner = await seededClient(request, "PARTNER-TEST-1");
  const studentOne = await seededClient(request, "T0000001");
  const studentTwo = await seededClient(request, "T0000002");
  const line = (inventory: { id: string; name: string }, quantity: number, weight: string, value: string) => [{ inventoryItemId: inventory.id, name: inventory.name, quantity, weightPerUnitLbs: weight, valuePerUnitUsd: value }];
  const post = (data: unknown) => created(request.post("/api/transactions", { headers: idem(), data }));
  await post({ type: "IN", source: "Donation", donor: grocery.name, donorId: grocery.id, eventId: event.id, items: line(item, 12, "1", "2.50") });
  await post({ type: "IN", source: "Donation", donor: church.name, donorId: church.id, eventId: event.id, items: line(item, 5, "1", "2.50") });
  await post({ type: "IN", source: "Partner Donation", donor: partner.name, clientId: partner.id, clientName: partner.name, eventId: event.id, items: line(unweighed, 20, "0", "1.00") });
  for (const client of [studentOne, studentTwo, studentOne]) {
    await post({ type: "OUT", clientId: client.id, clientName: client.name, eventId: event.id, items: line(item, 2, "1", "2.50") });
  }
  await post({ type: "OUT", clientId: studentTwo.id, clientName: studentTwo.name, items: line(item, 1, "1", "2.50") });

  await page.goto("/reports");
  const card = page.getByTestId("card-event-board");
  await expect(card).toBeVisible();
  await page.getByTestId("radio-event-scope-chosen").check();
  await page.getByTestId(`checkbox-board-event-${event.id}`).check();
  const distributions = page.getByTestId("event-board-section-distributions");
  await expect(distributions.getByRole("row", { name: new RegExp(event.name) })).toContainText("3");
  await expect(distributions).toContainText("Not assigned to an event");
  const clients = page.getByTestId("event-board-section-clients");
  await expect(clients.getByRole("row", { name: new RegExp(event.name) }).getByRole("cell").nth(2)).toHaveText("2");
  const donations = page.getByTestId("event-board-section-donations");
  await expect(donations.getByRole("row", { name: new RegExp(event.name) }).getByRole("cell").nth(2)).toHaveText("3");

  // Only this event, without the seeded history, once the unassigned box is cleared.
  await page.getByTestId("checkbox-board-unassigned").uncheck();
  await expect(distributions).not.toContainText("Not assigned to an event");
  const contributors = page.getByTestId("event-board-section-contributors");
  await expect(contributors.getByRole("row").nth(1)).toContainText(partner.name);
  await expect(contributors.getByRole("row").nth(2)).toContainText("Test Donor Grocery");
  await expect(contributors.getByRole("row").nth(3)).toContainText("Test Donor Church");
  await page.getByTestId("select-event-board-rank").click();
  await page.getByRole("option", { name: "recorded pounds received" }).click();
  await expect(contributors.getByRole("row").nth(1)).toContainText("Test Donor Grocery");
  await expect(contributors.getByRole("row", { name: new RegExp(partner.name) })).toContainText("Incomplete");
  await card.screenshot({ path: testInfo.outputPath("event-board-card.png") });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("button-export-event-csv").click()]);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain(event.name);
  expect(csv).toContain("Test Donor Grocery");
  expect(csv).toContain("recorded pounds received");
  expect(csv).not.toContain("Not assigned to an event");
  for (const secret of [studentOne.name, studentTwo.name, "T0000001", "T0000002", "student.one@"]) expect(csv).not.toContain(secret);
  await writeFile(testInfo.outputPath("event-board.csv"), csv);

  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("button-print-event-board").click()]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.getByRole("heading", { level: 1, name: "Events and Contributors" })).toBeVisible();
  await expect(popup.locator("body")).toContainText(event.name);
  await expect(popup.locator("body")).toContainText("Systems by Design");
  const html = await popup.content();
  for (const secret of [studentOne.name, studentTwo.name, "T0000001"]) expect(html).not.toContain(secret);
  await popup.close();
  const document = await page.context().newPage();
  await document.emulateMedia({ media: "print" });
  await document.setContent(html);
  const pdf = await document.pdf({ path: testInfo.outputPath("event-board.pdf"), printBackground: true, preferCSSPageSize: true, tagged: true });
  expect(pdf.toString("latin1")).toContain("/StructTreeRoot");
  const minimumPx = await document.evaluate(() => Math.min(...[...document.querySelectorAll<HTMLElement>("tbody td, tbody th, .note, .definitions li")].map((el) => parseFloat(getComputedStyle(el).fontSize))));
  expect(minimumPx).toBeGreaterThanOrEqual(13.32);
  await document.screenshot({ path: testInfo.outputPath("event-board-print.png"), fullPage: true });
  await document.close();
});

test("events are managed with an audit history, and an event with activity cannot be deleted", async ({ page, request }) => {
  const name = unique("Managed Event");
  await page.goto("/events");
  await page.getByTestId("button-create-event-page").click();
  await page.getByTestId("input-event-name").fill(name);
  await page.getByTestId("input-event-start").fill("2026-11-07T10:00");
  await page.getByTestId("input-event-end").fill("2026-11-07T09:00");
  await page.getByTestId("button-save-event").click();
  await expect(page.getByTestId("text-event-form-error")).toContainText("The end must be at or after the start");
  await page.getByTestId("input-event-end").fill("2026-11-07T13:00");
  const [response] = await Promise.all([page.waitForResponse(write("/api/frc-events")), page.getByTestId("button-save-event").click()]);
  expect(response.status()).toBe(201);
  const event = await response.json();
  const row = page.getByTestId(`row-event-${event.id}`);
  await expect(row).toContainText("Sat, Nov 7, 2026, 10:00 AM to 1:00 PM");
  await row.getByTestId(`button-close-event-${event.id}`).click();
  await page.getByTestId("button-confirm-event-action").click();
  await expect(row.getByTestId(`button-reopen-event-${event.id}`)).toBeVisible();
  await row.getByTestId(`button-reopen-event-${event.id}`).click();
  await page.getByTestId("button-confirm-event-action").click();
  await expect(row.getByTestId(`button-close-event-${event.id}`)).toBeVisible();
  await row.getByTestId(`button-history-event-${event.id}`).click();
  await expect(page.getByTestId(`list-event-history-${event.id}`)).toContainText("Created");
  await expect(page.getByTestId(`list-event-history-${event.id}`)).toContainText("Ended");
  await expect(page.getByTestId(`list-event-history-${event.id}`)).toContainText("Reopened");

  const item = await newItem(request);
  const client = await seededClient(request, "T0000004");
  await created(request.post("/api/transactions", { headers: idem(), data: { type: "OUT", clientId: client.id, clientName: client.name, eventId: event.id, items: [{ inventoryItemId: item.id, name: item.name, quantity: 1, weightPerUnitLbs: "1", valuePerUnitUsd: "2.50" }] } }));
  await page.reload();
  await expect(page.getByTestId(`text-event-activity-${event.id}`)).toContainText("1 checkout");
  await expect(page.getByTestId(`button-delete-event-${event.id}`)).toHaveCount(0);
  expect((await request.delete(`/api/frc-events/${event.id}`, { headers: idem() })).status()).toBe(409);
});

test("event controls stay usable on a phone with no sideways scrolling", async ({ browser, baseURL }, testInfo) => {
  const context = await signIn(browser, baseURL, "staff", { width: 390, height: 844 });
  try {
    const event = await newEvent(context.request);
    expect((await context.request.put("/api/frc-events/session", { data: { eventId: event.id } })).status()).toBe(200);
    const page = await context.newPage();
    for (const path of ["/check-out", "/check-in", "/events", "/reports"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (path === "/check-out" || path === "/check-in") {
        await expect(page.getByTestId("text-active-event")).toHaveText(event.name);
        const box = await page.getByTestId("select-active-event").boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (path === "/reports") {
        await expect(page.getByTestId("card-event-board")).toBeVisible();
        await page.getByTestId("card-event-board").screenshot({ path: testInfo.outputPath("mobile-event-board-card.png") });
      }
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(layout.scrollWidth, `${path} should not overflow at 390px`).toBeLessThanOrEqual(layout.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`mobile-${path.slice(1)}.png`), fullPage: true });
    }
    // The check in toggle counts a donation toward the event only when ticked.
    await page.goto("/check-in");
    const [toggled] = await Promise.all([page.waitForResponse(write("/api/frc-events/session", "PUT")), page.getByTestId("checkbox-tag-inbound").click()]);
    expect((await toggled.json()).selection.tagInbound).toBe(true);
    await expect(page.getByTestId("text-active-event-when")).toContainText("count toward this event");
  } finally {
    await context.close();
  }
});
