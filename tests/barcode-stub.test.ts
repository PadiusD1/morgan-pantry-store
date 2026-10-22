import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// barcode-lookup imports log from app, which would open the database pool.
vi.mock("../server/app", () => ({ log: () => {} }));

const FIXTURE = path.resolve(import.meta.dirname, "..", "scripts", "local-stack", "barcode-fixture.json");

// The fixture's 2000000... codes are deliberately not valid GTINs, so they can
// never collide with a real product. Proving the stub is bypassed needs a code
// the identity gate lets through to the outside providers, so these tests use
// the fixture's valid UPC-A entry.
const VALID_UPC_A_IN_FIXTURE = "012345678905";

describe("barcode lookup stub for the local stack", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outside call in a test"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSpy.mockRestore();
  });

  it("answers a fixture product without any outside call", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100017");
    expect(result.found).toBe(true);
    expect(result.product?.name).toBe("Test Brown Rice 2 lb");
    expect(result.product?.barcode).toBe("2000000100017");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers not found for a code missing from the fixture without any outside call", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100999");
    expect(result.found).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores the stub when NODE_ENV is production", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.stubEnv("NODE_ENV", "production");
    // A fresh module, so the result cache of an earlier test is not read.
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("ignores the stub when VERCEL is set", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.stubEnv("VERCEL", "1");
    // A fresh module, so the result cache of an earlier test is not read.
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("ignores the stub when VERCEL_ENV is set", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.stubEnv("VERCEL_ENV", "preview");
    // A fresh module, so the result cache of an earlier test is not read.
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("still asks the outside providers when the variable is unset", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", "");
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("answers a fixture multipack with the pack mass, multiplying the unit mass once", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100031");
    expect(result.product?.unitCount).toBe(12);
    // 42 g per bar declared as a single unit, so the package is 12 x 42 g.
    expect(result.product?.netWeightG).toBe(504);
    expect(result.product?.unitWeightG).toBe(42);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a code that is not a usable product identifier without calling outside", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", "");
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("012345678904");
    expect(result.found).toBe(false);
    expect(result.identityProblem).toMatch(/check digit/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not remember a no-match when every provider failed", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", "");
    vi.resetModules();
    const module = await import("../server/barcode-lookup");
    module.clearBarcodeCache();
    const first = await module.lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(first.found).toBe(false);
    // Every provider threw, so the answer is unproven and must not be cached.
    expect(first.inconclusive).toBe(true);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await module.lookupBarcode(VALID_UPC_A_IN_FIXTURE);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
