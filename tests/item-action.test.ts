import { describe, expect, it } from "vitest";
import {
  classifySaveError,
  componentKeys,
  itemActionFailureText,
  runItemAction,
  runItemSave,
  importRow,
  trackCreate,
  type RequestFn,
} from "@/lib/item-action";

type Call = { method: string; url: string; body: unknown; key: string | undefined };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ok(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fake request function. Each route answers from its handler, in call order. */
function fakeRequest(handlers: Record<string, Array<() => Promise<Response> | Response>>) {
  const calls: Call[] = [];
  const request: RequestFn = async (method, url, data, options) => {
    calls.push({ method, url, body: data, key: options?.idempotencyKey });
    const next = handlers[`${method} ${url}`]?.shift();
    if (!next) throw new Error(`unexpected ${method} ${url}`);
    const res = await next();
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res;
  };
  return { request, calls };
}

const stock = ({ itemId, donorId, donorName }: { itemId: string; donorId?: string; donorName?: string }) => ({
  url: "/api/transactions",
  body: { type: "IN", donorId: donorId ?? null, donor: donorName ?? null, items: [{ inventoryItemId: itemId, quantity: 3 }] },
});

describe("runItemAction", () => {
  it("posts the stock with the canonical ids when the donor answers after the item", async () => {
    const donor = deferred<Response>();
    const { request, calls } = fakeRequest({
      "POST /api/inventory": [() => ok({ id: "item-real" })],
      "POST /api/donors": [() => donor.promise],
      "POST /api/transactions": [() => ok({ id: "tx1" })],
    });
    const run = runItemAction(request, "k1", { newItem: { name: "Test Rice" }, newDonorName: "Test Donor One", stock });
    await new Promise((r) => setTimeout(r, 5));
    // The item has answered, the donor has not, so no stock is posted yet.
    expect(calls.map((c) => c.url)).toEqual(["/api/inventory", "/api/donors"]);
    donor.resolve(ok({ id: "donor-real", name: "Test Donor One" }));
    const result = await run;
    expect(result).toMatchObject({ itemId: "item-real", donorId: "donor-real", stock: { id: "tx1" } });
    const tx = calls.find((c) => c.url === "/api/transactions")!;
    expect(tx.body).toMatchObject({ donorId: "donor-real", items: [{ inventoryItemId: "item-real" }] });
    expect(calls.map((c) => c.key)).toEqual(["k1.item", "k1:donor", "k1.stock"]);
  });

  it("posts no stock when the item create answers 500, and waits for the donor first", async () => {
    const donor = deferred<Response>();
    const { request, calls } = fakeRequest({
      "POST /api/inventory": [() => new Response("boom", { status: 500 })],
      "POST /api/donors": [() => donor.promise],
    });
    let settled = false;
    const run = runItemAction(request, "k2", { newItem: { name: "Test Beans" }, newDonorName: "Test Donor Two", stock })
      .finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    donor.resolve(ok({ id: "d2", name: "Test Donor Two" }));
    await expect(run).rejects.toThrow(/^500/);
    expect(calls.some((c) => c.url === "/api/transactions")).toBe(false);
    expect(classifySaveError(await run.catch((e) => e))).toBe("uncertain");
  });

  it("reports a held stock 409 as still running", async () => {
    const { request } = fakeRequest({
      "POST /api/transactions": [() => new Response(JSON.stringify({ message: "This request is still being saved" }), { status: 409 })],
    });
    const err = await runItemAction(request, "k3", { itemId: "item-9", stock }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(classifySaveError(err)).toBe("running");
  });

  it("reuses every component key on a retry after a lost response", async () => {
    const { request, calls } = fakeRequest({
      "POST /api/inventory": [() => ok({ id: "item-real" }), () => ok({ id: "item-real" })],
      "POST /api/donors": [() => ok({ id: "d4", name: "Test Donor Four" }), () => ok({ id: "d4", name: "Test Donor Four" })],
      "POST /api/transactions": [
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => ok({ id: "tx4" }),
      ],
    });
    const action = { newItem: { name: "Test Pasta" }, newDonorName: "Test Donor Four", stock };
    const first = await runItemAction(request, "k4", action).catch((e) => e);
    expect(classifySaveError(first)).toBe("uncertain");
    const second = await runItemAction(request, "k4", action);
    expect(second.itemId).toBe("item-real");
    const keys = calls.map((c) => `${c.url} ${c.key}`);
    expect(keys).toEqual([
      "/api/inventory k4.item",
      "/api/donors k4:donor",
      "/api/transactions k4.stock",
      "/api/inventory k4.item",
      "/api/donors k4:donor",
      "/api/transactions k4.stock",
    ]);
    expect(componentKeys("k4")).toEqual({ item: "k4.item", donor: "k4:donor", stock: "k4.stock" });
  });

  it("sorts a plain 400 as a known refusal", () => {
    expect(classifySaveError(new Error("400: Name is required"))).toBe("refused");
    expect(classifySaveError(new Error("422: held"))).toBe("uncertain");
    expect(classifySaveError(new Error("409: The count changed, reload and try again"))).toBe("refused");
    expect(classifySaveError(new TypeError("Failed to fetch"))).toBe("uncertain");
  });
});

describe("trackCreate", () => {
  it("still resolves the temporary id to the canonical id after the create has finished", async () => {
    const pending = new Map<string, Promise<string>>();
    await trackCreate(pending, "temp-1", Promise.resolve("item-real"));
    await new Promise((r) => setTimeout(r, 0));
    // The handler awaiting an inline donor still holds temp-1.
    expect(await pending.get("temp-1")).toBe("item-real");
  });

  it("drops a failed create so nothing resolves to it", async () => {
    const pending = new Map<string, Promise<string>>();
    await trackCreate(pending, "temp-2", Promise.reject(new Error("500: boom"))).catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.has("temp-2")).toBe(false);
  });
});

describe("runItemSave", () => {
  function steps(fail?: "item" | "donor" | "stock") {
    const done: string[] = [];
    const { request } = fakeRequest({
      "POST /api/inventory": [() => (fail === "item" ? new Response("boom", { status: 500 }) : ok({ id: "item-real" }))],
      "POST /api/donors": [() => (fail === "donor" ? new Response("boom", { status: 500 }) : ok({ id: "d1", name: "Test Donor One" }))],
      "POST /api/transactions": [() => (fail === "stock" ? new Response(JSON.stringify({ message: "This request is still being saved" }), { status: 409 }) : ok({ id: "tx1" }))],
    });
    return {
      done,
      steps: {
        saveItem: async () => { done.push("item"); return (await (await request("POST", "/api/inventory", {}, { idempotencyKey: "k.item" })).json()).id; },
        pickDonor: async () => { done.push("donor"); return (await request("POST", "/api/donors", {}, { idempotencyKey: "k:donor" })).json(); },
        recordStock: async (itemId: string) => { done.push(`stock ${itemId}`); await request("POST", "/api/transactions", {}, { idempotencyKey: "k" }); },
      },
    };
  }

  it("confirms the item, donor and stock before reporting saved", async () => {
    const s = steps();
    expect(await runItemSave(s.steps)).toEqual({ ok: true, itemId: "item-real" });
    expect(s.done).toEqual(["item", "donor", "stock item-real"]);
  });

  it("stops at an item create 500 with no donor or stock write", async () => {
    const s = steps("item");
    const result = await runItemSave(s.steps);
    expect(result).toMatchObject({ ok: false, stage: "item" });
    expect(s.done).toEqual(["item"]);
    expect(classifySaveError((result as { error: unknown }).error)).toBe("uncertain");
  });

  it("reports a held stock 409 as not saved and still running", async () => {
    const s = steps("stock");
    const result = await runItemSave(s.steps);
    expect(result).toMatchObject({ ok: false, stage: "stock" });
    expect(classifySaveError((result as { error: unknown }).error)).toBe("running");
  });

  it("reports a donor failure before any stock write", async () => {
    const s = steps("donor");
    expect(await runItemSave(s.steps)).toMatchObject({ ok: false, stage: "donor" });
    expect(s.done).toEqual(["item", "donor"]);
  });
});

describe("importRow", () => {
  it("counts a row created only after its save is confirmed", async () => {
    const counts = { created: 0 };
    const save = deferred<string>();
    const run = importRow(counts, () => save.promise);
    await new Promise((r) => setTimeout(r, 0));
    expect(counts.created).toBe(0);
    save.resolve("item-real");
    await run;
    expect(counts.created).toBe(1);
  });

  it("does not count a row whose save failed", async () => {
    const counts = { created: 0 };
    const { request } = fakeRequest({ "POST /api/inventory": [() => new Response("boom", { status: 500 })] });
    await expect(importRow(counts, () => request("POST", "/api/inventory", {}, { idempotencyKey: "imp.0" }))).rejects.toThrow(/^500/);
    expect(counts.created).toBe(0);
  });
});

describe("itemActionFailureText", () => {
  it("shows the server message for a known refusal and the shared design text otherwise", () => {
    expect(itemActionFailureText(new Error('409: {"message":"The count changed. Reload and try again."}'), "Not saved")).toBe("The count changed. Reload and try again.");
    expect(itemActionFailureText(new Error("400: plain"), "Not saved")).toBe("Not saved");
    expect(itemActionFailureText(new Error('409: {"message":"This request is still being saved"}'), "Not saved")).toMatch(/still saving/);
    expect(itemActionFailureText(new Error("500: boom"), "Not saved")).toMatch(/may already be recorded/);
    expect(itemActionFailureText(new TypeError("Failed to fetch"), "Not saved")).toMatch(/may already be recorded/);
  });
});
