import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import {
  boardSummaryCsv, buildBoardReport, detailedReportCsv, filterReportTransactions,
  reportDateKey, reportDatePreset, reportRangeError, reportYears, type ReportInventory, type ReportTransaction,
} from "../shared/reporting";
import { boardSummaryHtml } from "../client/src/lib/board-print";

const allDates = { from: "", to: "" };
const item = (overrides = {}) => ({ itemId: "rice-id", name: "Rice", quantity: 2, weightPerUnitLbs: 0.5, valuePerUnitUsd: 1.25, ...overrides });
const transaction = (overrides: Partial<ReportTransaction> = {}): ReportTransaction => ({
  id: "checkout-1", type: "OUT", timestamp: "2026-09-30T18:00:00Z", clientId: "client-private-id", clientName: "PRIVATE Student Name",
  isEmergency: true, items: [item(), item({ itemId: "beans-id", name: "Beans", quantity: 3, valuePerUnitUsd: 2 })], ...overrides,
});

describe("report date boundaries", () => {
  it("uses inclusive Baltimore dates, including evening records that fall in tomorrow in UTC", () => {
    const records = [
      transaction({ id: "before", timestamp: "2026-09-30T03:59:59Z" }),
      transaction({ id: "start", timestamp: "2026-09-30T04:00:00Z" }),
      transaction({ id: "end", timestamp: "2026-10-01T03:59:59Z" }),
      transaction({ id: "after", timestamp: "2026-10-01T04:00:00Z" }),
    ];
    expect(filterReportTransactions(records, { from: "2026-09-30", to: "2026-09-30" }).map((tx) => tx.id)).toEqual(["start", "end"]);
  });

  it("keeps both repeated daylight-saving hours on the same date and handles winter year rollover", () => {
    expect(reportDateKey("2026-11-01T05:30:00Z")).toBe("2026-11-01");
    expect(reportDateKey("2026-11-01T06:30:00Z")).toBe("2026-11-01");
    expect(reportDateKey("2027-01-01T04:59:59Z")).toBe("2026-12-31");
    expect(reportDateKey("2027-01-01T05:00:00Z")).toBe("2027-01-01");
  });

  it("refuses reversed/invalid calendar ranges and never includes malformed timestamps", () => {
    expect(reportRangeError({ from: "2026-10-02", to: "2026-10-01" })).toContain("on or before");
    expect(reportRangeError({ from: "2026-02-30", to: "" })).toContain("valid");
    expect(filterReportTransactions([transaction()], { from: "2026-10-02", to: "2026-10-01" })).toEqual([]);
    expect(filterReportTransactions([transaction({ timestamp: "bad" })], allDates)).toEqual([]);
  });

  it("keeps the current default year selectable even when only prior years have records", () => {
    expect(reportYears([transaction({ timestamp: "2025-05-01T14:00:00Z" })], new Date("2027-01-01T02:00:00Z"))).toEqual([2026, 2025]);
  });

  it("offers exact previous-month ranges across year changes and leap days", () => {
    expect(reportDatePreset("previous-month", new Date("2026-01-15T14:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(reportDatePreset("previous-month", new Date("2028-03-15T14:00:00Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(reportDatePreset("month", new Date("2026-10-01T02:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("board reporting", () => {
  const inventory: ReportInventory[] = [
    { id: "rice-id", name: "Rice", quantity: 4, weightPerUnitLbs: 8, valuePerUnitUsd: 99, reorderThreshold: 5 },
    { id: "empty-id", name: "Empty", quantity: 0, weightPerUnitLbs: 1, valuePerUnitUsd: 2, reorderThreshold: 5 },
  ];

  it("counts checkouts once, deduplicates linked clients, and keeps received stock separate", () => {
    const records = [
      transaction(), transaction({ id: "checkout-2", isEmergency: false, items: [item()] }),
      transaction({ id: "legacy", clientId: undefined, clientName: "Unlinked", items: [item({ quantity: 1 })] }),
      transaction({ id: "inbound", type: "IN", source: "Purchase", items: [item({ quantity: 20 })] }),
    ];
    const report = buildBoardReport(records, inventory, allDates);
    expect(report.distribution).toMatchObject({ entries: 3, knownClients: 1, unlinkedVisits: 1, emergencyVisits: 2, units: 8, weightLbs: 4, valueUsd: 12.25 });
    expect(report.receiving).toMatchObject({ entries: 1, units: 20, valueUsd: 25 });
    expect(report.months).toHaveLength(1);
    expect(report.months[0]).toMatchObject({ month: "2026-09", entries: 3, knownClients: 1, emergencyVisits: 2 });
    // Historic distribution is valued using saved lines, despite today's $99 rice.
    expect(report.inventory).toMatchObject({ units: 4, valueUsd: 396, lowStockItems: 1, outOfStockItems: 1 });
  });

  it("shows missing valuation metadata rather than silently treating it as complete", () => {
    const report = buildBoardReport([transaction({ items: [item({ quantity: 3, valuePerUnitUsd: 0, weightPerUnitLbs: 0 })] })], [], allDates);
    expect(report.distribution).toMatchObject({ units: 3, unvaluedUnits: 3, unweighedUnits: 3, valueUsd: 0, weightLbs: 0 });
    expect(boardSummaryCsv(report)).toContain("Distributed units without a positive recorded unit value,3,units");
  });

  it("keeps people, IDs, donors, and location out of board CSV and printable documents", () => {
    const tx = transaction({ donor: "PRIVATE Donor Name", location: { latitude: 38.654321, longitude: -76.987654 } });
    const report = buildBoardReport([tx], inventory, allDates, new Date("2026-10-08T16:00:00Z"));
    for (const document of [boardSummaryCsv(report), boardSummaryHtml(report)]) {
      for (const privateText of ["PRIVATE Student Name", "client-private-id", "PRIVATE Donor Name", "38.654321", "-76.987654", "checkout-1"]) {
        expect(document).not.toContain(privateText);
      }
      expect(document).toContain("Rice");
      expect(document).toContain("All recorded dates");
    }
  });

  it("escapes untrusted item names in printable HTML and protects formula-like CSV names", () => {
    const report = buildBoardReport([transaction({ items: [item({ name: '<img src=x onerror="alert(1)">' }), item({ itemId: "formula", name: "=HYPERLINK(A1)" })] })], [], allDates);
    expect(boardSummaryHtml(report)).not.toContain("<img src=x");
    expect(boardSummaryHtml(report)).toContain("&lt;img src=x");
    expect(boardSummaryCsv(report)).toContain("'=HYPERLINK(A1)");
  });

  it("can report an empty period without turning current inventory into a historical balance", () => {
    const report = buildBoardReport([transaction()], inventory, { from: "2027-01-01", to: "2027-01-31" });
    expect(report.distribution.entries).toBe(0);
    expect(report.inventory.units).toBe(4);
    expect(report.months).toEqual([]);
    expect(report.periodLabel).toBe("2027-01-01 to 2027-01-31");
  });
});

describe("detailed operational export", () => {
  it("exports only the visible range, includes both directions, and round-trips quoted names", () => {
    const records = [
      transaction({ id: "outside", timestamp: "2026-10-01T04:00:00Z" }),
      transaction({ id: "in-range", timestamp: "2026-10-01T03:30:00Z", type: "IN", donor: "Example Donor", source: "Donation", items: [item({ name: 'Beans, "Large"' })] }),
    ];
    const result = detailedReportCsv(records, [{ id: "client-private-id", name: "PRIVATE Student Name", identifier: "T0001234" }], { from: "2026-09-30", to: "2026-09-30" });
    const parsed = Papa.parse<Record<string, string>>(result.csv, { header: true });
    expect(result.lineCount).toBe(1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.data[0]).toMatchObject({ type: "IN", transactionId: "in-range", dateEastern: "2026-09-30", itemName: 'Beans, "Large"', donor: "Example Donor", source: "Donation", clientIdentifier: "T0001234", totalValueUsd: "2.50" });
    expect(result.csv).not.toContain("outside");
  });
});
