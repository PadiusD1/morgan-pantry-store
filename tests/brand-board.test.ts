import { describe, expect, it } from "vitest";
import { buildBoardReport } from "../shared/reporting";
import { boardSummaryHtml } from "../shared/board-document";
import { BRAND, BRAND_CSS } from "../shared/brand";

const report = () => buildBoardReport([{
  id: "tx-example", type: "OUT", timestamp: "2024-09-30T18:00:00Z", clientId: "private-id",
  clientName: "Private Student", donor: "Private Donor", location: { latitude: 38.654321, longitude: -76.987654 },
  items: [{ itemId: "rice", name: "Rice", quantity: 2, weightPerUnitLbs: 1.5, valuePerUnitUsd: 2 }],
}], [], { from: "2024-09-30", to: "2024-09-30" }, new Date("2024-10-01T12:00:00Z"));

describe("Systems by Design board documents", () => {
  it("uses the actual firm identity, client identity and common tokens", () => {
    const html = boardSummaryHtml(report());
    expect(html).toContain(BRAND.name);
    expect(html).toContain(BRAND.client);
    expect(html).toContain(BRAND_CSS);
    expect(html).toContain("Source Serif 4");
    expect(html).toContain("Hanken Grotesk");
    expect(html).toContain("JetBrains Mono");
    expect(html).toContain("<h1>Board Summary</h1>");
    expect(html).not.toMatch(/<script|backdrop-filter|radial-gradient/i);
  });
  it("retains the report's figures without accepting operational identities", () => {
    const html = boardSummaryHtml(report());
    expect(html).toContain("$4.00");
    expect(html).toContain("3.0 lbs");
    expect(html).toContain("2024-09-30 to 2024-09-30");
    for (const value of ["Private Student", "private-id", "Private Donor", "38.654321", "-76.987654"]) expect(html).not.toContain(value);
  });
  it("escapes free text, including malicious item descriptions and period labels", () => {
    const input = report();
    input.periodLabel = '<script>alert("period")</script>';
    input.items[0].name = '<img src=x onerror="alert(1)">';
    const html = boardSummaryHtml(input);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });
  it("shows an honest empty period without a fake chart or invalid numbers", () => {
    const empty = buildBoardReport([], [], { from: "", to: "" });
    const html = boardSummaryHtml(empty);
    expect(html).toContain("No distributions recorded in this period.");
    expect(html).toContain("No distributed items in this period.");
    expect(html).not.toContain('class="chart"');
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("not an independent data audit");
  });
  it("bounds the visual chart but keeps every month in readable ledger sections", () => {
    const input = report();
    input.months = Array.from({ length: 40 }, (_, i) => ({ ...input.months[0], month: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`, entries: i + 1 }));
    const html = boardSummaryHtml(input);
    expect(html.match(/class="bar"/g)).toHaveLength(12);
    expect(html.match(/<caption>Monthly service/g)).toHaveLength(4);
    expect(html).toContain("Jan 2020");
    expect(html).toContain("Apr 2023");
    expect(html.match(/How to read this report/g)).toHaveLength(1);
    expect(html).toContain("Do not add monthly client counts");
  });
  it("makes incomplete measurements and non-historical stock explicit", () => {
    const input = report();
    input.distribution.unvaluedUnits = 1;
    input.distribution.unlinkedVisits = 1;
    const html = boardSummaryHtml(input);
    expect(html).toContain("Data quality to review");
    expect(html).toContain("1 distributed units lack a positive recorded unit value");
    expect(html).toContain("On hand at generation time");
    expect(html).toContain("not a measure of donations alone");
  });
});
