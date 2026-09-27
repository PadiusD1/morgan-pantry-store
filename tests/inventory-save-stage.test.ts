import { describe, expect, it } from "vitest";
import { EarlierSaveRecordedError } from "@/lib/queryClient";
import { inventoryFailureToast } from "@/lib/inventory-save";

// Finding A2. A held 422 on the item or donor stage proves only that stage.
// The stock stage was never reached in that try, so the dialog must never
// say the whole save was already recorded.
describe("inventoryFailureToast held 422 per stage", () => {
  const donorRead = new EarlierSaveRecordedError({ id: "d1", name: "Jon Smith" });
  const itemRead = new EarlierSaveRecordedError({ id: "i1", name: "Rice", quantity: 0 });

  it("donor stage with a starting quantity never says Already recorded and names the quantity as unconfirmed", () => {
    const { toast } = inventoryFailureToast("donor", donorRead, "Rice", true);
    expect(toast.title).not.toBe("Already recorded");
    expect(toast.description).not.toMatch(/already saved Rice/);
    expect(toast.description).toMatch(/starting quantity/i);
    expect(toast.description).toMatch(/may not be recorded/);
    expect(toast.description).not.toMatch(/[:;]|—|–| - /);
  });

  it("item stage with a starting quantity says only the item is proven", () => {
    const { toast } = inventoryFailureToast("item", itemRead, "Rice", true);
    expect(toast.title).not.toBe("Already recorded");
    expect(toast.description).toMatch(/starting quantity/i);
    expect(toast.description).toMatch(/may not be recorded/);
  });

  it("item stage with no starting quantity keeps the plain item text", () => {
    const { toast } = inventoryFailureToast("item", itemRead, "Rice", false);
    expect(toast.description).toBe("An earlier try already saved Rice. Your change was not saved.");
    expect(toast.description).not.toMatch(/starting quantity/i);
  });

  it("stock stage still says Already recorded from the read back", () => {
    const { toast, close } = inventoryFailureToast("stock", new EarlierSaveRecordedError({ quantity: 12 }), "Rice", true);
    expect(toast.title).toBe("Already recorded");
    expect(close).toBe(true);
  });
});
