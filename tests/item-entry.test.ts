import { describe, expect, it } from "vitest";
import { createItemLookupGuard, itemEntryFields, suggestInventoryItems } from "@/lib/item-entry";
import type { InventoryItem } from "@/lib/repository";

const rice: InventoryItem = {
  id: "rice-a", name: "Rice", brand: "Pantry Brand", category: "Grains", barcode: "123456789012",
  quantity: 17, weightPerUnitLbs: 2, valuePerUnitUsd: 3.5, allergens: ["soy"], reorderThreshold: 4,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
};
const brownRice: InventoryItem = { ...rice, id: "rice-b", name: "Brown Rice", barcode: "223456789012", brand: "Second Brand" };
const secondRice: InventoryItem = { ...rice, id: "rice-c", barcode: "323456789012", brand: "Third Brand" };

describe("existing item suggestions and filled details", () => {
  it("finds a partial name without case or whitespace sensitivity, prioritizing exact names", () => {
    expect(suggestInventoryItems([brownRice, secondRice, rice], "  RICE ").map((item) => item.id)).toEqual(["rice-a", "rice-c", "rice-b"]);
    expect(suggestInventoryItems([brownRice, rice], "bro")).toEqual([brownRice]);
  });

  it("searches multiple words, brand and barcode while keeping same-named products separate", () => {
    expect(suggestInventoryItems([brownRice, rice], "second rice")).toEqual([brownRice]);
    expect(suggestInventoryItems([secondRice, rice], "323456")).toEqual([secondRice]);
    expect(suggestInventoryItems([secondRice, rice], "rice")).toHaveLength(2);
    expect(suggestInventoryItems([rice], "")).toEqual([]);
    expect(suggestInventoryItems([rice], "apples")).toEqual([]);
  });

  it("fills the chosen saved identity, stock, brand, category, weight, value and allergens", () => {
    expect(itemEntryFields(secondRice)).toEqual({
      id: "rice-c", name: "Rice", brand: "Third Brand", barcode: "323456789012", category: "Grains",
      quantity: 17, weightPerUnitLbs: 2, valuePerUnitUsd: 3.5, allergens: ["soy"], reorderThreshold: 4,
    });
    const fields = itemEntryFields(secondRice);
    fields.allergens.push("wheat");
    expect(secondRice.allergens).toEqual(["soy"]);
  });

  it("preserves real zero values instead of retaining values from a prior selection", () => {
    const empty = itemEntryFields({ ...rice, quantity: 0, weightPerUnitLbs: 0, valuePerUnitUsd: 0, allergens: undefined, brand: undefined });
    expect(empty).toMatchObject({ quantity: 0, weightPerUnitLbs: 0, valuePerUnitUsd: 0, allergens: [], brand: "" });
  });
});

describe("item lookup results", () => {
  it("rejects older results after a newer lookup or a manual selection/edit", () => {
    const guard = createItemLookupGuard();
    const first = guard.start();
    const second = guard.start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    guard.invalidate();
    expect(second()).toBe(false);
  });
});
