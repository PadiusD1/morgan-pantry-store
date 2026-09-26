import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, forgetSentBody, isEarlierSaveRecorded, isSaveStillRunning } from "@/lib/queryClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Sent = { key: string | undefined; body: string | undefined };

// A fake server for one key. It commits the first body it accepts, answers a
// held 422 to any other body under that key, and replays a stored body.
function fakeServer(script: Array<"lose" | "commitLose" | "serve" | "held409" | 500>) {
  const sent: Sent[] = [];
  let stored: string | null = null;
  vi.stubGlobal("window", { location: { pathname: "/check-in", href: "/check-in", origin: "http://localhost" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body as string;
      sent.push({ key: headers["Idempotency-Key"], body });
      const step = script.shift() ?? "serve";
      if (step === "lose") throw new TypeError("Failed to fetch");
      if (step === 500) return new Response("{}", { status: 500 });
      if (step === "held409") {
        return new Response(JSON.stringify({ message: "still running" }), { status: 409, headers: { "Idempotency-Key-Status": "held" } });
      }
      if (stored !== null && stored !== body) {
        return new Response(JSON.stringify({ message: "mismatch" }), { status: 422, headers: { "Idempotency-Key-Status": "held" } });
      }
      stored = body;
      if (step === "commitLose") throw new TypeError("Failed to fetch");
      const parsed = JSON.parse(body);
      return new Response(JSON.stringify({ id: "tx1", items: [{ quantity: parsed.quantity }] }), { status: 201 });
    }),
  );
  return sent;
}

const save = (quantity: number, key: string) =>
  apiRequest("POST", "/api/transactions", { type: "IN", quantity }, { idempotencyKey: key });

describe("a retry under the same key sends the current body", () => {
  // The reviewer's case, three units committed with a lost response, then five.
  it("reads back the three units recorded and throws EarlierSaveRecorded when five is sent", async () => {
    const sent = fakeServer(["commitLose"]);
    await expect(save(3, "k1")).rejects.toThrow(/Failed to fetch/);
    const err = await save(5, "k1").catch((e) => e);
    expect(isEarlierSaveRecorded(err)).toBe(true);
    expect(err.recorded).toEqual({ id: "tx1", items: [{ quantity: 3 }] });
    expect(sent.map((s) => JSON.parse(s.body!).quantity)).toEqual([3, 5, 3]);
    expect(sent.every((s) => s.key === "k1")).toBe(true);
  });

  it("saves the edited body when the first try never committed", async () => {
    const sent = fakeServer(["lose"]);
    await expect(save(3, "k2")).rejects.toThrow(/Failed to fetch/);
    const res = await save(5, "k2");
    expect(await res.json()).toEqual({ id: "tx1", items: [{ quantity: 5 }] });
    expect(sent.map((s) => JSON.parse(s.body!).quantity)).toEqual([3, 5]);
  });

  it("sends the current body after a 500 and never a swapped one", async () => {
    const sent = fakeServer([500]);
    await expect(save(3, "k3")).rejects.toThrow(/^500/);
    await save(4, "k3");
    expect(JSON.parse(sent[1].body!).quantity).toBe(4);
  });

  it("names a held 409 as a save still running and keeps the key", async () => {
    const sent = fakeServer(["held409"]);
    const err = await save(3, "k4").catch((e) => e);
    expect(isSaveStillRunning(err)).toBe(true);
    expect(err.message).toMatch(/^409/);
    await save(3, "k4");
    expect(sent.map((s) => s.key)).toEqual(["k4", "k4"]);
  });

  it("forgets the bodies of a key after its action succeeds", async () => {
    const sent = fakeServer(["commitLose"]);
    await expect(save(3, "k5")).rejects.toThrow();
    forgetSentBody("k5");
    await expect(save(5, "k5")).rejects.toThrow(/^422/);
    expect(sent.length).toBe(2);
  });
});
