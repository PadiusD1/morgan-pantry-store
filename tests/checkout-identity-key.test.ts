import { describe, expect, it } from "vitest";
import { idempotencyHeaders, withIdempotencyKey } from "@/lib/queryClient";

describe("client create key at check out", () => {
  it("sends a key on client create derived from the action key", async () => {
    await withIdempotencyKey("k7", async () => {
      expect(idempotencyHeaders("POST", "/api/clients")).toEqual({ "Idempotency-Key": "k7.client" });
      expect(idempotencyHeaders("POST", "/api/transactions")).toEqual({ "Idempotency-Key": "k7" });
      expect(idempotencyHeaders("PATCH", "/api/clients/1")).toEqual({});
    });
  });

  it("sends no key outside a guarded save", () => {
    expect(idempotencyHeaders("POST", "/api/clients")).toEqual({});
  });
});
