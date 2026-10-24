import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { ALL_EVENT_BOARD_DATA, buildEventBoard, type BoardEvent, type EventBoardTransaction } from "../../shared/event-board";
import { eventBoardHtml } from "../../shared/event-board-document";

/** Deliberately synthetic. Renders the print document, not real pantry data. */
function fixture(eventCount: number, contributorCount: number) {
  const events: BoardEvent[] = Array.from({ length: eventCount }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    name: i % 3 === 0 ? `Illustrative Saturday Market and Community Resource Fair ${i + 1}` : `Illustrative Market ${i + 1}`,
    startsAt: new Date(Date.UTC(2025, i, 11, 15)).toISOString(), status: i < eventCount - 1 ? "closed" : "active",
  }));
  const donors = Array.from({ length: contributorCount }, (_, i) => ({ id: `donor-${i}`, name: `Illustrative Contributor ${i + 1}` }));
  const clients = Array.from({ length: 30 }, (_, i) => ({ id: `client-${i}`, name: `Synthetic ${i}`, clientType: i % 7 === 0 ? "partner" : "student" }));
  const transactions: EventBoardTransaction[] = [];
  events.forEach((event, e) => {
    for (let v = 0; v < (e % 5) + 2; v++) transactions.push({ id: `out-${e}-${v}`, type: "OUT", timestamp: event.startsAt, eventId: event.id, clientId: `client-${(e + v) % 30}`, items: [{ itemId: "rice", name: "Rice", quantity: v + 1, weightPerUnitLbs: v % 4 === 0 ? 0 : 1.5, valuePerUnitUsd: 2.25 }] });
  });
  donors.forEach((donor, d) => transactions.push({ id: `in-${d}`, type: "IN", timestamp: events[d % eventCount].startsAt, eventId: events[d % eventCount].id, donorId: donor.id, donor: donor.name, items: [{ itemId: "beans", name: "Beans", quantity: (contributorCount - d) * 3, weightPerUnitLbs: d % 5 === 0 ? 0 : 1, valuePerUnitUsd: 1.1 }] }));
  transactions.push({ id: "out-unassigned", type: "OUT", timestamp: events[0].startsAt, clientId: "client-1", items: [{ itemId: "rice", name: "Rice", quantity: 2, weightPerUnitLbs: 1.5, valuePerUnitUsd: 2.25 }] });
  return buildEventBoard({ transactions, events, donors, clients, range: { from: "", to: "" }, scope: { kind: "all" }, rankMetric: "weight", now: new Date("2026-10-24T22:00:00Z") });
}

for (const [events, contributors, topN] of [[1, 3, 10], [14, 25, 0]] as const) {
  test(`event board print: ${events} events and ${contributors} contributors keep readable, unbroken pages`, async ({ page }, info) => {
    await page.setViewportSize({ width: 710, height: 960 });
    await page.emulateMedia({ media: "print" });
    await page.setContent(eventBoardHtml(fixture(events, contributors), ALL_EVENT_BOARD_DATA, topN));
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page.getByRole("heading", { level: 1, name: "Events and Contributors" })).toBeVisible();
    const measured = await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>(".event-table tbody td, .event-table tbody th, .note, .definitions li")];
      // A word split across lines shows as a cell taller than its text needs.
      const splitWords = [...document.querySelectorAll<HTMLElement>(".event-table thead th, .event-table tbody td")].filter((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const lines = range.getClientRects().length;
        const words = (cell.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
        return lines > words;
      }).map((cell) => cell.textContent);
      return {
        minimumPx: Math.min(...cells.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        headerMinimumPx: Math.min(...[...document.querySelectorAll<HTMLElement>(".event-table thead th")].map((el) => parseFloat(getComputedStyle(el).fontSize))),
        documentWidthPx: document.documentElement.scrollWidth,
        splitWords,
        h1: document.querySelectorAll("h1").length,
      };
    });
    expect(measured.minimumPx).toBeGreaterThanOrEqual(13.32); // 10pt body.
    expect(measured.headerMinimumPx).toBeGreaterThanOrEqual(10.66); // 8pt labels.
    expect(measured.documentWidthPx).toBeLessThanOrEqual(711);
    expect(measured.splitWords).toEqual([]);
    expect(measured.h1).toBe(1);
    const stem = `event-board-${events}-events`;
    const pdf = await page.pdf({ path: info.outputPath(`${stem}.pdf`), printBackground: true, preferCSSPageSize: true, tagged: true });
    expect(pdf.toString("latin1")).toContain("/StructTreeRoot");
    await writeFile(info.outputPath(`${stem}.json`), JSON.stringify({ ...measured, pdfBytes: pdf.length, synthetic: true }, null, 2));
    await page.screenshot({ path: info.outputPath(`${stem}.png`), fullPage: true });
  });
}
