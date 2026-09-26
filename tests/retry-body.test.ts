import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, withIdempotencyKey } from "@/lib/queryClient";
import { createSaveGuard } from "@/lib/save-guard";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Sent = { key: string | undefined; body: string | undefined };

function stubFetch(statuses: Array<number | "network">) {
  const sent: Sent[] = [];
  vi.stubGlobal("window", { location: { pathname: "/check-in", href: "/check-in", origin: "http://localhost" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      sent.push({ key: headers["Idempotency-Key"], body: init.body as string | undefined });
      const next = statuses.shift() ?? 201;
      if (next === "network") throw new TypeError("Failed to fetch");
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

describe("a retry resends the first body with its key", () => {
  it("resends the exact first body after a lost response, then a new action sends its own", async () => {
    const sent = stubFetch(["network", 201, 201]);
    let n = 0;
    const guard = createSaveGuard(() => `key-${++n}`);
    await checkIn(guard, "2026-09-26T10:00:00.000Z");
    await checkIn(guard, "2026-09-26T10:00:05.000Z");
    expect(sent[0].key).toBe("key-1");
    expect(sent[1].key).toBe("key-1");
    expect(sent[1].body).toBe(sent[0].body);
    expect(JSON.parse(sent[1].body!).timestamp).toBe("2026-09-26T10:00:00.000Z");
    await checkIn(guard, "2026-09-26T10:01:00.000Z");
    expect(sent[2].key).toBe("key-2");
    expect(JSON.parse(sent[2].body!).timestamp).toBe("2026-09-26T10:01:00.000Z");
  });

  it("keeps the first body after a server error and after a 409 while the first save runs", async () => {
    const sent = stubFetch([500, 409, 201]);
    const guard = createSaveGuard(() => "key-a");
    await checkIn(guard, "2026-09-26T11:00:00.000Z");
    await checkIn(guard, "2026-09-26T11:00:03.000Z");
    await checkIn(guard, "2026-09-26T11:00:09.000Z");
    expect(new Set(sent.map((s) => s.body)).size).toBe(1);
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

  it("never touches the body of a write without a key", async () => {
    const sent = stubFetch([201, 201]);
    await apiRequest("PATCH", "/api/inventory/item-1", { name: "One" });
    await apiRequest("PATCH", "/api/inventory/item-1", { name: "Two" });
    expect(sent[0].key).toBeUndefined();
    expect(JSON.parse(sent[1].body!).name).toBe("Two");
  });
});
