import { describe, expect, it } from "vitest";
import { buildBoardReport, type BoardReport } from "../shared/reporting";
import { boardSummaryHtml } from "../shared/board-document";
import { BOARD_DOCUMENT_STYLE } from "../shared/board-document-style";

function sample(months: number): BoardReport {
  const report = buildBoardReport([], [], { from: "", to: "" }, new Date("2026-10-09T16:00:00Z"));
  report.months = Array.from({ length: months }, (_, i) => ({
    month: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`,
    entries: 1, units: 2, knownClients: 1, emergencyVisits: 0, weightLbs: 3, valueUsd: 4,
  }));
  return report;
}

describe("readable board document contract", () => {
  it.each([[0, 3], [4, 3], [12, 4], [40, 6]])("keeps %i recorded months in %i planned sections without shrinking explanations", (months, sections) => {
    const html = boardSummaryHtml(sample(months));
    expect(html.match(/class="report-page/g)).toHaveLength(sections);
    expect(html.match(/id="report-methodology"/g)).toHaveLength(1);
    expect(html).toContain("The board CSV contains every distributed item");
    expect(html).toContain('main aria-label="FRC board report"');
    expect(html).toContain("PDF tags and reading order depend on your browser");
  });
  it("uses a single document stylesheet and point-sized essential text", () => {
    expect(boardSummaryHtml(sample(0))).toContain(BOARD_DOCUMENT_STYLE);
    expect(BOARD_DOCUMENT_STYLE).toContain(".definitions li { font-size: 10pt;");
    expect(BOARD_DOCUMENT_STYLE).toContain("font-size: 10pt; font-variant-numeric");
    expect(BOARD_DOCUMENT_STYLE).toContain("@media screen and (max-width:600px)");
    expect(BOARD_DOCUMENT_STYLE).not.toMatch(/font-size:\s*[6789]px/);
  });
  it("retains every monthly row and one interpretation section for long histories", () => {
    const html = boardSummaryHtml(sample(40));
    expect(html.match(/<caption>Monthly service/g)).toHaveLength(4);
    expect(html.match(/<th scope="row">[A-Z][a-z]{2} 20\d\d/g)).toHaveLength(40);
    expect(html).toContain("Jan 2020");
    expect(html).toContain("Apr 2023");
    expect(html.match(/How to read this report/g)).toHaveLength(1);
  });
});
