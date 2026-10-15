import { describe, expect, it } from "vitest";
import { receiptFromSaved, receiptFromFulfilled, receiptTotals } from "../client/src/lib/receipt";

const transaction = {
  type: "OUT", timestamp: "2026-10-14T14:00:00Z", clientName: "Synthetic visitor", clientId: "client-1",
  items: [
    { name: "Rice", quantity: 2, weightPerUnitLbs: "0.5000", valuePerUnitUsd: "1.25" },
    { name: "Beans", quantity: 3, weightPerUnitLbs: "1.0000", valuePerUnitUsd: "2.00" },
  ],
};
describe("saved receipt value and weight", () => {
  it("multiplies PostgreSQL unit snapshots by saved quantities with exact cents", () => {
    const receipt = receiptFromSaved(transaction, [{ id: "client-1", identifier: "SYNTHETIC" }], "fallback")!;
    expect(receiptTotals(receipt)).toEqual({ units: 5, weightLbs: 4, valueCents: 850, unvaluedUnits: 0, unweighedUnits: 0 });
    expect(receipt).toMatchObject({ clientIdentifier: "SYNTHETIC", timestamp: transaction.timestamp });
  });
  it("does not pretend missing or invalid values are complete measurements", () => {
    const receipt = receiptFromSaved({ ...transaction, items: [
      { name: "Missing", quantity: 2 }, { name: "Bad", quantity: 3, weightPerUnitLbs: "NaN", valuePerUnitUsd: -5 },
      { name: "Blank", quantity: 1, weightPerUnitLbs: "", valuePerUnitUsd: Infinity },
      { name: "Zero", quantity: 1, weightPerUnitLbs: 0, valuePerUnitUsd: "0.00" },
    ] }, [], "fallback")!;
    expect(receiptTotals(receipt)).toEqual({ units: 7, weightLbs: 0, valueCents: 0, unvaluedUnits: 7, unweighedUnits: 7 });
    expect(receipt.items[0]).not.toHaveProperty("valuePerUnitUsd");
  });
  it("uses the fulfilled transaction snapshots, not approved or requested quantities", () => {
    const receipt = receiptFromFulfilled({ clientName: "Synthetic visitor", clientIdentifier: "ID", transaction,
      items: [{ itemName: "Rice", requestedQuantity: 99, approvedQuantity: 80, fulfilledQuantity: 99 }],
    }, "fallback")!;
    expect(receiptTotals(receipt)).toMatchObject({ units: 5, valueCents: 850, weightLbs: 4 });
    expect(receipt.items).toHaveLength(2);
  });
  it("keeps old fulfilment responses usable without inventing historic prices", () => {
    const receipt = receiptFromFulfilled({ items: [{ itemName: "Old saved item", fulfilledQuantity: 2 }] }, "fallback")!;
    expect(receiptTotals(receipt)).toMatchObject({ units: 2, valueCents: 0, unvaluedUnits: 2 });
  });
  it("rejects inbound transactions and never mutates saved history", () => {
    const snapshot = JSON.stringify(transaction);
    expect(receiptFromSaved({ ...transaction, type: "IN" }, [], "now")).toBeNull();
    receiptTotals(receiptFromSaved(transaction, [], "now")!);
    expect(JSON.stringify(transaction)).toBe(snapshot);
  });
});
