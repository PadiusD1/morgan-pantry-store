import { describe, expect, it } from "vitest";
import { addManualItem, manualItemKey } from "@/lib/manual-item";
import { createSaveGuard } from "@/lib/save-guard";
import { EarlierSaveRecordedError } from "@/lib/queryClient";

// A server that records one item per Idempotency-Key and replays it for the
// same key, as the real POST /api/inventory does.
function fakeServer() {
  const byKey = new Map<string, string>();
  let next = 1;
  return {
    byKey,
    create(key: string): string {
      let id = byKey.get(key);
      if (!id) {
        id = `item-${next++}`;
        byKey.set(key, id);
      }
      return id;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function counterGuard() {
  let n = 0;
  return createSaveGuard(() => `key-${++n}`, undefined, () => "2026-09-27T00:00:00.000Z");
}

describe("manual new item on check out", () => {
  it("a lost response adds nothing, and the retry keeps the key and adds the one saved item once", async () => {
    const server = fakeServer();
    const cart: string[] = [];
    const guard = counterGuard();
    const keys: string[] = [];
    let lose = true;
    const texts: string[] = [];
    const attempt = () =>
      guard.run(async (key) => {
        const result = await addManualItem(key, {
          saveItem: async (k) => {
            keys.push(k);
            const id = server.create(k);
            if (lose) {
              lose = false;
              throw new TypeError("Failed to fetch");
            }
            return id;
          },
          addToCart: (id) => cart.push(id),
        });
        if (!result.ok) texts.push(result.text);
        return result.ok;
      });

    await attempt();
    expect(cart).toEqual([]);
    expect(texts[0]).toMatch(/may already be recorded/);
    expect(texts[0]).not.toMatch(/not saved/i);

    await attempt();
    expect(keys).toEqual([manualItemKey("key-1"), manualItemKey("key-1")]);
    expect(server.byKey.size).toBe(1);
    expect(cart).toEqual(["item-1"]);
  });

  it("adds to the cart only after the server answered, and a second press while waiting does nothing", async () => {
    const server = fakeServer();
    const cart: string[] = [];
    const guard = counterGuard();
    const answer = deferred<void>();
    let creates = 0;
    const attempt = () =>
      guard.run(async (key) => {
        const result = await addManualItem(key, {
          saveItem: async (k) => {
            creates++;
            const id = server.create(k);
            await answer.promise;
            return id;
          },
          addToCart: (id) => cart.push(id),
        });
        return result.ok;
      });

    const first = attempt();
    const second = attempt();
    await Promise.resolve();
    expect(cart).toEqual([]);
    answer.resolve();
    await Promise.all([first, second]);
    expect(creates).toBe(1);
    expect(cart).toEqual(["item-1"]);
  });

  it("a 5xx says the save may already be recorded and adds nothing", async () => {
    const cart: string[] = [];
    const result = await addManualItem("k", {
      saveItem: async () => {
        throw new Error("503: Service Unavailable");
      },
      addToCart: (id) => cart.push(id),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.text).toMatch(/may already be recorded/);
      expect(result.renew).toBe(false);
    }
    expect(cart).toEqual([]);
  });

  it("a known refusal shows the server message, keeps the key and adds nothing", async () => {
    const cart: string[] = [];
    const result = await addManualItem("k", {
      saveItem: async () => {
        throw new Error('400: {"message":"Name is too long"}');
      },
      addToCart: (id) => cart.push(id),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.text).not.toMatch(/may already be recorded/);
      expect(result.renew).toBe(false);
    }
    expect(cart).toEqual([]);
  });

  it("a held 422 names the item the earlier try saved, adds nothing and never creates a second item", async () => {
    const cart: string[] = [];
    const result = await addManualItem("k", {
      saveItem: async () => {
        throw new EarlierSaveRecordedError({ id: "item-1", name: "Rice 5 lb" });
      },
      addToCart: (id) => cart.push(id),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.renew).toBe(true);
      expect(result.closeForm).toBe(true);
      expect(result.text).toMatch(/Rice 5 lb/);
      expect(result.text).not.toMatch(/[:;]|\s-\s/);
    }
    expect(cart).toEqual([]);
  });
});
