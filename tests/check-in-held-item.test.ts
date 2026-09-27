import { describe, expect, it } from "vitest";
import { EarlierSaveRecordedError } from "@/lib/queryClient";
import { heldItemId, runCheckInAction } from "@/lib/item-action";

// Finding A3. A held 422 on the item or donor stage must switch the check in
// form to the saved item, so the next Save under the renewed key checks in
// that item and never creates a second one. The page reads the id from here.
describe("check in held 422 switches to the saved item", () => {
  it("donor stage keeps the confirmed item id so the page can switch to it", async () => {
    const result = await runCheckInAction<unknown>({
      saveItem: async () => "item-real-7",
      pickDonor: async () => { throw new EarlierSaveRecordedError({ id: "d1", name: "Jon" }); },
      recordStock: async () => { throw new Error("stock must not run"); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("donor");
    expect(heldItemId(result)).toBe("item-real-7");
  });

  it("item stage takes the real id from the read back", async () => {
    const result = await runCheckInAction<unknown>({
      saveItem: async () => { throw new EarlierSaveRecordedError({ id: "item-real-3", name: "Rice", quantity: 0 }); },
      recordStock: async () => { throw new Error("stock must not run"); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("item");
    expect(heldItemId(result)).toBe("item-real-3");
  });

  it("gives no id when the read back holds none or the error is not a held 422", async () => {
    const lost = await runCheckInAction<unknown>({
      saveItem: async () => { throw new TypeError("Failed to fetch"); },
      recordStock: async () => undefined,
    });
    if (lost.ok) throw new Error("expected a failure");
    expect(heldItemId(lost)).toBeUndefined();
    const empty = await runCheckInAction<unknown>({
      saveItem: async () => { throw new EarlierSaveRecordedError(null); },
      recordStock: async () => undefined,
    });
    if (empty.ok) throw new Error("expected a failure");
    expect(heldItemId(empty)).toBeUndefined();
  });
});

describe("check in held 422 text after the switch", () => {
  it("says the saved item is now selected, with no colon, semicolon or dash", async () => {
    const { earlierComponentText } = await import("@/lib/item-action");
    const text = earlierComponentText("item", true);
    expect(text).toMatch(/The saved item is now selected/);
    expect(text).not.toMatch(/[:;]|—|–| - /);
    expect(earlierComponentText("donor")).toMatch(/Check the list, then save again/);
  });
});
