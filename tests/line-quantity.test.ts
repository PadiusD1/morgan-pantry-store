import { describe, expect, it } from "vitest";
import {
  LINE_QUANTITY_LIMIT_MESSAGE,
  MAX_LINE_QUANTITY,
  findOverLimitLine,
  isOverLineLimit,
} from "@shared/line-quantity";

describe("line quantity limit", () => {
  it("is 10000 units", () => {
    expect(MAX_LINE_QUANTITY).toBe(10000);
  });

  it("allows the limit itself and refuses anything above it", () => {
    expect(isOverLineLimit(1)).toBe(false);
    expect(isOverLineLimit(10000)).toBe(false);
    expect(isOverLineLimit(10001)).toBe(true);
    // A scanner code typed into the quantity field.
    expect(isOverLineLimit(52000000200029)).toBe(true);
  });

  it("finds the first line above the limit", () => {
    const lines = [
      { itemId: "a", quantity: 3 },
      { itemId: "b", quantity: 52000000200029 },
      { itemId: "c", quantity: 20000 },
    ];
    expect(findOverLimitLine(lines)?.itemId).toBe("b");
    expect(findOverLimitLine([{ itemId: "a", quantity: 10000 }])).toBeUndefined();
  });

  it("names the limit in plain words", () => {
    expect(LINE_QUANTITY_LIMIT_MESSAGE).toContain("10000");
    expect(LINE_QUANTITY_LIMIT_MESSAGE).not.toMatch(/[:;]| - /);
  });
});
