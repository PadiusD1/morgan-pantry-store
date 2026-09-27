import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, forgetSentBody, isEarlierSaveRecorded, withIdempotencyKey } from "@/lib/queryClient";
import { settleEarlierSave } from "@/lib/checkout-earlier";

// Finding A1 of the round 2 review, from probe-double.ts. A new person with a
// typed ID is created, the visit is committed and its response is lost. Staff
// fix a typo in the ID and retry under the same key. The person create answers
// the held 422 and the replay reads back the person. The visit under the old
// key must be read back, so no second save records a second distribution.

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeServer(opts: { loseTx: boolean; txReachesServer?: boolean }) {
  const store = new Map<string, { body: string; status: number; resp: unknown }>();
  const txRecorded: unknown[] = [];
  let loseNextTx = opts.loseTx;
  let dropNextTx = opts.txReachesServer === false;
  vi.stubGlobal("window", { location: { pathname: "/check-out", href: "/check-out", origin: "http://localhost" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["Idempotency-Key"];
      const body = init.body as string;
      const reply = (status: number, resp: unknown, held = false) =>
        new Response(JSON.stringify(resp), {
          status,
          headers: held ? { "Idempotency-Key-Status": "held", "Content-Type": "application/json" } : { "Content-Type": "application/json" },
        });
      if (url === "/api/transactions" && dropNextTx) {
        dropNextTx = false;
        throw new TypeError("Failed to fetch");
      }
      const prior = store.get(key);
      if (prior) return prior.body === body ? reply(prior.status, prior.resp) : reply(422, { message: "mismatch" }, true);
      if (url === "/api/clients") {
        const resp = { id: "c1", ...JSON.parse(body) };
        store.set(key, { body, status: 201, resp });
        return reply(201, resp);
      }
      const resp = { id: `tx${txRecorded.length + 1}`, clientName: "Bob", ...JSON.parse(body) };
      txRecorded.push(resp);
      store.set(key, { body, status: 201, resp });
      if (loseNextTx) {
        loseNextTx = false;
        throw new TypeError("Failed to fetch");
      }
      return reply(201, resp);
    }),
  );
  return { txRecorded };
}

async function checkout(key: string, identifier: string) {
  return withIdempotencyKey(key, async () => {
    const c = (await (await apiRequest("POST", "/api/clients", { name: "Bob", identifier })).json()) as { id: string };
    return (await apiRequest("POST", "/api/transactions", { type: "OUT", clientId: c.id, items: [{ quantity: 3 }] })).json();
  });
}

async function heldAfterTypoFix(key: string): Promise<unknown> {
  await checkout(key, "IDBBO").catch(() => undefined);
  try {
    await checkout(key, "IDBOB");
  } catch (e) {
    return e;
  }
  throw new Error("the retry was expected to be held");
}

describe("a held 422 on the person create of a check out", () => {
  it("reads back the visit recorded under the old key, so one distribution is recorded", async () => {
    const server = fakeServer({ loseTx: true });
    const err = await heldAfterTypoFix("K1");
    expect(isEarlierSaveRecorded(err)).toBe(true);
    if (!isEarlierSaveRecorded(err)) return;

    const outcome = await settleEarlierSave(err, "K1");
    expect(outcome.kind).toBe("visit");
    expect(outcome.recorded).toMatchObject({ id: "tx1", clientId: "c1" });
    // Only now may the page renew its key.
    forgetSentBody("K1");
    expect(server.txRecorded).toHaveLength(1);
  });

  it("records the kept visit once under the old key when it never reached the server", async () => {
    const server = fakeServer({ loseTx: false, txReachesServer: false });
    const err = await heldAfterTypoFix("K2");
    if (!isEarlierSaveRecorded(err)) throw err;

    const outcome = await settleEarlierSave(err, "K2");
    expect(outcome.kind).toBe("visit");
    expect(server.txRecorded).toHaveLength(1);
    // A second settle under the same key reads it back, never a second record.
    const again = await settleEarlierSave(err, "K2");
    expect(again.kind).toBe("visit");
    expect(server.txRecorded).toHaveLength(1);
  });

  it("names only the person when no visit was sent under the old key", async () => {
    fakeServer({ loseTx: false });
    // The person create answered, the visit was never sent.
    await withIdempotencyKey("K3", async () => apiRequest("POST", "/api/clients", { name: "Bob", identifier: "IDBBO" }));
    let err: unknown;
    try {
      await checkout("K3", "IDBOB");
    } catch (e) {
      err = e;
    }
    if (!isEarlierSaveRecorded(err)) throw err;
    const outcome = await settleEarlierSave(err, "K3");
    expect(outcome.kind).toBe("person");
  });

  it("passes a transaction read back through unchanged", async () => {
    const outcome = await settleEarlierSave(
      Object.assign(new Error("held"), { name: "EarlierSaveRecordedError", recorded: { id: "tx9", items: [{ quantity: 2 }] } }) as never,
      "K4",
    );
    expect(outcome).toEqual({ kind: "visit", recorded: { id: "tx9", items: [{ quantity: 2 }] } });
  });
});
