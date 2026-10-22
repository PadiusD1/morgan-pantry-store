/**
 * Where a saved weight or value came from, and how much it is worth trusting.
 *
 * Three words carry different weight on a pantry shelf and must not be mixed:
 * observed is a figure printed on the package or published by a named source,
 * estimated is a derivation someone can re-derive and argue with, and
 * staff_measured is a person who put the package on a scale. An absent figure
 * is unknown. Unknown is a real answer and never becomes a zero.
 */
export type MeasurementConfidence = "observed" | "estimated" | "staff_measured" | "unknown";

/**
 * How a mass figure was arrived at. Serving mass, fluid volume and shipping
 * weight are all excluded by construction, because none of them is the net mass
 * of one pantry package.
 */
export type WeightBasis =
  /** A net-content quantity published by the provider for this exact GTIN. */
  | "provider_net_quantity"
  /** A net mass printed in the product name or package-size text. */
  | "label_net_mass"
  /** No defensible basis. */
  | "unknown";

export type WeightProvenance = {
  basis: WeightBasis;
  confidence: MeasurementConfidence;
  /** The provider or document the figure came from. */
  source: string | null;
  /** ISO date this figure was read. */
  observedAt: string | null;
  /**
   * What the figure measures, so a pack is never read as a single and a
   * component is never read as a package.
   *
   * whole_package: the net contents of the retail package as sold.
   * single_unit:   the mass of one consumable unit inside the package, which
   *                the aggregator multiplies by the pack count exactly once.
   * unknown:       the declaration is ambiguous, for example a size read from
   *                a multipack title that may describe one bar or the box.
   *                An ambiguous mass is only usable when the pack count is 1.
   */
  packageBasis: "whole_package" | "single_unit" | "unknown";
  note: string | null;
};

/**
 * A price is an observation by one retailer, in one currency, on one date, for
 * one package. It is not the pantry's acquisition cost, which only a receipt or
 * a donation record can establish.
 */
export type PriceProvenance = {
  confidence: MeasurementConfidence;
  source: string | null;
  retailer: string | null;
  /**
   * The currency the retailer quoted, always explicit. A figure whose currency
   * the provider did not state is refused rather than assumed to be dollars.
   */
  currency: string;
  /**
   * The date the retailer's price was observed, from the provider's own record.
   * Null means the provider gave no date, which is not the same as today.
   */
  observedAt: string | null;
  /** The date this application read the record. Never a substitute for observedAt. */
  fetchedAt: string | null;
  locationId: string | null;
  note: string | null;
};

/** An offer that cannot be adopted automatically, kept visible for review. */
export type PriceReviewCandidate = {
  source: string;
  retailer: string | null;
  currency: string;
  priceCents: number;
  /** Why it was not adopted, in words a staff reviewer can act on. */
  reason: string;
};

/** Only this currency is adopted automatically; the pantry reports in dollars. */
export const ADOPTABLE_CURRENCY = "USD";

export const UNKNOWN_WEIGHT_PROVENANCE: WeightProvenance = {
  basis: "unknown",
  confidence: "unknown",
  source: null,
  observedAt: null,
  packageBasis: "unknown",
  note: "No published net mass for this exact barcode. Weigh one package and record it in the completeness review.",
};

export const UNKNOWN_PRICE_PROVENANCE: PriceProvenance = {
  confidence: "unknown",
  source: null,
  retailer: null,
  currency: "USD",
  observedAt: null,
  fetchedAt: null,
  locationId: null,
  note: "No dated retail observation for this exact package. Record a value from a receipt or a dated price source in the completeness review.",
};

/** The sentence shown wherever a retail observation is displayed or exported. */
export const RETAIL_OBSERVATION_DISCLAIMER =
  "A retail price observation is one retailer's listed price on one date, not the pantry's acquisition cost.";

/** Staff work outranks every provider figure; an estimate never overwrites it. */
export function outranks(incoming: MeasurementConfidence, existing: MeasurementConfidence): boolean {
  const order: Record<MeasurementConfidence, number> = {
    unknown: 0,
    estimated: 1,
    observed: 2,
    staff_measured: 3,
  };
  return order[incoming] > order[existing];
}
