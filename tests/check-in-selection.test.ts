import { describe, expect, it } from "vitest";
import { itemOptions, nextSelectedId, resolveSelectedId } from "@/lib/check-in-selection";

const rice = { id: "i1", name: "Test Rice", barcode: "0000000000011" };
const beans = { id: "i2", name: "Test Beans", barcode: "0000000000022" };

describe("item 10, a new scanned item stays selected", () => {
  it("keeps a scan created item in the options until the refetch brings it", () => {
    const created = { id: "srv9", name: "Test Soup", barcode: "0000000000099" };
    const before = itemOptions([rice, beans], created, "srv9");
    expect(before.map((i) => i.id)).toEqual(["i1", "i2", "srv9"]);
    expect(resolveSelectedId("srv9", before, created)).toBe("srv9");
    const after = itemOptions([rice, beans, created], created, "srv9");
    expect(after.map((i) => i.id)).toEqual(["i1", "i2", "srv9"]);
  });

  it("follows a registered item from its temporary id to the saved row by barcode", () => {
    const temp = { id: "temp1", name: "Test Pasta", barcode: "0000000000033" };
    const saved = { id: "srv3", name: "Test Pasta", barcode: "0000000000033" };
    expect(resolveSelectedId("temp1", [rice, saved, beans], temp)).toBe("srv3");
  });

  it("follows a registered item with no barcode by its name", () => {
    const temp = { id: "temp2", name: "Test Oats", barcode: "" };
    const saved = { id: "srv4", name: "Test Oats", barcode: null };
    expect(resolveSelectedId("temp2", [rice, saved], temp)).toBe("srv4");
  });

  it("leaves other selections alone", () => {
    expect(resolveSelectedId("i2", [rice, beans], null)).toBe("i2");
    expect(resolveSelectedId("", [rice, beans], rice)).toBe("");
    expect(resolveSelectedId("gone", [rice, beans], { id: "other", name: "Test Rice", barcode: "0000000000011" })).toBe("gone");
    expect(itemOptions([rice], beans, "i1").map((i) => i.id)).toEqual(["i1"]);
  });

  it("ignores the empty value the picker sends when its value is missing", () => {
    expect(nextSelectedId("srv9", "")).toBe("srv9");
    expect(nextSelectedId("srv9", "i1")).toBe("i1");
  });
});

describe("item 10, the page composition", () => {
  it("shows the saved row once the temporary row is replaced, with no leftover option", () => {
    const temp = { id: "temp5", name: "Test Flour", barcode: "0000000000055" };
    const saved = { id: "srv5", name: "Test Flour", barcode: "0000000000055" };
    const inventory = [rice, saved];
    const shown = resolveSelectedId("temp5", inventory, temp);
    expect(shown).toBe("srv5");
    expect(itemOptions(inventory, temp, shown).map((i) => i.id)).toEqual(["i1", "srv5"]);
  });
});
