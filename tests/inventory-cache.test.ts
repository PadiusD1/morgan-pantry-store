import { describe, expect, it } from "vitest";
import { ITEM_NOT_LOADED, findCachedItem } from "@/lib/inventory-cache";

describe("finding an item in the inventory cache before recording stock", () => {
  const cache = [
    { id: "item-1", name: "Test Rice One" },
    { id: "temp-2", name: "Test New Item" },
  ];

  it("returns the item, including one just added to the cache", () => {
    expect(findCachedItem(cache, "temp-2")).toEqual({ id: "temp-2", name: "Test New Item" });
  });

  it("throws a plain message instead of returning quietly when the item is missing", () => {
    expect(() => findCachedItem(cache, "missing")).toThrow(ITEM_NOT_LOADED);
    expect(() => findCachedItem(undefined, "item-1")).toThrow(ITEM_NOT_LOADED);
    expect(ITEM_NOT_LOADED).not.toMatch(/[:;]|\s[-–—]\s/);
  });
});
