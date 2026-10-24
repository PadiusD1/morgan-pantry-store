import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { lookupOpenPrices } from "../server/barcode/providers/open-prices";
const UPC = "012345678905";
const base = { id: 101, type: "PRODUCT", product_code: UPC, price: 2.69, currency: "USD", date: "2026-07-22", price_per: null, price_is_discounted: false, discount_type: null, price_without_discount: null, owner_comment: null, location_id: 6500, location: { osm_name: "Synthetic store" }, proof: { id: 201, owner_comment: null } };
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-21T12:00:00Z")); fetchSpy = vi.spyOn(globalThis, "fetch"); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function lookup(rows: unknown[]) { fetchSpy.mockResolvedValue(new Response(JSON.stringify({ items: rows }))); return lookupOpenPrices(UPC); }

it("keeps an ordinary packaged barcode observation with null price_per usable", async () => {
  const result = await lookup([base]);
  expect(result?.priceCents).toBe(269);
  expect(result?.priceProvenance).toMatchObject({ currency: "USD", observedAt: "2026-07-22", retailer: "Synthetic store", locationId: "6500" });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
it("holds an embedded app-condition comment even when discount flag is false", async () => {
  const result = await lookup([{ ...base, proof: { ...base.proof, owner_comment: "With Lidl+ app" } }]);
  expect(result?.priceCents).toBeUndefined();
  expect(result?.priceReview?.[0]).toMatchObject({ priceCents: 269, currency: "USD", reason: expect.stringMatching(/note|condition/i) });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
for (const patch of [
  { owner_comment: "Only with voucher" }, { proof: { ...base.proof, owner_comment: "Solo con tarjeta" } },
  { price_is_discounted: true }, { price_is_discounted: undefined }, { discount_type: "LOYALTY_PROGRAM" },
  { price_without_discount: 3.99 }, { proof: null }, { proof: { id: 201 } }, { price_per: "KILOGRAM" },
]) {
  it(`keeps uncertain or conditional price for review: ${JSON.stringify(patch)}`, async () => {
    const result = await lookup([{ ...base, ...patch }]);
    expect(result?.priceCents).toBeUndefined();
    expect(result?.priceReview?.length).toBeGreaterThan(0);
  });
}
it("chooses a regular price when a cheaper conditional offer is present", async () => {
  const result = await lookup([{ ...base, price: 1.00, owner_comment: "Members only" }, { ...base, id: 102, price: 3.00 }]);
  expect(result?.priceCents).toBe(300);
  expect(result?.priceReview?.[0].priceCents).toBe(100);
});
it("keeps currency/date refusal alongside any conditional reason", async () => {
  const result = await lookup([{ ...base, currency: "EUR", owner_comment: "Members only" }]);
  expect(result?.priceCents).toBeUndefined();
  expect(result?.priceReview?.[0].reason).toMatch(/EUR/);
  expect(result?.priceReview?.[0].reason).toMatch(/note|condition/i);
});
it("never adopts a different product or makes supplementary proof requests", async () => {
  expect(await lookup([{ ...base, product_code: "036000291452" }])).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
