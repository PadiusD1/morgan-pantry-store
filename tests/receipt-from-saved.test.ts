import { describe, expect, it } from "vitest";
import { receiptFromSaved } from "@/lib/receipt";

const people = [
  { id: "c1", identifier: "TESTID001" },
  { id: "c2", identifier: "TESTID002" },
];

const stored = {
  id: "tx1",
  type: "OUT",
  timestamp: "2026-09-27T01:00:00.000Z",
  clientId: "c1",
  clientName: "Test Student One",
  items: [
    { id: "ti1", inventoryItemId: "i1", name: "Test Rice", quantity: 3 },
    { id: "ti2", inventoryItemId: "i2", name: "Test Beans", quantity: 2 },
  ],
};

describe("the receipt is built from the saved check out", () => {
  it("lists each recorded item with its recorded quantity and the person as recorded", () => {
    expect(receiptFromSaved(stored, people, "2026-09-27T02:00:00.000Z")).toEqual({
      clientName: "Test Student One",
      clientIdentifier: "TESTID001",
      items: [
        { name: "Test Rice", quantity: 3 },
        { name: "Test Beans", quantity: 2 },
      ],
      timestamp: "2026-09-27T01:00:00.000Z",
    });
  });

  it("shows the three recorded when the cart was edited to five before the retry", () => {
    const cartAfterEdit = [{ itemId: "i1", quantity: 5 }];
    const firstTry = { ...stored, items: [{ id: "ti1", inventoryItemId: "i1", name: "Test Rice", quantity: 3 }] };
    const receipt = receiptFromSaved(firstTry, people, "2026-09-27T02:00:00.000Z");
    expect(receipt?.items).toEqual([{ name: "Test Rice", quantity: 3 }]);
    expect(receipt?.items[0].quantity).not.toBe(cartAfterEdit[0].quantity);
  });

  it("names the recorded person even when another person is picked now", () => {
    const receipt = receiptFromSaved({ ...stored, clientId: "c2", clientName: "Test Student Two" }, people, "x");
    expect(receipt?.clientName).toBe("Test Student Two");
    expect(receipt?.clientIdentifier).toBe("TESTID002");
  });

  it("leaves the ID blank when the recorded person is not known, never a typed one", () => {
    const receipt = receiptFromSaved({ ...stored, clientId: "unknown" }, people, "x");
    expect(receipt?.clientIdentifier).toBe("");
  });

  it("uses the given time only when the saved result has none", () => {
    const { timestamp: _t, ...noTime } = stored;
    expect(receiptFromSaved(noTime, people, "2026-09-27T02:00:00.000Z")?.timestamp).toBe("2026-09-27T02:00:00.000Z");
  });

  it("shows no receipt when the saved result is not a recorded check out", () => {
    expect(receiptFromSaved(null, people, "x")).toBeNull();
    expect(receiptFromSaved(undefined, people, "x")).toBeNull();
    expect(receiptFromSaved({ id: "c9", name: "Test Student Nine", identifier: "TESTID009" }, people, "x")).toBeNull();
    expect(receiptFromSaved({ ...stored, items: [] }, people, "x")).toBeNull();
  });
});
