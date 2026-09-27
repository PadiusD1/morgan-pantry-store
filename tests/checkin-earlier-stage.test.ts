import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, isEarlierSaveRecorded, withIdempotencyKey } from "@/lib/queryClient";
import { runCheckInAction } from "@/lib/item-action";
import { settleEarlierCheckIn } from "@/lib/checkin-earlier";

// Finding 1 of the round 3 review, from probe-checkin-stock.ts. A check in
// commits its new item (or new donor) and its stock, and the stock answer is
// lost. Staff correct the item or donor name and retry under the same key. The
// item or donor create answers the held 422, so the stock of this retry is
// never sent. The stock of the earlier try must be read back under the old
// key, so no later Save under a new key records it a second time.

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeServer(opts: { loseItem?: boolean; loseTx?: boolean; dropTx?: boolean }) {
  const store = new Map<string, { body: string; status: number; resp: unknown }>();
  const txRecorded: unknown[] = [];
  const itemsCreated: unknown[] = [];
  let loseNextItem = !!opts.loseItem;
  let loseNextTx = !!opts.loseTx;
  let dropNextTx = !!opts.dropTx;
  vi.stubGlobal("window", { location: { pathname: "/check-in", href: "/check-in", origin: "http://localhost" } });
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
      const prior = key ? store.get(key) : undefined;
      if (prior) return prior.body === body ? reply(prior.status, prior.resp) : reply(422, { message: "mismatch" }, true);
      let resp: unknown;
      if (url === "/api/inventory") {
        resp = { id: `item${itemsCreated.length + 1}`, ...JSON.parse(body) };
        itemsCreated.push(resp);
      } else if (url === "/api/donors") {
        resp = { id: "d1", ...JSON.parse(body) };
      } else {
        resp = { id: `tx${txRecorded.length + 1}`, type: "IN", ...JSON.parse(body) };
        txRecorded.push(resp);
      }
      if (key) store.set(key, { body, status: 201, resp });
      if (url === "/api/inventory" && loseNextItem) {
        loseNextItem = false;
        throw new TypeError("Failed to fetch");
      }
      if (url === "/api/transactions" && loseNextTx) {
        loseNextTx = false;
        throw new TypeError("Failed to fetch");
      }
      return reply(201, resp);
    }),
  );
  return { txRecorded, itemsCreated };
}

const json = (r: Response) => r.json();

function checkIn(key: string, itemName: string | null, donorName?: string) {
  return runCheckInAction<{ id: string } | undefined>({
    saveItem: itemName
      ? () =>
          apiRequest("POST", "/api/inventory", { name: itemName, category: "Canned" }, { idempotencyKey: `${key}.item` })
            .then(json)
            .then((i: { id: string }) => i.id)
      : undefined,
    itemId: itemName ? undefined : "existing1",
    pickDonor: donorName
      ? () => apiRequest("POST", "/api/donors", { name: donorName, status: "active" }, { idempotencyKey: `${key}.donor` }).then(json)
      : undefined,
    recordStock: (id, picked) =>
      withIdempotencyKey(key, () =>
        apiRequest("POST", "/api/transactions", { type: "IN", itemId: id, quantity: 12, donorId: picked?.id }).then(json),
      ),
  });
}

describe("a check in held at its item or donor stage after its stock was sent", () => {
  it("reads back the stock of the earlier try when the item name is corrected", async () => {
    const server = fakeServer({ loseTx: true });
    const first = await checkIn("k1", "Beans");
    expect(first.ok).toBe(false);
    const retry = await checkIn("k1", "Black beans");
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.stage).toBe("item");
    expect(isEarlierSaveRecorded(retry.error)).toBe(true);
    const earlier = await settleEarlierCheckIn("k1");
    expect(earlier.kind).toBe("stock");
    expect(earlier.kind === "stock" && (earlier.recorded as { id: string }).id).toBe("tx1");
    expect(server.txRecorded).toHaveLength(1);
    expect(server.itemsCreated).toHaveLength(1);
  });

  it("reads back the stock of the earlier try when the donor name is corrected on an existing item", async () => {
    const server = fakeServer({ loseTx: true });
    await checkIn("k2", null, "First Fruit Farm");
    const retry = await checkIn("k2", null, "First Fruits Farm");
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.stage).toBe("donor");
    const earlier = await settleEarlierCheckIn("k2");
    expect(earlier.kind).toBe("stock");
    expect(server.txRecorded).toHaveLength(1);
  });

  it("records the kept stock once when the earlier stock never reached the server", async () => {
    const server = fakeServer({ dropTx: true });
    await checkIn("k3", "Rice");
    expect(server.txRecorded).toHaveLength(0);
    const retry = await checkIn("k3", "Brown rice");
    expect(retry.ok).toBe(false);
    const earlier = await settleEarlierCheckIn("k3");
    expect(earlier.kind).toBe("stock");
    expect(server.txRecorded).toHaveLength(1);
  });

  it("sends nothing when the earlier try never reached the stock stage", async () => {
    const server = fakeServer({ loseItem: true });
    await checkIn("k4", "Corn");
    const retry = await checkIn("k4", "Sweet corn");
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.stage).toBe("item");
    const earlier = await settleEarlierCheckIn("k4");
    expect(earlier.kind).toBe("none");
    expect(server.txRecorded).toHaveLength(0);
  });

  it("throws when the answer of the settle itself is lost, so the page keeps the old key", async () => {
    const server = fakeServer({ loseTx: true });
    await checkIn("k5", "Peas");
    await checkIn("k5", "Green peas");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(settleEarlierCheckIn("k5")).rejects.toBeTruthy();
    expect(server.txRecorded).toHaveLength(1);
  });
});
