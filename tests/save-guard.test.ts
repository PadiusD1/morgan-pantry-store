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
