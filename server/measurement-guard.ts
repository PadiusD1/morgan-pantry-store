import { isDeepStrictEqual } from "node:util";

/**
 * Protecting a measurement a person established, and the evidence behind it.
 *
 * Weights and values reach an item by two very different routes. One is the
 * completeness review, which demands a source, an explicit estimated-or-not
 * flag and the item version, and writes an audit entry. The other is the
 * ordinary inventory edit form, which sends every field it holds and carries no
 * source at all.
 *
 * That second route could silently replace a figure someone measured on a scale
 * with whatever a form happened to be holding, and the resulting number would
 * look exactly as authoritative on a donor receipt.
 *
 * Guarding only the two figures was not enough. The insert schema also accepts
 * raw_payload, where the review audit lives, and the whole enrichment block:
 * the package basis, the pack count, the gram weights, the estimate flags and
 * the provider attribution. Clearing raw_payload and then setting a weight
 * passed a guard that looked only at the figures, and left a number with no
 * evidence at all. So the ordinary route now protects the evidence as well as
 * the figures: it may change what an item IS, and the review route owns what
 * the pantry KNOWS about it.
 *
 * An edit that leaves those fields alone is untouched, which is almost every
 * edit: renaming an item, fixing its category, correcting its barcode or moving
 * its reorder threshold never trips this.
 */

/** The figures the review route records with a source. */
const MEASUREMENT_FIELDS = ["weightPerUnitLbs", "valuePerUnitUsd"] as const;

/**
 * The evidence behind those figures. Changing any of these rewrites what the
 * pantry claims to know, so it belongs to the review route and the enrichment
 * pipeline, not to a form with no source.
 */
const EVIDENCE_FIELDS = [
  "rawPayload",
  "netWeightG",
  "unitWeightG",
  "weightIsEstimated",
  "costCents",
  "costIsEstimated",
  "currency",
  "packageType",
  "unitCount",
  "winningSource",
  "matchConfidence",
  "dataSourcesTried",
] as const;

export const PROTECTED_FIELDS = [...MEASUREMENT_FIELDS, ...EVIDENCE_FIELDS] as const;
export type ProtectedField = (typeof PROTECTED_FIELDS)[number];

export type ReviewedItem = Partial<Record<ProtectedField, unknown>>;
export type MeasurementPatch = Partial<Record<ProtectedField, unknown>>;

const REVIEW_KEY = "frcMeasurementReview";

/** Whether a person has recorded a reviewed measurement for this item. */
export function hasMeasurementReview(item: ReviewedItem): boolean {
  const payload = item.rawPayload;
  return !!payload && typeof payload === "object" && REVIEW_KEY in (payload as Record<string, unknown>);
}

const NUMERIC_FIELDS = new Set<string>([
  "weightPerUnitLbs", "valuePerUnitUsd", "netWeightG", "unitWeightG", "costCents", "unitCount", "matchConfidence",
]);

/** Whether this patch would actually move the stored field. */
function changed(field: string, submitted: unknown, stored: unknown): boolean {
  if (submitted === undefined) return false;
  if (NUMERIC_FIELDS.has(field)) {
    const next = Number(submitted);
    const current = Number(stored);
    if (submitted === null || stored === null) return submitted !== stored;
    if (!Number.isFinite(next) || !Number.isFinite(current)) return true;
    // Four decimals for pounds and two for dollars, so this tolerance sits
    // below anything either field can express.
    return Math.abs(next - current) > 0.00005;
  }
  if (field === "rawPayload" || field === "dataSourcesTried") {
    return !isDeepStrictEqual(submitted ?? null, stored ?? null);
  }
  return submitted !== stored;
}

/** Which protected fields this patch would move. */
export function protectedChanges(item: ReviewedItem, patch: MeasurementPatch): ProtectedField[] {
  return PROTECTED_FIELDS.filter((field) => changed(field, patch[field], item[field]));
}

export const MEASUREMENT_REVIEW_REFUSAL =
  'This item\'s recorded measurements and their evidence were reviewed and saved with a source. Change them under "Complete item weights, estimated values and photos", which keeps the source and whether each figure is measured or estimated. Nothing in this save was applied, so no part of it is half done.';

export const EVIDENCE_REFUSAL =
  'This save would change what the pantry records about how this item was measured, not just the item itself. Make measurement changes under "Complete item weights, estimated values and photos" so the source is kept. Nothing in this save was applied.';

/**
 * The reason this patch must not be applied, or null.
 *
 * A reviewed item refuses any change to a protected field. An item with no
 * review or provider figure may still have its figures corrected on the form,
 * because there is no recorded evidence to contradict. Its evidence block is never
 * rewritten from a route that cannot describe where the new values came from.
 */
export function measurementRefusal(item: ReviewedItem, patch: MeasurementPatch): string | null {
  const moved = protectedChanges(item, patch);
  if (moved.length === 0) return null;
  if (hasMeasurementReview(item)) return MEASUREMENT_REVIEW_REFUSAL;
  const payload = item.rawPayload && typeof item.rawPayload === "object"
    ? item.rawPayload as Record<string, unknown> : {};
  const hasProviderFigure = (field: ProtectedField): boolean => {
    const weight = field === "weightPerUnitLbs";
    const evidence = payload[weight ? "frcWeightProvenance" : "frcPriceProvenance"];
    const knownEvidence = evidence && typeof evidence === "object"
      && (evidence as Record<string, unknown>).confidence !== "unknown"
      && !!(evidence as Record<string, unknown>).source;
    // Older enriched records predate field-specific provenance but still carry
    // a provider/source and gram or cent representation of the same figure.
    const legacyFigure = weight ? item.netWeightG ?? item.unitWeightG : item.costCents;
    return !!knownEvidence || (legacyFigure !== null && legacyFigure !== undefined);
  };
  return moved.some((field) => (EVIDENCE_FIELDS as readonly string[]).includes(field)
    || hasProviderFigure(field)) ? EVIDENCE_REFUSAL : null;
}

/**
 * Strip protected fields that are unchanged, so an ordinary edit does not
 * rewrite them at all and the stored provenance stays attached to the figure it
 * describes.
 */
export function withoutUnchangedMeasurements<T extends MeasurementPatch>(item: ReviewedItem, patch: T): T {
  const next = { ...patch };
  for (const field of PROTECTED_FIELDS) {
    if (!changed(field, patch[field], item[field])) delete next[field];
  }
  return next;
}
