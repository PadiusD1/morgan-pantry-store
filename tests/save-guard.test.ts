import { describe, expect, it } from "vitest";
import { createSaveGuard } from "@/lib/save-guard";
import { idempotencyHeaders, withIdempotencyKey } from "@/lib/queryClient";

function counterKeys() {
  let n = 0;
  return () => `key-${++n}`;
}

describe("save guard", () => {
  it("takes the lock synchronously so a second tap during a save is ignored", async () => {
    const guard = createSaveGuard(counterKeys());
    const calls: string[] = [];
    let finish: (ok: boolean) => void = () => {};
    const first = guard.run(
      (key) =>
        new Promise<boolean>((resolve) => {
          calls.push(key);
          finish = resolve;
        }),
    );
    expect(guard.isLocked()).toBe(true);
    await guard.run((key) => {
      calls.push(key);
      return true;
    });
    await guard.run((key) => {
      calls.push(key);
      return true;
    });
    finish(true);
    await first;
    expect(calls).toEqual(["key-1"]);
    expect(guard.isLocked()).toBe(false);
  });

  it("keeps the same key for a retry after a failure", async () => {
    const guard = createSaveGuard(counterKeys());
    const keys: string[] = [];
    await guard.run((key) => {
      keys.push(key);
      return false;
    });
    await guard.run(async (key) => {
      keys.push(key);
      throw new Error("500: server error");
    }).catch(() => {});
    await guard.run((key) => {
      keys.push(key);
      return undefined;
    });
    expect(keys).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("gives a new action after a success a new key", async () => {
    const guard = createSaveGuard(counterKeys());
    const keys: string[] = [];
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    expect(keys).toEqual(["key-1", "key-2"]);
  });

  it("keeps the lock after a success until the form reset has rendered", async () => {
    let held = 0;
    const guard = createSaveGuard(counterKeys(), () => {
      held += 1;
    });
    const keys: string[] = [];
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    expect(held).toBe(1);
    expect(guard.isLocked()).toBe(true);
    // A trailing Enter from the old render, with the quantity just saved.
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    expect(keys).toEqual(["key-1"]);
    guard.release();
    expect(guard.isLocked()).toBe(false);
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    expect(keys).toEqual(["key-1", "key-2"]);
  });

  it("frees the lock at once after a failure so a retry can run", async () => {
    let held = 0;
    const guard = createSaveGuard(counterKeys(), () => {
      held += 1;
    });
    const keys: string[] = [];
    await guard.run((key) => {
      keys.push(key);
      return false;
    });
    expect(held).toBe(0);
    expect(guard.isLocked()).toBe(false);
    await guard.run((key) => {
      keys.push(key);
      return true;
    });
    expect(keys).toEqual(["key-1", "key-1"]);
  });

  it("ignores a release while a save is still running", async () => {
    const guard = createSaveGuard(counterKeys(), () => {});
    let finish: (ok: boolean) => void = () => {};
    const first = guard.run(() => new Promise<boolean>((resolve) => {
      finish = resolve;
    }));
    guard.release();
    expect(guard.isLocked()).toBe(true);
    finish(true);
    await first;
    expect(guard.isLocked()).toBe(true);
    guard.release();
    expect(guard.isLocked()).toBe(false);
  });

  it("uses a random UUID by default", () => {
    const guard = createSaveGuard();
    const key = guard.begin();
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("idempotency header", () => {
  it("sends an explicit key on any request", () => {
    expect(idempotencyHeaders("PATCH", "/api/clients/1", { idempotencyKey: "k1" })).toEqual({
      "Idempotency-Key": "k1",
    });
  });

  it("sends the action key only on the transaction write inside the action", async () => {
    expect(idempotencyHeaders("POST", "/api/transactions")).toEqual({});
    await withIdempotencyKey("k2", async () => {
      expect(idempotencyHeaders("POST", "/api/transactions")).toEqual({ "Idempotency-Key": "k2" });
      expect(idempotencyHeaders("post", "http://localhost/api/transactions?x=1")).toEqual({
        "Idempotency-Key": "k2",
      });
      expect(idempotencyHeaders("POST", "/api/inventory")).toEqual({});
      expect(idempotencyHeaders("GET", "/api/transactions")).toEqual({});
    });
    expect(idempotencyHeaders("POST", "/api/transactions")).toEqual({});
  });

  it("clears the action key when the save fails", async () => {
    await withIdempotencyKey("k3", async () => {
      throw new Error("network");
    }).catch(() => {});
    expect(idempotencyHeaders("POST", "/api/transactions")).toEqual({});
  });
});

describe("the start time of one logical save", () => {
  it("stays the same on a retry under the same key and starts again with the next key", async () => {
    let n = 0;
    let t = 0;
    const guard = createSaveGuard(() => `k${++n}`, undefined, () => `T${++t}`);
    const seen: Array<[string, string | undefined]> = [];
    await guard.run((key, startedAt) => { seen.push([key, startedAt]); return false; });
    await guard.run((key, startedAt) => { seen.push([key, startedAt]); return true; });
    await guard.run((key, startedAt) => { seen.push([key, startedAt]); return true; });
    expect(seen).toEqual([["k1", "T1"], ["k1", "T1"], ["k2", "T2"]]);
  });

  it("starts again after renew", async () => {
    let n = 0;
    let t = 0;
    const guard = createSaveGuard(() => `k${++n}`, undefined, () => `T${++t}`);
    const seen: Array<[string, string | undefined]> = [];
    await guard.run((key, startedAt) => { seen.push([key, startedAt]); return false; });
    guard.renew();
    await guard.run((key, startedAt) => { seen.push([key, startedAt]); return false; });
    expect(seen).toEqual([["k1", "T1"], ["k2", "T2"]]);
  });
});
