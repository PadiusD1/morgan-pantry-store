import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// barcode-lookup imports log from app, which would open the database pool.
vi.mock("../server/app", () => ({ log: () => {} }));

const FIXTURE = path.resolve(import.meta.dirname, "..", "scripts", "local-stack", "barcode-fixture.json");

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
    const result = await lookupBarcode("2000000100017");
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("ignores the stub when VERCEL is set", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.stubEnv("VERCEL", "1");
    // A fresh module, so the result cache of an earlier test is not read.
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100017");
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("ignores the stub when VERCEL_ENV is set", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", FIXTURE);
    vi.stubEnv("VERCEL_ENV", "preview");
    // A fresh module, so the result cache of an earlier test is not read.
    vi.resetModules();
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100017");
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("still asks the outside providers when the variable is unset", async () => {
    vi.stubEnv("FRC_BARCODE_STUB", "");
    const { lookupBarcode } = await import("../server/barcode-lookup");
    const result = await lookupBarcode("2000000100048");
    expect(result.found).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
