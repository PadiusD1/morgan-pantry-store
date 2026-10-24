import {
  UNKNOWN_PRICE_PROVENANCE,
  UNKNOWN_WEIGHT_PROVENANCE,
  type PriceReviewCandidate,
  type WeightProvenance,
} from "@shared/measurement-provenance";
import { strictGtin } from "@shared/gtin";
import { detectPackInfo } from "./packaging";
import type { LookupLog, NormalizedProduct, ProviderResult } from "./types";

/** A provider answer with its score, ready for selection. */
export type ScoredResult = {
  provider: string;
  priority: number;
  result: ProviderResult;
  confidence: number;
};

export function computeConfidence(result: ProviderResult): number {
  // A record that does not carry the scanned GTIN is not a match at all.
  if (!result.gtinVerified) return 0;

  let score = 0.5; // base: the provider returned this exact GTIN
  if (result.name && result.name.length > 3) score += 0.1;
  if (result.brand) score += 0.1;
  if (result.packageMassG && result.packageMassG > 0) score += 0.1;
  if (result.priceCents && result.priceCents > 0) score += 0.05;
  if (result.allergens && result.allergens.length > 0) score += 0.05;
  if (result.category && result.category !== "Uncategorized") score += 0.05;
  if (result.description && result.description.length > 10) score += 0.05;
  return Math.min(score, 1.0);
}

export function selectBest(scored: ScoredResult[]): ScoredResult | null {
  // Only a record that names the product can lead. A price contributor such as
  // Open Prices carries no name of its own and must not become the identity.
  const named = scored.filter((entry) => entry.result.name.trim().length > 0);
  if (named.length === 0) return null;
  return named.sort((a, b) => b.confidence - a.confidence || a.priority - b.priority)[0];
}

/**
 * Fill gaps from the other verified providers, carrying each field's own
 * evidence with it. A price never arrives without its currency, retailer and
 * date, and a mass never arrives without its basis, because a figure separated
 * from its evidence cannot be audited later.
 */
export function mergeSupplemental(best: ProviderResult, others: ProviderResult[]): ProviderResult {
  const merged: ProviderResult = { ...best };
  const review: PriceReviewCandidate[] = [...(best.priceReview ?? [])];

  for (const other of others) {
    if (!other.gtinVerified) continue;
    review.push(...(other.priceReview ?? []));
    if (!merged.brand && other.brand) merged.brand = other.brand;
    if (merged.packageMassG === undefined && other.packageMassG !== undefined && other.weightProvenance) {
      merged.packageMassG = other.packageMassG;
      merged.weightProvenance = other.weightProvenance;
    }
    if (merged.priceCents === undefined && other.priceCents !== undefined && other.priceProvenance) {
      merged.priceCents = other.priceCents;
      merged.priceProvenance = other.priceProvenance;
    }
    if (merged.unitCountHint === undefined && other.unitCountHint !== undefined) {
      merged.unitCountHint = other.unitCountHint;
    }
    if ((!merged.allergens || merged.allergens.length === 0) && other.allergens?.length) {
      merged.allergens = other.allergens;
    }
    if (!merged.description && other.description) merged.description = other.description;
    if (
      (merged.category === undefined || merged.category === "Uncategorized") &&
      other.category &&
      other.category !== "Uncategorized"
    ) {
      merged.category = other.category;
    }
    if (!merged.imageUrl && other.imageUrl) merged.imageUrl = other.imageUrl;
  }

  // A figure that lost its evidence on the way here is dropped rather than
  // stored as an unexplained number.
  if (merged.packageMassG !== undefined && !merged.weightProvenance) delete merged.packageMassG;
  if (merged.priceCents !== undefined && !merged.priceProvenance) delete merged.priceCents;
  merged.priceReview = review;

  return merged;
}

export type ResolvedMass = {
  /** Net mass of the whole retail package, or null when it stays unknown. */
  packageMassG: number | null;
  provenance: WeightProvenance;
};

/**
 * Settle the pack count and the mass basis together, so a multipack count is
 * applied exactly once and never to a figure that already includes it.
 *
 * whole_package: the figure already describes the package. Nothing is multiplied.
 * single_unit:   the figure describes one unit, so it is multiplied by the count once.
 * unknown:       the declaration is ambiguous. It is only usable when the pack
 *                count is one, because "12 count, 5 oz" could be a five-ounce
 *                box or five-ounce bars, and guessing either way would put an
 *                invented weight on a donor valuation.
 */
export function resolvePackageMass(
  mass: number | undefined,
  declared: WeightProvenance | undefined,
  unitCount: number,
): ResolvedMass {
  if (mass === undefined || mass === null || !declared) {
    return { packageMassG: null, provenance: UNKNOWN_WEIGHT_PROVENANCE };
  }
  const count = Number.isFinite(unitCount) && unitCount >= 1 ? Math.floor(unitCount) : 1;

  if (declared.packageBasis === "whole_package") {
    return { packageMassG: mass, provenance: { ...declared, packageBasis: "whole_package" } };
  }

  if (declared.packageBasis === "single_unit") {
    const total = mass * count;
    return {
      packageMassG: total,
      provenance: {
        ...declared,
        packageBasis: "whole_package",
        note: count > 1
          ? `${declared.note ?? ""} Multiplied once by the pack count of ${count} to reach the package mass.`.trim()
          : declared.note,
      },
    };
  }

  // Ambiguous. One unit in the package means the ambiguity does not matter.
  if (count === 1) {
    return { packageMassG: mass, provenance: { ...declared, packageBasis: "whole_package" } };
  }
  return {
    packageMassG: null,
    provenance: {
      ...UNKNOWN_WEIGHT_PROVENANCE,
      note: `A size of ${mass.toFixed(0)} g was published alongside a pack of ${count}, and the source does not say whether that is the whole pack or one unit. Weigh one package and record it in the completeness review.`,
    },
  };
}

/** Assemble the saved product record from the merged evidence. */
export function buildNormalizedProduct(options: {
  barcode: string;
  merged: ProviderResult;
  winningSource: string;
  matchConfidence: number;
  logs: LookupLog[];
}): NormalizedProduct {
  const { barcode, merged, winningSource, matchConfidence, logs } = options;
  const packInfo = detectPackInfo(merged.name, merged.description, merged.unitCountHint);
  const category = merged.category || "Uncategorized";

  // No category average is invented here. A shelf-stable average for "snacks"
  // is not this product's mass, and a number nobody can source is worse on a
  // report than an explicit gap.
  const mass = resolvePackageMass(merged.packageMassG, merged.weightProvenance, packInfo.unitCount);

  // One inventory unit is one scanned package, so the stored per-unit weight is
  // the whole-package mass. unitWeightG is the per-component figure, derived
  // once from that total.
  const unitWeightG = mass.packageMassG !== null && packInfo.unitCount > 1
    ? mass.packageMassG / packInfo.unitCount
    : mass.packageMassG;
  const weightLbs = mass.packageMassG !== null ? mass.packageMassG / 453.59237 : 0;

  const costCents = merged.priceCents ?? null;
  const priceProvenance = merged.priceProvenance ?? UNKNOWN_PRICE_PROVENANCE;
  const valueUsd = costCents !== null ? costCents / 100 : 0;

  return {
    name: merged.name,
    brand: merged.brand || null,
    category,
    barcode,
    gtin: strictGtin(barcode) ?? barcode,

    packageType: packInfo.packageType,
    unitCount: packInfo.unitCount,
    packComponents: packInfo.components,

    netWeightG: mass.packageMassG,
    unitWeightG,
    // Every adopted mass is a published figure, so nothing here is an estimate.
    weightIsEstimated: false,
    weightPerUnitLbs: Math.round(weightLbs * 10000) / 10000,
    weightProvenance: mass.provenance,

    costCents,
    // A retailer's listed price is observed, not estimated, and it is also not
    // the pantry's acquisition cost. The provenance note carries that.
    costIsEstimated: false,
    currency: priceProvenance.currency,
    valuePerUnitUsd: Math.round(valueUsd * 100) / 100,
    priceProvenance,
    priceReview: merged.priceReview ?? [],

    allergens: merged.allergens || [],

    dataSourcesTried: logs.map((l) => ({
      api: l.api,
      status: l.status,
      latencyMs: l.latencyMs,
      error: l.error,
    })),
    winningSource,
    matchConfidence,
    rawPayload: {
      ...merged.raw,
      ...(merged.imageUrl ? { frcProductImage: merged.imageUrl } : {}),
      frcWeightProvenance: mass.provenance,
      frcPriceProvenance: priceProvenance,
      ...(merged.priceReview?.length ? { frcPriceReviewCandidates: merged.priceReview } : {}),
    },
  };
}
