import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lookupUsda } from "../server/barcode/providers/usda";

const UPC = "012345678905";
const exact = { fdcId: 12345, gtinUpc: UPC, description: "Synthetic package", brandOwner: "Synthetic Brand" };
let fetchSpy: ReturnType<typeof vi.spyOn>;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  vi.stubEnv("USDA_API_KEY", "synthetic-key");
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("fetches one full exact-GTIN detail when search omits package weight", async () => {
  fetchSpy.mockResolvedValueOnce(response({ foods: [exact] }))
    .mockResolvedValueOnce(response({ ...exact, gtinUpc: "0012345678905", packageWeight: "16 oz", servingSize: 28, servingSizeUnit: "g" }));
  const result = await lookupUsda(UPC);
  expect(result?.packageMassG).toBeCloseTo(453.59237, 4);
  expect(result?.weightProvenance).toMatchObject({ packageBasis: "whole_package", source: expect.stringContaining("USDA") });
  expect(result?.priceCents).toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const url = new URL(String(fetchSpy.mock.calls[1][0]));
  expect(url.pathname).toBe("/fdc/v1/food/12345");
  expect(url.searchParams.get("format")).toBe("full");
  expect(url.searchParams.get("api_key")).toBe("synthetic-key");
  for (const [, init] of fetchSpy.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it("does not spend a detail request when search already supplies package mass", async () => {
  fetchSpy.mockResolvedValueOnce(response({ foods: [{ ...exact, packageWeight: "1 lb" }] }));
  expect((await lookupUsda(UPC))?.packageMassG).toBeCloseTo(453.59237, 4);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it("never fetches details for a near-match search result", async () => {
  fetchSpy.mockResolvedValueOnce(response({ foods: [{ ...exact, gtinUpc: "036000291452" }] }));
  expect(await lookupUsda(UPC)).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

for (const fdcId of [undefined, "12345/other", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  it(`does not make an unbounded or invalid detail request for fdcId ${fdcId}`, async () => {
    fetchSpy.mockResolvedValueOnce(response({ foods: [{ ...exact, fdcId }] }));
    expect((await lookupUsda(UPC))?.name).toBe(exact.description);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
}

for (const detail of [
  { ...exact, gtinUpc: "036000291452", packageWeight: "99 lb" },
  { ...exact, fdcId: 54321, packageWeight: "99 lb" },
  { fdcId: exact.fdcId, packageWeight: "99 lb" },
]) {
  it("does not adopt detail weight until both detail identifiers match", async () => {
    fetchSpy.mockResolvedValueOnce(response({ foods: [exact] })).mockResolvedValueOnce(response(detail));
    const result = await lookupUsda(UPC);
    expect(result?.name).toBe(exact.description);
    expect(result?.packageMassG).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

for (const packageWeight of [undefined, "1 L", "12 fl oz"]) {
  it(`does not substitute serving mass for missing/nonmass package weight ${packageWeight}`, async () => {
    fetchSpy.mockResolvedValueOnce(response({ foods: [exact] })).mockResolvedValueOnce(response({ ...exact, packageWeight, servingSize: 28, servingSizeUnit: "g" }));
    expect((await lookupUsda(UPC))?.packageMassG).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}

it("retains the exact search identity when its detail record has gone missing", async () => {
  fetchSpy.mockResolvedValueOnce(response({ foods: [exact] })).mockResolvedValueOnce(response({}, 404));
  const result = await lookupUsda(UPC);
  expect(result?.name).toBe(exact.description);
  expect(result?.packageMassG).toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

for (const status of [403, 429, 503]) {
  it(`propagates detail HTTP ${status} as unavailable without an adapter retry`, async () => {
    fetchSpy.mockResolvedValueOnce(response({ foods: [exact] })).mockResolvedValueOnce(response({}, status));
    await expect(lookupUsda(UPC)).rejects.toMatchObject({ name: "ProviderUnavailableError", status });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
}
