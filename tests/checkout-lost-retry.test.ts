import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, isEarlierSaveRecorded } from "@/lib/queryClient";
import { createSaveGuard } from "@/lib/save-guard";
import { sendClaim } from "../server/idempotency";

// The claim helpers import the pool, which needs no database for this test.
vi.mock("../server/pg", () => ({ pool: {}, db: {} }));

// People row 3 of the attempt 11 rendered check. Tuna x3 was written but its
// response was lost, then the cart was edited to five and saved again.

afterEach(() => {
  vi.unstubAllGlobals();
});

// One key on a fake server. The first body it accepts is committed, another
// body gets the held 422, and the committed body is replayed.
function fakeServer(loseFirstResponse: boolean) {
  const sent: string[] = [];
  let stored: string | null = null;
  let records = 0;
  let lose = loseFirstResponse;
  vi.stubGlobal("window", { location: { pathname: "/check-out", href: "/check-out", origin: "http://localhost" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as string;
      sent.push(body);
      if (stored !== null && stored !== body) {
        return new Response(JSON.stringify({ message: "This key was already used for a different request" }), {
          status: 422,
          headers: { "Idempotency-Key-Status": "held" },
        });
      }
      if (stored === null) {
        stored = body;
        records++;
      }
      if (lose) {
        lose = false;
        throw new TypeError("Failed to fetch");
      }
      const parsed = JSON.parse(body);
      return new Response(JSON.stringify({ id: "tx1", items: [{ name: "Test Tuna Can", quantity: parsed.quantity }] }), { status: 201 });
    }),
  );
  return { sent, records: () => records };
}

const save = (quantity: number, key: string) =>
  apiRequest("POST", "/api/transactions", { type: "OUT", quantity, timestamp: "2026-09-27T02:30:52.000Z" }, { idempotencyKey: key });

describe("a lost check out response", () => {
  it("records an unchanged retry once and answers with what was recorded", async () => {
    const server = fakeServer(true);
    await expect(save(3, "co-1")).rejects.toThrow(/Failed to fetch/);
    const res = await save(3, "co-1");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "tx1", items: [{ name: "Test Tuna Can", quantity: 3 }] });
    expect(server.records()).toBe(1);
    expect(server.sent).toHaveLength(2);
  });

  it("reads back the three recorded when the edited retry sends five", async () => {
    const server = fakeServer(true);
    await expect(save(3, "co-2")).rejects.toThrow(/Failed to fetch/);
    const err = await save(5, "co-2").catch((e) => e);
    expect(isEarlierSaveRecorded(err)).toBe(true);
    expect(err.recorded).toEqual({ id: "tx1", items: [{ name: "Test Tuna Can", quantity: 3 }] });
    expect(server.records()).toBe(1);
    expect(server.sent.map((b) => JSON.parse(b).quantity)).toEqual([3, 5, 3]);
  });

  it("frees Save as soon as the lost request fails, while a click during a real save sends nothing", async () => {
    const guard = createSaveGuard(() => "co-3");
    let release: () => void = () => {};
    let runs = 0;
    const first = guard.run(() => {
      runs++;
      // The page catches the lost request itself and answers false.
      return new Promise<boolean>((resolve) => {
        release = () => resolve(false);
      });
    });
    await guard.run(() => {
      runs++;
      return true;
    });
    expect(runs).toBe(1);
    release();
    await first;
    expect(guard.isLocked()).toBe(false);
    const keys: string[] = [];
    await guard.run((key) => {
      keys.push(key);
      return false;
    });
    expect(keys).toEqual(["co-3"]);
  });
});

describe("the held 422 answer", () => {
  it("carries the held header and a message body, never an empty body", () => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      },
    };
    sendClaim(res as never, { kind: "mismatch" });
    expect(status).toBe(422);
    expect(headers["Idempotency-Key-Status"]).toBe("held");
    expect(body).toEqual({ message: "This key was already used for a different request" });
  });
});
