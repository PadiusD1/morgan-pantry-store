import { describe, expect, it } from "vitest";
import { insertTransactionItemSchema } from "../shared/schema";

const line = {
  transactionId: "00000000-0000-4000-8000-000000000001",
  inventoryItemId: "00000000-0000-4000-8000-000000000002",
  name: "Rice", quantity: 1, weightPerUnitLbs: "1.25", valuePerUnitUsd: "2.50",
};

describe("transaction values cannot reverse stock or corrupt reports", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, NaN])("rejects quantity %s", (quantity) => {
    expect(insertTransactionItemSchema.safeParse({ ...line, quantity }).success).toBe(false);
  });
  it.each(["", "-1", "NaN", "Infinity", "0x10", "1,000", "1000000000000"])("rejects invalid weight/value %s", (value) => {
    expect(insertTransactionItemSchema.safeParse({ ...line, weightPerUnitLbs: value }).success).toBe(false);
    expect(insertTransactionItemSchema.safeParse({ ...line, valuePerUnitUsd: value }).success).toBe(false);
  });
  it("allows zero estimates and trims valid names and decimal strings", () => {
    expect(insertTransactionItemSchema.parse({ ...line, name: " Rice ", weightPerUnitLbs: " 0 ", valuePerUnitUsd: "0" }))
      .toMatchObject({ name: "Rice", weightPerUnitLbs: "0", valuePerUnitUsd: "0" });
  });
});
