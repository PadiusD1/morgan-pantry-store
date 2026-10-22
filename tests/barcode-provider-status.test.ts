import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// barcode-lookup imports log from app, which would open the database pool.
vi.mock("../server/app", () => ({ log: () => {} }));

/**
 * What a provider's HTTP status means.
 *
 * Only a status the provider documents as "no such product" is a miss. A
 * rejected credential, an exhausted allowance, a server fault and a transport
 * error all leave the question open, and remembering any of them as a missing
 * product would teach the cache something nobody established.
 */

const VALID_UPC_A = "012345678905";

describe("provider status handling", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let status = 200;
  let body = "{}";

  beforeEach(() => {
    vi.stubEnv("FRC_BARCODE_STUB", "");
    status = 200;
    body = "{}";
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(body, { status }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSpy.mockRestore();
  });

  async function lookup() {
    vi.resetModules();
    const module = await import("../server/barcode-lookup");
    module.clearBarcodeCache();
    return { module, result: await module.lookupBarcode(VALID_UPC_A) };
  }

  for (const code of [401, 403]) {
    it(`treats HTTP ${code} as unproven, not as a missing product`, async () => {
      status = code;
      body = JSON.stringify({ message: "unauthorized" });
      const { result } = await lookup();
      expect(result.found).toBe(false);
      expect(result.inconclusive).toBe(true);
      expect(result.logs.every((entry) => entry.status === "error")).toBe(true);
    });
  }

  it("treats a rate limit as unproven", async () => {
    status = 429;
    const { result } = await lookup();
    expect(result.inconclusive).toBe(true);
    expect(result.logs.some((entry) => /rate limit/i.test(entry.error ?? ""))).toBe(true);
  });

  it("treats a server fault as unproven", async () => {
    status = 503;
    const { result } = await lookup();
    expect(result.inconclusive).toBe(true);
  });

  it("treats a transport failure as unproven", async () => {
    fetchSpy.mockRejectedValue(new Error("socket hang up"));
    const { result } = await lookup();
    expect(result.found).toBe(false);
    expect(result.inconclusive).toBe(true);
  });

  it("treats the documented not-found as a real miss", async () => {
    status = 404;
    const { result } = await lookup();
    expect(result.found).toBe(false);
    expect(result.inconclusive).toBeUndefined();
    expect(result.logs.every((entry) => entry.status === "miss")).toBe(true);
  });

  it("does not remember an unproven answer, so the next scan asks again", async () => {
    status = 401;
    const { module } = await lookup();
    const after = fetchSpy.mock.calls.length;
    await module.lookupBarcode(VALID_UPC_A);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(after);
  });

  it("remembers a documented miss, so a second scan does not re-ask", async () => {
    status = 404;
    const { module } = await lookup();
    const after = fetchSpy.mock.calls.length;
    await module.lookupBarcode(VALID_UPC_A);
    expect(fetchSpy.mock.calls.length).toBe(after);
  });

  it("bounds every request with an abort signal", async () => {
    status = 404;
    await lookup();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of fetchSpy.mock.calls as unknown as [string, RequestInit][]) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
