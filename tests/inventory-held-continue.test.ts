import { describe, expect, it } from "vitest";
import { runItemSave } from "@/lib/item-action";
import { EarlierSaveRecordedError } from "@/lib/queryClient";
import { inventoryEarlierNote } from "@/lib/inventory-save";

// Round 2 finding A2. A held item or donor stage proves an earlier try of the
// same save created that row. The starting quantity was never recorded in that
// case, so the save goes on with the recorded row and records it once under
// the save's own stock key, never closing with the quantity lost.
type Pick = { donor?: string; donorId?: string };

function run(held: "item" | "donor", recordedOk = true) {
  const done: string[] = [];
  const recorded = held === "item" ? { id: "item-earlier", name: "Rice" } : { id: "donor-earlier", name: "First Fruit Farm" };
  return {
    done,
    result: runItemSave<Pick>({
      saveItem: async () => {
        done.push("item");
        if (held === "item") throw new EarlierSaveRecordedError(recordedOk ? recorded : { name: "no id" });
        return "item-real";
      },
      pickDonor: async () => {
        done.push("donor");
        if (held === "donor") throw new EarlierSaveRecordedError(recorded);
        return { donor: "Typed Donor", donorId: "donor-real" };
      },
      donorFromRecorded: (row) => {
        const r = row as { id?: unknown; name?: unknown } | null;
        return r && typeof r.id === "string" ? { donor: String(r.name ?? ""), donorId: r.id } : undefined;
      },
      recordStock: async (itemId, picked) => {
        done.push(`stock ${itemId} ${picked?.donorId ?? "none"}`);
      },
    }),
  };
}

describe("runItemSave after a held item or donor stage (A2)", () => {
  it("records the starting quantity against the earlier item", async () => {
    const r = run("item");
    const result = await r.result;
    expect(result).toMatchObject({ ok: true, itemId: "item-earlier", earlier: { stage: "item" } });
    expect(r.done).toEqual(["item", "donor", "stock item-earlier donor-real"]);
  });

  it("records the starting quantity with the earlier donor", async () => {
    const r = run("donor");
    const result = await r.result;
    expect(result).toMatchObject({ ok: true, itemId: "item-real", earlier: { stage: "donor" } });
    expect(r.done).toEqual(["item", "donor", "stock item-real donor-earlier"]);
  });

  it("still stops at the item stage when the read back carries no id", async () => {
    const r = run("item", false);
    const result = await r.result;
    expect(result).toMatchObject({ ok: false, stage: "item" });
    expect(r.done).toEqual(["item"]);
  });

  it("says which earlier details were kept", () => {
    expect(inventoryEarlierNote({ stage: "item", recorded: { id: "i", name: "Rice" } }, "Rice 2")).toBe(
      "An earlier try already saved this item as Rice, so its earlier details were kept.",
    );
    expect(inventoryEarlierNote({ stage: "donor", recorded: { id: "d", name: "First Fruit Farm" } }, "Rice")).toBe(
      "An earlier try already saved the donor as First Fruit Farm, so that donor was used.",
    );
    expect(inventoryEarlierNote(undefined, "Rice")).toBe("");
  });
});

describe("donorFieldsFromRecorded", () => {
  it("maps a recorded donor row and refuses a row with no id", async () => {
    const { donorFieldsFromRecorded } = await import("@/lib/inventory-save");
    expect(donorFieldsFromRecorded({ id: "d1", name: "First Fruit Farm" })).toEqual({ donor: "First Fruit Farm", donorId: "d1" });
    expect(donorFieldsFromRecorded({ name: "x" })).toBeUndefined();
    expect(donorFieldsFromRecorded(null)).toBeUndefined();
  });
});
