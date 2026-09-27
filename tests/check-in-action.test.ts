import { describe, expect, it } from "vitest";
import { classifySaveError, componentKeys, earlierComponentText, runCheckInAction } from "@/lib/item-action";

type Call = { method: string; url: string; key?: string; body?: unknown };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Builds the check in steps the page builds, over a fake request function. The page posts the stock under the action key itself. */
function stepsFor(
  actionKey: string,
  calls: Call[],
  answers: {
    item: () => Promise<{ id: string }>;
    donor: () => Promise<{ id: string; name: string }>;
    stock: () => Promise<unknown>;
  },
) {
  const keys = componentKeys(actionKey);
  return {
    saveItem: () => {
      calls.push({ method: "POST", url: "/api/inventory", key: keys.item });
      return answers.item().then((item) => item.id);
    },
    pickDonor: () => {
      calls.push({ method: "POST", url: "/api/donors", key: keys.donor });
      return answers.donor().then((d) => ({ donor: d.name, donorId: d.id }));
    },
    recordStock: (itemId: string, picked: { donor?: string; donorId?: string } | undefined) => {
      calls.push({ method: "POST", url: "/api/transactions", key: actionKey, body: { itemId, donorId: picked?.donorId } });
      return answers.stock();
    },
  };
}

describe("runCheckInAction", () => {
  it("posts the stock once against the real item id when the donor answers after the item", async () => {
    const calls: Call[] = [];
    const donor = deferred<{ id: string; name: string }>();
    const run = runCheckInAction(stepsFor("k1", calls, {
      item: async () => ({ id: "item-real" }),
      donor: () => donor.promise,
      stock: async () => ({ id: "tx-1", quantity: 3 }),
    }));
    await new Promise((r) => setTimeout(r, 5));
    expect(calls.filter((c) => c.url === "/api/transactions")).toHaveLength(0);
    donor.resolve({ id: "donor-1", name: "Test Donor One" });
    const result = await run;
    const stock = calls.filter((c) => c.url === "/api/transactions");
    expect(stock).toHaveLength(1);
    expect(stock[0].body).toEqual({ itemId: "item-real", donorId: "donor-1" });
    expect(result).toEqual({ ok: true, itemId: "item-real", saved: { id: "tx-1", quantity: 3 } });
  });

  it("posts no stock and names the item stage when the item create answers 500", async () => {
    const calls: Call[] = [];
    const result = await runCheckInAction(stepsFor("k2", calls, {
      item: async () => { throw new Error("500: Server error"); },
      donor: async () => ({ id: "donor-1", name: "Test Donor One" }),
      stock: async () => ({ id: "tx-1" }),
    }));
    expect(calls.filter((c) => c.url === "/api/transactions")).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("item");
      expect(classifySaveError(result.error)).toBe("uncertain");
    }
  });

  it("waits for a failing donor before it answers and posts no stock", async () => {
    const calls: Call[] = [];
    const result = await runCheckInAction(stepsFor("k3", calls, {
      item: async () => ({ id: "item-real" }),
      donor: async () => { throw new Error("400: Enter a donor name"); },
      stock: async () => ({ id: "tx-1" }),
    }));
    expect(calls.filter((c) => c.url === "/api/transactions")).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("donor");
      expect(classifySaveError(result.error)).toBe("refused");
    }
  });

  it("sorts a held stock 409 as still running", async () => {
    const result = await runCheckInAction(stepsFor("k4", [], {
      item: async () => ({ id: "item-real" }),
      donor: async () => ({ id: "donor-1", name: "Test Donor One" }),
      stock: async () => { throw new Error('409: {"message":"This request is still being saved"}'); },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("stock");
      expect(classifySaveError(result.error)).toBe("running");
    }
  });

  it("reuses every component key when a lost stock response is retried", async () => {
    const calls: Call[] = [];
    let stockTries = 0;
    const answers = {
      item: async () => ({ id: "item-real" }),
      donor: async () => ({ id: "donor-1", name: "Test Donor One" }),
      stock: async () => {
        stockTries++;
        if (stockTries === 1) throw new TypeError("Failed to fetch");
        return { id: "tx-1", quantity: 3 };
      },
    };
    const first = await runCheckInAction(stepsFor("k5", calls, answers));
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.stage).toBe("stock");
      expect(classifySaveError(first.error)).toBe("uncertain");
    }
    const firstKeys = calls.map((c) => c.key);
    calls.length = 0;
    const second = await runCheckInAction(stepsFor("k5", calls, answers));
    expect(second).toEqual({ ok: true, itemId: "item-real", saved: { id: "tx-1", quantity: 3 } });
    expect(calls.map((c) => c.key)).toEqual(firstKeys);
    expect(firstKeys).toEqual(["k5.item", "k5:donor", "k5"]);
  });

  it("uses an existing item id without a create", async () => {
    const calls: Call[] = [];
    const result = await runCheckInAction({
      itemId: "item-old",
      recordStock: async (itemId: string) => {
        calls.push({ method: "POST", url: "/api/transactions", body: { itemId } });
        return { id: "tx-2" };
      },
    });
    expect(calls).toEqual([{ method: "POST", url: "/api/transactions", body: { itemId: "item-old" } }]);
    expect(result).toEqual({ ok: true, itemId: "item-old", saved: { id: "tx-2" } });
  });

  it("names the new item or donor an earlier try saved with other details, never a stock count", () => {
    expect(earlierComponentText("item")).toBe(
      "An earlier try already saved the new item with other details. Your change was not saved. Check the list, then save again.",
    );
    expect(earlierComponentText("donor")).toBe(
      "An earlier try already saved the new donor with other details. Your change was not saved. Check the list, then save again.",
    );
    expect(earlierComponentText("item")).not.toMatch(/[:;]|\s-\s/);
  });
});
