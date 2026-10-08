import { test, expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Papa from "papaparse";

let api: APIRequestContext;
let reportRice: { id: string; name: string };
const clientName = "Private E2E Report Student";
const clientIdentifier = "E2EREPORT2024";
const donorName = "Private E2E Report Donor";

async function post(url: string, data: unknown) {
  // Reusing the fixture after a worker restart must not duplicate stock or clients.
  const key = createHash("sha256").update(`${url}:${JSON.stringify(data)}`).digest("hex");
  const response = await api.post(url, { data, headers: { "Idempotency-Key": `report-test-${key}` } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL, storageState: path.resolve(process.env.FRC_E2E_AUTH_DIR || ".tmp/e2e-auth", "admin.json") });
  const client = await post("/api/clients", { name: clientName, identifier: clientIdentifier, email: "report-student@example.invalid", classification: "Sophomore" });
  const rice = await post("/api/inventory", { name: "E2E Report Rice", category: "Grains", quantity: 100, weightPerUnitLbs: "0.5", valuePerUnitUsd: "1.25" });
  reportRice = rice;
  const beans = await post("/api/inventory", { name: "E2E Report Beans", category: "Grains", quantity: 100, weightPerUnitLbs: "1", valuePerUnitUsd: "2.00" });
  const riceLine = { inventoryItemId: rice.id, name: rice.name, quantity: 2, weightPerUnitLbs: "0.5", valuePerUnitUsd: "1.25" };
  const beansLine = { inventoryItemId: beans.id, name: beans.name, quantity: 3, weightPerUnitLbs: "1", valuePerUnitUsd: "2.00" };
  // A dedicated historic day isolates these assertions from other browser specs.
  await post("/api/transactions", {
    type: "IN", timestamp: "2024-09-30T18:00:00Z", source: "Donation", donor: donorName,
    items: [{ ...riceLine, quantity: 7 }],
  });
  await post("/api/transactions", {
    type: "OUT", timestamp: "2024-10-01T00:30:00Z", clientId: client.id, clientName,
    clientClassification: "Sophomore", isEmergency: true, latitude: 38.654321, longitude: -76.987654,
    items: [riceLine, beansLine],
  });
  await post("/api/transactions", {
    type: "OUT", timestamp: "2024-10-01T04:30:00Z", clientId: client.id, clientName,
    clientClassification: "Sophomore", items: [{ ...riceLine, quantity: 4, valuePerUnitUsd: "2.50" }],
  });
});

test.afterAll(async () => { await api?.dispose(); });

async function selectReportDay(page: Page) {
  await page.goto("/reports");
  await expect(page.getByTestId("card-board-summary")).toBeVisible();
  await page.getByTestId("input-report-from").fill("2024-09-30");
  await page.getByTestId("input-report-to").fill("2024-09-30");
  await expect(page.getByTestId("text-board-period")).toHaveText("2024-09-30 to 2024-09-30");
  await expect(page.getByTestId("text-board-visits")).toHaveText("1");
}

async function download(page: Page, testInfo: TestInfo, testId: string, artifact: string) {
  const pending = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const file = await pending;
  const output = testInfo.outputPath(artifact);
  await file.saveAs(output);
  return { filename: file.suggestedFilename(), bytes: await readFile(output) };
}

test("board CSV matches the selected Baltimore day and excludes client details", async ({ page }, testInfo) => {
  await selectReportDay(page);
  await expect(page.getByTestId("text-board-clients")).toHaveText("1");
  await expect(page.getByTestId("text-board-units")).toHaveText("5");
  await expect(page.getByTestId("text-board-weight")).toHaveText("4.0 lbs");
  await expect(page.getByTestId("text-board-value")).toHaveText("$8.50");
  await expect(page.getByTestId("text-board-emergencies")).toHaveText("1");
  const { filename, bytes } = await download(page, testInfo, "button-export-board-csv", "board-summary.csv");
  expect(filename).toBe("frc-board-summary-2024-09-30-to-2024-09-30.csv");
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = bytes.toString("utf8");
  expect(csv).toContain("Reporting period,2024-09-30 to 2024-09-30");
  expect(csv).toContain("Completed distribution visits,1,visits");
  expect(csv).toContain("Units distributed,5,units");
  expect(csv).toContain("Estimated value distributed,8.50,USD");
  expect(csv).toContain("Units received,7,units");
  for (const value of [clientName, clientIdentifier, donorName, "38.654321", "-76.987654", "report-student@example.invalid"]) expect(csv).not.toContain(value);
  await page.screenshot({ path: testInfo.outputPath("reports-desktop.png"), fullPage: true });
});

test("detailed CSV uses the same selected period and keeps useful operational columns", async ({ page }, testInfo) => {
  await selectReportDay(page);
  await page.getByTestId("details-data-tools").locator("summary").click();
  const { bytes } = await download(page, testInfo, "button-export-csv", "detailed-transactions.csv");
  const result = Papa.parse<Record<string, string>>(bytes.toString("utf8"), { header: true });
  expect(result.errors).toEqual([]);
  expect(result.data).toHaveLength(3); // One receipt line, two checkout lines.
  expect(new Set(result.data.map((row) => row.dateEastern))).toEqual(new Set(["2024-09-30"]));
  expect(result.data.filter((row) => row.type === "OUT")).toHaveLength(2);
  expect(result.data.some((row) => row.clientIdentifier === clientIdentifier)).toBe(true);
  expect(result.data.some((row) => row.source === "Donation" && row.donor === donorName)).toBe(true);
  expect(result.data.some((row) => row.timestamp === "2024-10-01T04:30:00.000Z")).toBe(false);
  await expect(page.getByTestId("input-import-json")).toBeDisabled();
});

test("annual monthly CSV counts a multi-item emergency as one visit", async ({ page }, testInfo) => {
  await selectReportDay(page);
  await page.getByTestId("select-monthly-year").selectOption("2024");
  const { filename, bytes } = await download(page, testInfo, "button-export-monthly-csv", "monthly-summary.csv");
  const csv = bytes.toString("utf8");
  expect(filename).toBe("frc-monthly-summary-2024.csv");
  expect(csv).toContain("Month,September 2024");
  expect(csv).toContain("Month,October 2024");
  expect(csv).toContain("2024 GRAND TOTAL,,,,18.50");
  expect(csv).toContain("2024 Emergency Shop Appointments,,,,1");
  expect(csv).toContain("Weighted average estimated value per unit (USD)");
  const emergencyFile = await download(page, testInfo, "button-export-monthly-emergency-csv", "monthly-emergency.csv");
  expect(emergencyFile.bytes.toString("utf8")).toContain("2024 GRAND TOTAL,,,,8.50");
});

test("print document contains the board metrics without the operational client tables", async ({ page }, testInfo) => {
  await page.context().addInitScript(() => { window.print = () => {}; });
  await selectReportDay(page);
  const opened = page.waitForEvent("popup");
  await page.getByTestId("button-print-board").click();
  const printed = await opened;
  await expect(printed.getByRole("heading", { name: "Board Summary", exact: true })).toBeVisible();
  await expect(printed.locator("body")).toContainText("2024-09-30 to 2024-09-30");
  await expect(printed.locator("body")).toContainText("$8.50");
  await expect(printed.locator("body")).toContainText("E2E Report Rice");
  await expect(printed.locator("body")).not.toContainText(clientName);
  await expect(printed.locator("body")).not.toContainText(clientIdentifier);
  await printed.screenshot({ path: testInfo.outputPath("board-print.png"), fullPage: true });
  await printed.close();
});

test("mobile controls support a download and reject an inverted date range", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await selectReportDay(page);
  await expect(page.getByTestId("button-export-board-csv")).toBeVisible();
  await download(page, testInfo, "button-export-board-csv", "mobile-board-summary.csv");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reports-mobile.png"), fullPage: true });
  await page.getByTestId("input-report-to").fill("2024-09-29");
  await expect(page.getByTestId("report-date-error")).toContainText("on or before");
  await expect(page.getByTestId("button-export-board-csv")).not.toBeVisible();
  await page.getByTestId("details-data-tools").locator("summary").click();
  await expect(page.getByTestId("button-export-csv")).toBeDisabled();
});

test("report failures remain visible instead of becoming false zero statistics", async ({ page }) => {
  await page.context().route("**/api/reports/emergencies", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Simulated database report failure" }) }));
  await selectReportDay(page);
  await expect(page.getByTestId("text-emergency-total")).toContainText("Unavailable");
  await expect(page.getByText("Could not load the lifetime emergency report.")).toBeVisible();
  await expect(page.getByTestId("text-no-emergencies")).not.toBeVisible();
});

test("paged client previews stay small while CSV includes every selected row", async ({ page }, testInfo) => {
  // Model legacy unlinked visits using genuine saved transactions on a separate day.
  for (let index = 0; index < 55; index += 1) {
    await post("/api/transactions", {
      type: "OUT", timestamp: "2023-06-01T14:00:00Z", clientName: `Pagination report client ${String(index).padStart(2, "0")}`,
      items: [{ inventoryItemId: reportRice.id, name: reportRice.name, quantity: 1, weightPerUnitLbs: "0.5", valuePerUnitUsd: "1.25" }],
    });
  }
  await page.goto("/reports");
  await expect(page.getByTestId("card-board-summary")).toBeVisible();
  await page.getByTestId("input-report-from").fill("2023-06-01");
  await page.getByTestId("input-report-to").fill("2023-06-01");
  await expect(page.getByTestId("text-board-visits")).toHaveText("55");
  const table = page.getByTestId("card-report-by-client");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  const next = page.getByRole("button", { name: "Next distribution clients page", exact: true });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Previous distribution clients page", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await page.getByTestId("details-data-tools").locator("summary").click();
  const { bytes } = await download(page, testInfo, "button-export-csv", "all-paged-transactions.csv");
  expect(Papa.parse(bytes.toString("utf8"), { header: true }).data).toHaveLength(55);
});
