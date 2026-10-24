import type { PriceProvenance, PriceReviewCandidate, WeightProvenance } from "@shared/measurement-provenance";

export type PackageType = "single" | "multi_pack" | "variety_pack" | "case";

/**
 * What one provider returned, before aggregation.
 *
 * Every measured field owns its evidence. `packageMassG` only ever travels with
 * a `weightProvenance`, and `priceCents` only ever travels with a
 * `priceProvenance` naming the currency, the retailer and the date. A figure
 * separated from its evidence cannot be audited later, so the aggregator drops
 * one that arrives alone rather than storing an unexplained number.
 */
export type ProviderResult = {
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  /**
   * True only when the provider's own response carries the scanned GTIN for
   * this record. A text search that happened to return something is not a
   * match, so an unverified result contributes no weight and no price.
   */
  gtinVerified: boolean;
  /** Net mass of ONE whole retail package. Never a serving, never a volume. */
  packageMassG?: number;
  weightProvenance?: WeightProvenance;
  priceCents?: number;
  priceProvenance?: PriceProvenance;
  /** Listings held back from adoption, each with the reason, kept for review. */
  priceReview?: PriceReviewCandidate[];
  /** A pack count the provider states outright, preferred over name parsing. */
  unitCountHint?: number;
  allergens?: string[];
  imageUrl?: string;
  raw: Record<string, unknown>;
};

/** Confidence-scored, normalized product after aggregation. */
export type NormalizedProduct = {
  name: string;
  brand: string | null;
  category: string;
  barcode: string;
  /** The canonical GTIN-14 this record is keyed on. */
  gtin: string;

  // Package
  packageType: PackageType;
  unitCount: number;
  packComponents: { name: string; barcode?: string; quantity: number; weightG?: number }[];

  // Weight. netWeightG is one whole package; unitWeightG divides it by the pack
  // count and is a component figure, never the inventory unit's own mass.
  netWeightG: number | null;
  unitWeightG: number | null;
  weightIsEstimated: boolean;
  weightPerUnitLbs: number;
  weightProvenance: WeightProvenance;

  // Cost
  costCents: number | null;
  costIsEstimated: boolean;
  currency: string;
  valuePerUnitUsd: number;
  priceProvenance: PriceProvenance;

  /** Listings a person should confirm, surfaced instead of silently dropped. */
  priceReview: PriceReviewCandidate[];

  allergens: string[];

  // Provenance
  dataSourcesTried: { api: string; status: string; latencyMs: number; error?: string }[];
  winningSource: string;
  matchConfidence: number;
  rawPayload: Record<string, unknown>;
};

export type LookupLog = {
  api: string;
  status: "success" | "miss" | "error";
  latencyMs: number;
  error?: string;
};

export type LookupResult = {
  found: boolean;
  product?: NormalizedProduct;
  logs: LookupLog[];
  /**
   * Present when the scanned code cannot serve as a global product
   * identifier, so the page can explain why instead of saying "not recognized".
   */
  identityProblem?: string;
  /**
   * True when at least one provider failed or was rate limited, so a no-match
   * is unproven. The page must not present this as a confirmed missing product.
   */
  inconclusive?: boolean;
};

export type ApiProvider = {
  name: string;
  enabled: boolean;
  /** Lower wins when two verified providers score the same. */
  priority: number;
  lookup: (barcode: string) => Promise<ProviderResult | null>;
};
