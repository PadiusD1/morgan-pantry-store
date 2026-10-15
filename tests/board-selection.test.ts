import { describe, expect, it } from "vitest";
import { buildBoardReport, boardSummaryCsv, type ReportTransaction } from "../shared/reporting";
import { boardSummaryHtml } from "../shared/board-document";
import { ALL_BOARD_DATA, selectedBoardSections } from "../shared/board-selection";

const records: ReportTransaction[] = [{ id: "saved", type: "OUT", timestamp: "2026-10-14T14:00:00Z", clientId: "secret-id", clientName: "PRIVATE STUDENT", isEmergency: true,
  items: [{ itemId: "rice", name: "Rice <script>unsafe()</script>", quantity: 2, weightPerUnitLbs: 1.5, valuePerUnitUsd: 13.67 }] }];
const report = buildBoardReport(records, [{ id: "rice", name: "Rice", quantity: 70, valuePerUnitUsd: 200 }], { from: "2026-10-14", to: "2026-10-14" }, new Date("2026-10-14T18:00:00Z"));

describe("selected board data", () => {
  it("uses identical selected values for preview, CSV and print, without hidden excluded metrics", () => {
    const selection = ["weight", "monthly"] as const;
    const sections = selectedBoardSections(report, selection);
    expect(sections.map(s => s.key)).toEqual(["service", "monthly"]);
    expect(sections[1].columns).toEqual(["Month", "Weight (lbs)"]);
    expect(sections[1].rows).toEqual([["2026-10", "3.00"]]);
    for (const output of [boardSummaryCsv(report, selection), boardSummaryHtml(report, selection)]) {
      expect(output).toContain("3.00");
      for (const excluded of ["27.34", "14000", "PRIVATE STUDENT", "secret-id", "Rice", "Estimated value", "Completed distribution visits", "Emergency visits"]) expect(output).not.toContain(excluded);
    }
  });
  it("lets stock and receiving be selected without implicitly including financial amounts", () => {
    const sections = selectedBoardSections(report, ["inventory", "receiving"]);
    expect(sections.map(s => s.key)).toEqual(["receiving", "inventory"]);
    expect(JSON.stringify(sections)).not.toContain("14000");
    expect(JSON.stringify(sections)).not.toContain("Estimated value");
  });
  it("keeps default full exports unchanged and tolerates reordered selections", () => {
    expect(boardSummaryCsv(report, ALL_BOARD_DATA)).toBe(boardSummaryCsv(report));
    expect(boardSummaryHtml(report, [...ALL_BOARD_DATA].reverse())).toBe(boardSummaryHtml(report));
  });
  it("refuses empty selections rather than accidentally exporting everything", () => {
    expect(selectedBoardSections(report, [])).toEqual([]);
    expect(() => boardSummaryCsv(report, [])).toThrow("Select at least one");
    expect(() => boardSummaryHtml(report, [])).toThrow("Select at least one");
  });
  it("escapes selected free text and never includes client identities", () => {
    const html = boardSummaryHtml(report, ["items", "units"]);
    expect(html).toContain("Rice &lt;script&gt;unsafe()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("PRIVATE STUDENT");
  });
  it("exports every selected item rather than only a preview page", () => {
    const many = buildBoardReport([{ ...records[0], items: Array.from({ length: 60 }, (_, i) => ({ itemId: `i-${i}`, name: `Ledger item ${String(i).padStart(2, "0")}`, quantity: 1, weightPerUnitLbs: 1, valuePerUnitUsd: 2 })) }], [], { from: "", to: "" });
    const html = boardSummaryHtml(many, ["items", "weight"]);
    const csv = boardSummaryCsv(many, ["items", "weight"]);
    for (let i = 0; i < 60; i++) for (const document of [html, csv]) expect(document).toContain(`Ledger item ${String(i).padStart(2, "0")}`);
    expect(html).toContain("rows 45–60 of 60");
  });
});
