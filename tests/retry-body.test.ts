import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, withIdempotencyKey } from "@/lib/queryClient";
import { createSaveGuard } from "@/lib/save-guard";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Sent = { key: string | undefined; body: string | undefined };

function stubFetch(statuses: Array<number | "network" | "held409" | "held422" | "dup409">) {
  const sent: Sent[] = [];
  vi.stubGlobal("window", { location: { pathname: "/check-in", href: "/check-in", origin: "http://localhost" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      sent.push({ key: headers["Idempotency-Key"], body: init.body as string | undefined });
      const next = statuses.shift() ?? 201;
      if (next === "network") throw new TypeError("Failed to fetch");
      // The server marks an answer whose key it still holds.
      if (next === "held409" || next === "held422") {
        return new Response(JSON.stringify({ message: "held" }), {
          status: next === "held409" ? 409 : 422,
          headers: { "Idempotency-Key-Status": "held" },
        });
      }
      if (next === "dup409") {
        return new Response(JSON.stringify({ message: "Test Student Three is already in", duplicateOf: "c3" }), { status: 409 });
      }
      return new Response(JSON.stringify({ ok: next < 400 }), { status: next });
    }),
  );
  return sent;
}

function checkIn(guard: ReturnType<typeof createSaveGuard>, timestamp: string, quantity = 80) {
  return guard.run(async (key) => {
    try {
      await withIdempotencyKey(key, () =>
        apiRequest("POST", "/api/transactions", { type: "IN", quantity, timestamp }),
      );
      return true;
    } catch {
      return false;
    }
  });
}

describe("a retry sends the current body with its key", () => {
  it("sends the current body after a lost response, then a new action gets a new key", async () => {
    const sent = stubFetch(["network", 201, 201]);
    let n = 0;
    const guard = createSaveGuard(() => `key-${++n}`);
    await checkIn(guard, "2026-09-26T10:00:00.000Z");
    await checkIn(guard, "2026-09-26T10:00:05.000Z");
    expect(sent[0].key).toBe("key-1");
    expect(sent[1].key).toBe("key-1");
    expect(JSON.parse(sent[1].body!).timestamp).toBe("2026-09-26T10:00:05.000Z");
    await checkIn(guard, "2026-09-26T10:01:00.000Z");
    expect(sent[2].key).toBe("key-2");
    expect(JSON.parse(sent[2].body!).timestamp).toBe("2026-09-26T10:01:00.000Z");
  });

  it("keeps the key and sends each current body after a server error and after a 409 while the first save runs", async () => {
    const sent = stubFetch([500, "held409", 201]);
    const guard = createSaveGuard(() => "key-a");
    await checkIn(guard, "2026-09-26T11:00:00.000Z");
    await checkIn(guard, "2026-09-26T11:00:03.000Z");
    await checkIn(guard, "2026-09-26T11:00:09.000Z");
    expect(sent.map((s) => JSON.parse(s.body!).timestamp)).toEqual([
      "2026-09-26T11:00:00.000Z",
      "2026-09-26T11:00:03.000Z",
      "2026-09-26T11:00:09.000Z",
    ]);
    expect(sent.every((s) => s.key === "key-a")).toBe(true);
  });

  it("sends the corrected form after a plain refusal, which freed the key on the server", async () => {
    const sent = stubFetch([400, 201]);
    const guard = createSaveGuard(() => "key-b");
    await checkIn(guard, "2026-09-26T12:00:00.000Z", 80);
    await checkIn(guard, "2026-09-26T12:00:10.000Z", 8);
    expect(sent[1].key).toBe("key-b");
    expect(JSON.parse(sent[1].body!).quantity).toBe(8);
  });

  it("keeps the key after a 422 that says the key is held and sends the current body", async () => {
    const sent = stubFetch(["held422", 201]);
    const guard = createSaveGuard(() => "key-h");
    await checkIn(guard, "2026-09-26T13:00:00.000Z", 5);
    await checkIn(guard, "2026-09-26T13:00:04.000Z", 6);
    expect(sent[1].key).toBe("key-h");
    expect(JSON.parse(sent[1].body!).quantity).toBe(6);
  });

  // Rendered recheck of 26 September. After a duplicate person refusal the
  // corrected form was sent as the refused body again and never saved.
  it("sends the corrected form after a duplicate refusal, which the server rolled back", async () => {
    const sent = stubFetch(["dup409", 201]);
    const guard = createSaveGuard(() => "key-d");
    await checkIn(guard, "2026-09-26T14:00:00.000Z", 80);
    await checkIn(guard, "2026-09-26T14:00:10.000Z", 8);
    expect(sent[1].key).toBe("key-d");
    expect(JSON.parse(sent[1].body!).quantity).toBe(8);
  });

  it("never touches the body of a write without a key", async () => {
    const sent = stubFetch([201, 201]);
    await apiRequest("PATCH", "/api/inventory/item-1", { name: "One" });
    await apiRequest("PATCH", "/api/inventory/item-1", { name: "Two" });
    expect(sent[0].key).toBeUndefined();
    expect(JSON.parse(sent[1].body!).name).toBe("Two");
  });
});
