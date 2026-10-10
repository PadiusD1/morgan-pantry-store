import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { boardSummaryHtml } from "../../shared/board-document";
import { buildBoardReport, type ReportTransaction } from "../../shared/reporting";

const names = ["Brown rice", "Black beans", "Oats", "Pasta", "Canned tomatoes", "Canned tuna", "Peanut butter", "Whole-grain cereal", "Lentils", "Canned vegetables"];
function fixture(monthCount: number) {
  const transactions: ReportTransaction[] = Array.from({ length: monthCount }, (_, m) => ({
    id: `synthetic-${m}`, type: "OUT", timestamp: new Date(Date.UTC(2020, m, 15, 12)).toISOString(),
    clientId: m === 0 ? undefined : `synthetic-client-${m % 3}`, isEmergency: m % 4 === 0,
    items: names.map((name, i) => ({ itemId: `synthetic-item-${i}`, name,
      quantity: (m % 6 + 1) * (i + 1), weightPerUnitLbs: i === 0 ? 0 : 1.25, valuePerUnitUsd: i === 0 ? 0 : 2.5,
    })),
  }));
  const report = buildBoardReport(transactions, [], { from: "", to: "" }, new Date("2026-10-09T16:00:00Z"));
  report.periodLabel = `ILLUSTRATIVE TEST DATA / ${monthCount} recorded months`;
  return report;
}

for (const monthCount of [0, 4, 12, 40]) {
  test(`board print quality: ${monthCount} months, readable type and tagged exporter`, async ({ page }, info) => {
    // Deliberate synthetic document rendering, not a read of real pantry data.
    // Production popup/CSP behavior is independently tested in brand-experience.
    await page.setViewportSize({ width: 710, height: 960 });
    await page.emulateMedia({ media: "print" });
    await page.setContent(boardSummaryHtml(fixture(monthCount)));
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page.getByRole("heading", { name: "Board Summary", exact: true })).toBeVisible();
    const measurements = await page.evaluate(() => {
      const essential = [...document.querySelectorAll<HTMLElement>(".note,.definitions li,.quality p,.stock-note,tbody td,tbody th")];
      return {
        minimumEssentialPx: Math.min(...essential.map(el => parseFloat(getComputedStyle(el).fontSize))),
        sectionHeightsPx: [...document.querySelectorAll<HTMLElement>(".report-page")].map(el => el.getBoundingClientRect().height),
        documentWidthPx: document.documentElement.scrollWidth,
        viewportWidthPx: innerWidth,
        headingCount: document.querySelectorAll("h1").length,
        note: "Layout/font-size checks, not complete accessibility or print-device certification.",
      };
    });
    expect(measurements.minimumEssentialPx).toBeGreaterThanOrEqual(13.32); // 10pt at 96 CSS px/in.
    expect(measurements.headingCount).toBe(1);
    expect(measurements.documentWidthPx).toBeLessThanOrEqual(711);
    // Letter page minus the template's 13mm top/bottom margins is about 958px.
    expect(Math.max(...measurements.sectionHeightsPx)).toBeLessThanOrEqual(956);
    const rows = page.locator(".ledger table tbody tr");
    await expect(rows).toHaveCount(monthCount);
    const stem = `board-quality-${monthCount}-months`;
    const pdf = await page.pdf({ path: info.outputPath(`${stem}.pdf`), printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
    expect(pdf.toString("latin1")).toContain("/StructTreeRoot");
    expect(pdf.toString("latin1")).toMatch(/\/Marked\s+true/);
    await writeFile(info.outputPath(`${stem}.json`), JSON.stringify({ ...measurements, pdfBytes: pdf.length, taggedExportRequested: true, structureTreeMarkerPresent: true, synthetic: true }, null, 2));
    await page.screenshot({ path: info.outputPath(`${stem}.png`), fullPage: true });
    await page.emulateMedia({ media: "screen" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (monthCount > 0) await expect(page.getByRole("region", { name: "Monthly service data, scroll horizontally on small screens" }).first()).toHaveAttribute("tabindex", "0");
  });
}
