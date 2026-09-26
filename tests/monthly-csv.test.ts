import { describe, expect, it } from "vitest";
import { monthlyGeneratedLine, monthlyItemLine, monthlySubtotalLine } from "../server/monthly-csv";

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
