import { describe, expect, it } from "vitest";
import { cartAllergyWarning } from "@/lib/cart-allergies";

const scanned = { id: "new-item", name: "Synthetic Granola", allergens: ["almonds", "oats"] };

describe("allergy checks immediately after a barcode lookup", () => {
  it("checks the resolved saved item when the previous inventory render has no row", () => {
    expect(cartAllergyWarning(scanned.id, [], ["Almonds"], scanned)).toEqual({ itemName: "Synthetic Granola", itemAllergens: ["almonds"] });
  });

  it("uses fresh lookup allergens instead of an older cached row", () => {
    expect(cartAllergyWarning(scanned.id, [{ ...scanned, allergens: [] }], ["almonds"], scanned)?.itemAllergens).toEqual(["almonds"]);
  });

  it("never uses a resolved item belonging to a different cart selection", () => {
    const selected = { id: "milk", name: "Synthetic Milk", allergens: ["milk"] };
    expect(cartAllergyWarning(selected.id, [selected], ["milk"], scanned)).toEqual({ itemName: "Synthetic Milk", itemAllergens: ["milk"] });
  });

  it("does not show a warning for blank or unrelated allergy entries", () => {
    expect(cartAllergyWarning(scanned.id, [], ["", "milk"], scanned)).toBeNull();
  });
});
