import { describe, expect, it } from "vitest";
import { STALE_PRICE_DAYS, resolveOffers, weightEvidence } from "../server/barcode/evidence";
import { resolvePackageMass } from "../server/barcode/normalize";
import { identityProblemFor } from "../server/barcode/identity";
import { detectPackInfo } from "../server/barcode/packaging";
import { massFromQuantity } from "../server/barcode/http";
import { packageMassGrams } from "@shared/item-measurements";
import { UNKNOWN_WEIGHT_PROVENANCE } from "@shared/measurement-provenance";

const NOW = new Date("2026-10-21T12:00:00Z");
const recent = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe("resolveOffers currency and date rules", () => {
  it("adopts a complete USD offer and keeps the retailer, currency and observation date", () => {
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: recent(10), retailer: "Test Store" }],
      undefined,
      NOW,
    );
    expect(outcome.adopted?.priceCents).toBe(250);
    expect(outcome.adopted?.provenance).toMatchObject({
      currency: "USD",
      retailer: "Test Store",
      observedAt: recent(10),
      fetchedAt: "2026-10-21",
      confidence: "observed",
    });
    expect(outcome.review).toEqual([]);
  });

  it("refuses an offer with no stated currency rather than assuming dollars", () => {
    // Codex review R6.
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 12.34, currency: undefined, observedAt: recent(1), retailer: "Test Store" }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
    expect(outcome.review).toHaveLength(1);
    expect(outcome.review[0].currency).toBe("unstated");
  });

  it("refuses an offer in another currency instead of converting it silently", () => {
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "EUR", observedAt: recent(1), retailer: "Test Store" }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
    expect(outcome.review[0]).toMatchObject({ currency: "EUR" });
  });

  it("refuses an undated offer and does not stamp it with today", () => {
    // Codex review R6.
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: undefined, retailer: "Test Store" }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
    expect(outcome.review[0].reason).toMatch(/no usable observation date/);
  });

  it("refuses a partially readable amount instead of truncating it", () => {
    // Codex review R8: "2,50" previously parsed as 2.00.
    for (const price of ["2,50", "2.5.0", "about 3", "", "1.234"]) {
      const outcome = resolveOffers(
        "Test provider",
        [{ price, currency: "USD", observedAt: recent(1), retailer: "Test Store" }],
        undefined,
        NOW,
      );
      expect(outcome.adopted, `price ${JSON.stringify(price)}`).toBeNull();
    }
  });

  it("accepts a well-formed decimal string and a leading dollar sign", () => {
    expect(
      resolveOffers("T", [{ price: "2.50", currency: "USD", observedAt: recent(1), retailer: null }], undefined, NOW)
        .adopted?.priceCents,
    ).toBe(250);
    expect(
      resolveOffers("T", [{ price: "$2.50", currency: "usd", observedAt: recent(1), retailer: null }], undefined, NOW)
        .adopted?.priceCents,
    ).toBe(250);
  });

  it("refuses a date that is not a real calendar day", () => {
    // Codex review R8: 2026-02-30 previously rolled forward to 2 March.
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: "2026-02-30", retailer: null }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
  });

  it("refuses an observation dated in the future", () => {
    // Codex review R8.
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: "2099-01-01", retailer: null }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
  });

  it("holds a listing older than the stale threshold for review", () => {
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: recent(STALE_PRICE_DAYS + 5), retailer: null }],
      undefined,
      NOW,
    );
    expect(outcome.adopted).toBeNull();
    expect(outcome.review[0].reason).toMatch(/more than 365 days ago/);
  });

  it("adopts the cheapest complete listing and still reports the held ones", () => {
    const outcome = resolveOffers(
      "Test provider",
      [
        { price: 4.0, currency: "USD", observedAt: recent(2), retailer: "Dearer" },
        { price: 3.0, currency: "USD", observedAt: recent(3), retailer: "Cheaper" },
        { price: 1.0, currency: undefined, observedAt: recent(1), retailer: "No currency" },
      ],
      undefined,
      NOW,
    );
    expect(outcome.adopted?.provenance.retailer).toBe("Cheaper");
    expect(outcome.review).toHaveLength(1);
  });

  it("accepts a unix observation timestamp in seconds", () => {
    const seconds = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);
    const outcome = resolveOffers(
      "Test provider",
      [{ price: 2.5, currency: "USD", observedAt: seconds, retailer: null }],
      undefined,
      NOW,
    );
    expect(outcome.adopted?.provenance.observedAt).toBe("2026-10-01");
  });
});

describe("resolvePackageMass, pack count and basis together", () => {
  const whole = weightEvidence({
    grams: 454,
    basis: "provider_net_quantity",
    packageBasis: "whole_package",
    source: "Test",
    note: "Test",
  });
  const perUnit = weightEvidence({
    grams: 40,
    basis: "provider_net_quantity",
    packageBasis: "single_unit",
    source: "Test",
    note: "Test",
  });
  const ambiguous = weightEvidence({
    grams: 141.7,
    basis: "label_net_mass",
    packageBasis: "unknown",
    source: "Test",
    note: "Test",
  });

  it("leaves a whole-package figure alone, whatever the pack count", () => {
    expect(resolvePackageMass(whole.packageMassG, whole.weightProvenance, 12).packageMassG).toBe(454);
  });

  it("multiplies a single-unit figure by the pack count exactly once", () => {
    const resolved = resolvePackageMass(perUnit.packageMassG, perUnit.weightProvenance, 12);
    expect(resolved.packageMassG).toBe(480);
    expect(resolved.provenance.packageBasis).toBe("whole_package");
    expect(resolved.provenance.note).toMatch(/Multiplied once by the pack count of 12/);
  });

  it("keeps an ambiguous multipack size unknown rather than guessing", () => {
    // Codex review R5: "Synthetic Bar 12 pack" with size "5 oz".
    const resolved = resolvePackageMass(ambiguous.packageMassG, ambiguous.weightProvenance, 12);
    expect(resolved.packageMassG).toBeNull();
    expect(resolved.provenance.confidence).toBe("unknown");
    expect(resolved.provenance.note).toMatch(/does not say whether that is the whole pack or one unit/);
  });

  it("accepts an ambiguous figure when the package holds one unit", () => {
    expect(resolvePackageMass(ambiguous.packageMassG, ambiguous.weightProvenance, 1).packageMassG)
      .toBeCloseTo(141.7, 4);
  });

  it("stays unknown with no figure at all, and never becomes zero", () => {
    const resolved = resolvePackageMass(undefined, undefined, 1);
    expect(resolved.packageMassG).toBeNull();
    expect(resolved.provenance).toEqual(UNKNOWN_WEIGHT_PROVENANCE);
  });
});

describe("whole-token numeric parsing", () => {
  it("refuses a comma decimal rather than reading half of it", () => {
    // Codex review R11: "2,5" with kg previously became 2000 g, and the label
    // parser read the "5 kg" out of the middle of "2,5 kg" as 5000 g.
    expect(massFromQuantity("2,5", "kg")).toBeNull();
    expect(packageMassGrams("2,5 kg")).toBeNull();
  });

  it("refuses a grouped thousands separator too", () => {
    expect(packageMassGrams("1,000 g")).toBeNull();
    expect(massFromQuantity("1,000", "g")).toBeNull();
  });

  it("still reads an ordinary mass in either notation", () => {
    expect(massFromQuantity(2.5, "kg")).toBe(2500);
    expect(massFromQuantity("2.5", "kg")).toBe(2500);
    expect(packageMassGrams("2.5 kg")).toBe(2500);
    expect(packageMassGrams("16 oz")).toBeCloseTo(453.592, 2);
  });

  it("still refuses a volume, because volume is not mass", () => {
    expect(massFromQuantity(1000, "ml")).toBeNull();
    expect(massFromQuantity(1000, undefined)).toBeNull();
    expect(packageMassGrams("12 fl oz")).toBeNull();
  });
});

describe("detectPackInfo", () => {
  it("recognises a hyphenated pack count", () => {
    // Codex review R11: "12-pack" previously read as a single package, which
    // let a component size be adopted as the whole package mass.
    expect(detectPackInfo("Granola Bars 12-pack 5 oz")).toMatchObject({
      packageType: "multi_pack",
      unitCount: 12,
    });
  });

  it("recognises the spaced form the same way", () => {
    expect(detectPackInfo("Granola Bars 12 pack 5 oz")).toMatchObject({ unitCount: 12 });
    expect(detectPackInfo("Soda 24-ct")).toMatchObject({ unitCount: 24 });
  });

  it("prefers a count the provider declared over one parsed from a title", () => {
    expect(detectPackInfo("Bars 12 pack", undefined, 6)).toMatchObject({ unitCount: 6 });
  });

  it("leaves a genuine single package alone", () => {
    expect(detectPackInfo("Brown Rice 2 lb")).toMatchObject({ packageType: "single", unitCount: 1 });
  });

  it("keeps a hyphenated multipack mass unknown, end to end", () => {
    const pack = detectPackInfo("Granola Bars 12-pack 5 oz");
    const ambiguous = weightEvidence({
      grams: packageMassGrams("5 oz")!,
      basis: "label_net_mass",
      packageBasis: "unknown",
      source: "Test",
      note: "Test",
    });
    expect(resolvePackageMass(ambiguous.packageMassG, ambiguous.weightProvenance, pack.unitCount).packageMassG)
      .toBeNull();
  });
});

describe("identityProblemFor", () => {
  it("allows a valid, globally circulating GTIN through to the providers", () => {
    expect(identityProblemFor("012345678905")).toBeNull();
  });

  it("explains a length that is not a barcode", () => {
    expect(identityProblemFor("123456789")).toMatch(/8, 12, 13 or 14 digits and this one has 9/);
  });

  it("explains a local identifier that is not all digits", () => {
    expect(identityProblemFor("SKU-012345678905")).toMatch(/not digits/);
  });

  it("explains a failed check digit", () => {
    expect(identityProblemFor("012345678904")).toMatch(/check digit/);
  });

  it("explains a store-local variable-measure code and asks for a weighing", () => {
    expect(identityProblemFor("212345678909")).toMatch(/variable-measure/);
    expect(identityProblemFor("212345678909")).toMatch(/weigh the package/);
  });
});
