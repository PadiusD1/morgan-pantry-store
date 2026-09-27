import { describe, expect, it } from "vitest";
import { runCheckInAction } from "@/lib/item-action";
import { resolveSelectedId, selectedAfterCheckIn } from "@/lib/check-in-selection";

// Finding K. After a successful new item check in the picker must show the
// saved row by its real id, never an older item that shares the name.
describe("picker after a new item check in", () => {
  it("selects the saved id even when an older item has the same name and no barcode", async () => {
    const result = await runCheckInAction<unknown>({
      saveItem: async () => "real-new",
      recordStock: async () => ({ ok: true }),
    });
    if (!result.ok) throw new Error("expected success");
    const inventory = [
      { id: "old-rice", name: "Rice", barcode: null },
      { id: "real-new", name: "Rice", barcode: null },
    ];
    const pinned = { id: "temp-1", name: "Rice", barcode: null };
    // The temporary id matched by name picks the older item, the bug.
    expect(resolveSelectedId("temp-1", inventory, pinned)).toBe("old-rice");
    const id = selectedAfterCheckIn(result);
    expect(resolveSelectedId(id, inventory, pinned)).toBe("real-new");
  });
});
