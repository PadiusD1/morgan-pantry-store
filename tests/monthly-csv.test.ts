import { describe, expect, it } from "vitest";
import { monthlyItemLine, monthlySubtotalLine } from "../server/monthly-csv";

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
