import { describe, expect, it } from "vitest";
import { planItemChange, serverMessage } from "@/lib/stock-change";

describe("a save of an item that already exists never sends a bare count", () => {
  it("an Edit that changes the count sends it with the count it was read from", () => {
    const plan = planItemChange(12, { id: "item-1", name: "Test Rice One", quantity: 4, expectedQuantity: 10 });
    expect(plan.body).toMatchObject({ name: "Test Rice One", quantity: 4, expectedQuantity: 10 });
    expect(plan.adds).toBe(0);
    expect(plan.quantity).toBe(4);
  });

  it("an Edit that leaves the count alone sends no count", () => {
    const plan = planItemChange(12, { id: "item-1", name: "Test Rice Two", quantity: 10, expectedQuantity: 10 });
    expect(plan.body).toEqual({ name: "Test Rice Two" });
    expect(plan.quantity).toBe(12);
  });

  it("the New item dialog and the scan pages, which send quantity 0, leave the count alone", () => {
    const plan = planItemChange(30, { name: "Test Beans One", barcode: "5550001", quantity: 0 });
    expect(plan.body).not.toHaveProperty("quantity");
    expect(plan.adds).toBe(0);
    expect(plan.quantity).toBe(30);
  });

  it("a bare count without expectedQuantity is never sent", () => {
    const plan = planItemChange(30, { name: "Test Beans Two", quantity: 5 });
    expect(plan.body).not.toHaveProperty("quantity");
    expect(plan.adds).toBe(0);
  });

  it("the CSV import adds its quantity through the adjust route", () => {
    const plan = planItemChange(30, { name: "Test Corn One", quantity: 5 }, { addQuantity: true });
    expect(plan.body).not.toHaveProperty("quantity");
    expect(plan.adds).toBe(5);
    expect(plan.quantity).toBe(35);
  });
});

describe("the refusal a stock change shows", () => {
  it("reads the server message out of the status and body error", () => {
    const e = new Error('409: {"message":"Stock can not go below zero","quantity":2}');
    expect(serverMessage(e)).toBe("Stock can not go below zero");
  });

  it("gives null when the body is not JSON", () => {
    expect(serverMessage(new Error("500: Internal Server Error"))).toBeNull();
    expect(serverMessage(new TypeError("Failed to fetch"))).toBeNull();
  });
});
