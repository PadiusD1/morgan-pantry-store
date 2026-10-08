import { describe, expect, it } from "vitest";
import { buildMonthlyCsv, monthlyGeneratedLine, monthlyItemLine, monthlySubtotalLine, type MonthlyCsvRow } from "../server/monthly-csv";

describe("monthly summary CSV lines", () => {
  it("writes plain names and fixed decimals unchanged", () => {
    expect(monthlyItemLine("Snacks", "Test Popcorn", 12, 1.5, 18)).toBe("Snacks,Test Popcorn,12,1.50,18.00");
    expect(monthlySubtotalLine("Snacks", 18)).toBe("Snacks subtotal,,,,18.00");
  });

  it("guards text cells that a spreadsheet would run as a formula", () => {
    expect(monthlyItemLine("=SUM(A1)", "+Test Item", 1, 0, 0)).toBe("'=SUM(A1),'+Test Item,1,0.00,0.00");
    expect(monthlyItemLine("Dairy", "@Test Milk", 2, 1, 2)).toBe("Dairy,'@Test Milk,2,1.00,2.00");
    expect(monthlySubtotalLine("-Test Category", 5)).toBe("'-Test Category subtotal,,,,5.00");
  });

  it("quotes a name holding a comma or a quote", () => {
    expect(monthlyItemLine("Canned, Goods", 'Test "Big" Beans', 3, 2, 6)).toBe(
      '"Canned, Goods","Test ""Big"" Beans",3,2.00,6.00',
    );
  });

  it("never guards the number cells, even a negative one", () => {
    expect(monthlyItemLine("Snacks", "Test Popcorn", -3, 1, -3)).toBe("Snacks,Test Popcorn,-3,1.00,-3.00");
    expect(monthlySubtotalLine("Snacks", -3)).toBe("Snacks subtotal,,,,-3.00");
  });
});

describe("monthly summary CSV Generated line", () => {
  it("writes a summer time in New York with EDT as one quoted cell", () => {
    expect(monthlyGeneratedLine(new Date("2026-07-15T16:05:09Z"))).toBe('Generated,"7/15/2026, 12:05:09 PM EDT"');
  });

  it("writes a winter time in New York with EST as one quoted cell", () => {
    expect(monthlyGeneratedLine(new Date("2026-01-15T16:05:09Z"))).toBe('Generated,"1/15/2026, 11:05:09 AM EST"');
  });
});

// The donor export wrote each donation date with toLocaleDateString in the
// server zone, which is UTC on Vercel, so an evening donation in Baltimore
// showed the next day.
describe("donor export dates", () => {
  it("writes a 9.30 PM Eastern donation on its Eastern date", async () => {
    const { easternDate } = await import("../server/monthly-csv");
    expect(easternDate("2026-09-03T01:30:00Z")).toBe("9/2/2026");
    expect(easternDate(new Date("2026-01-16T03:30:00Z"))).toBe("1/15/2026");
  });

  it("gives the Generated value in Eastern with its zone", async () => {
    const { generatedValue } = await import("../server/monthly-csv");
    expect(generatedValue(new Date("2026-07-15T16:05:09Z"))).toBe("7/15/2026, 12:05:09 PM EDT");
  });
});

describe("monthly summary CSV month", () => {
  it("counts an 8.30 PM Eastern check out on September 30 in September, not October", async () => {
    const { easternYearMonth } = await import("../server/monthly-csv");
    expect(easternYearMonth(new Date("2026-10-01T00:30:00Z"))).toEqual({ year: 2026, month: 9 });
  });

  it("counts a 12.30 AM Eastern check out on October 1 in October", async () => {
    const { easternYearMonth } = await import("../server/monthly-csv");
    expect(easternYearMonth(new Date("2026-10-01T04:30:00Z"))).toEqual({ year: 2026, month: 10 });
  });

  it("counts a 10 PM Eastern check out on December 31 in December of that year, in winter time", async () => {
    const { easternYearMonth } = await import("../server/monthly-csv");
    expect(easternYearMonth(new Date("2027-01-01T03:00:00Z"))).toEqual({ year: 2026, month: 12 });
    expect(easternYearMonth(new Date("2027-01-01T05:30:00Z"))).toEqual({ year: 2027, month: 1 });
  });
});

describe("monthly summary aggregation", () => {
  const line = (overrides: Partial<MonthlyCsvRow> = {}): MonthlyCsvRow => ({
    tx_id: "checkout-1", ts: "2026-09-30T18:00:00Z", is_emergency: true,
    inv_id: "rice", item_name: "Rice", quantity: 2, value_per_unit: "1.00", category: "Grains", ...overrides,
  });

  it("counts an emergency checkout with multiple item lines once", () => {
    const csv = buildMonthlyCsv([line(), line({ inv_id: "beans", item_name: "Beans" }), line({ tx_id: "checkout-2" })]);
    expect(csv).toContain("Emergency Shop Appointments,2\r\n");
    expect(csv).toContain("2026 Emergency Shop Appointments,,,,2");
  });

  it("reports weighted estimated unit values when the saved value changed", () => {
    const csv = buildMonthlyCsv([line(), line({ tx_id: "checkout-2", quantity: 4, value_per_unit: "2.50" })]);
    expect(csv).toContain("Weighted average estimated value per unit (USD)");
    expect(csv).toContain("Grains,Rice,6,2.00,12.00");
    expect(csv).toContain("2026 GRAND TOTAL,,,,12.00");
  });

  it("keeps different inventory records separate even when their display names match", () => {
    const csv = buildMonthlyCsv([line(), line({ inv_id: "other-rice", value_per_unit: "4.00" })]);
    expect(csv).toContain("Grains,Rice,2,1.00,2.00");
    expect(csv).toContain("Grains,Rice,2,4.00,8.00");
    expect(csv).not.toContain("Grains,Rice,4");
  });

  it("writes an Excel-friendly BOM/CRLF and identifies an empty requested year", () => {
    const csv = buildMonthlyCsv([line()], { year: "2025" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Reporting year,2025\r\n");
    expect(csv).toContain("No distribution records found");
  });
});
