/**
 * One owner for the rules every provider adapter must obey when it turns a
 * third-party field into evidence. Keeping these here means a new adapter
 * cannot quietly reintroduce an assumed currency or an assumed package basis.
 */
import {
  ADOPTABLE_CURRENCY,
  RETAIL_OBSERVATION_DISCLAIMER,
  type PriceProvenance,
  type PriceReviewCandidate,
  type WeightBasis,
  type WeightProvenance,
} from "@shared/measurement-provenance";
/**
 * How old a retail observation may be and still be adopted without a person
 * looking at it. Grocery prices move, and a two-year-old listing recorded as
 * today's value would overstate or understate a donation. Older listings are
 * kept as review candidates rather than thrown away.
 */
import { completeNumber } from "./http";

export const STALE_PRICE_DAYS = 365;

const todayIn = (now: Date): string => now.toISOString().slice(0, 10);

/** A retailer listing exactly as the provider stated it, with nothing assumed. */
export type RawOffer = {
  /** The number the provider gave, in whatever shape it gave it. */
  price: unknown;
  /** The currency code the provider stated. Absent means absent. */
  currency: unknown;
  /** The date the provider says the price was seen. Absent means absent. */
  observedAt: unknown;
  retailer: unknown;
  locationId?: unknown;
};

export type OfferOutcome = {
  /** The one offer safe to adopt automatically, if any. */
  adopted: { priceCents: number; provenance: PriceProvenance } | null;
  /** Offers a person should look at, each with the reason it was held back. */
  review: PriceReviewCandidate[];
};

/**
 * A money amount only when the provider wrote a complete one.
 *
 * parseFloat stops at the first character it cannot read, so the European
 * decimal "2,50" came through as 2.00, quietly understating a price by a fifth.
 * A string must therefore be the whole amount and nothing else, with a dot
 * decimal separator and at most two fraction digits. Anything else is a format
 * this code does not understand, and guessing at it is how a wrong number ends
 * up in a donor valuation.
 */
function asPositiveAmount(value: unknown): number | null {
  // A money amount carries at most two fraction digits, so this is stricter
  // than completeNumber, which also serves package quantities.
  const text = typeof value === "string" ? value.trim().replace(/^\$/, "").trim() : value;
  if (typeof text === "string" && !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = completeNumber(text);
  return amount !== null && amount > 0 && amount < 1_000_000 ? amount : null;
}

/**
 * An observation date only when it is a real calendar day that has happened.
 *
 * Date parsing rolls impossible days forward, so "2026-02-30" became the
 * second of March and looked like a genuine observation. The parsed date is
 * therefore compared back against the text it came from. A date in the future
 * is refused as well: a price cannot have been observed tomorrow, so such a
 * record is a data-entry fault rather than evidence.
 */
function asIsoDate(value: unknown, now: Date = new Date()): string | null {
  let text: string;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Providers that date an offer with a unix timestamp in seconds.
    const fromEpoch = new Date(value * 1000);
    if (Number.isNaN(fromEpoch.getTime())) return null;
    text = fromEpoch.toISOString().slice(0, 10);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
    text = trimmed.slice(0, 10);
  } else {
    return null;
  }
  const parsed = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // A real day round-trips; 2026-02-30 comes back as 2026-03-02.
  if (parsed.toISOString().slice(0, 10) !== text) return null;
  // Tomorrow's price has not been observed yet. One day of slack covers a
  // provider stamping a date in a timezone ahead of ours.
  const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (text > limit) return null;
  return text;
}

function asCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Decide which retailer listing may be adopted.
 *
 * An offer is adopted only when the provider stated a positive amount, an
 * explicit three-letter currency that the pantry reports in, and a date the
 * price was observed. A missing currency is not dollars, and a missing date is
 * not today: an undated listing could be five years old, and recording it as a
 * current price would put a fiction into a donor valuation. Those listings stay
 * visible as review candidates so a person can confirm or replace them.
 */
export function resolveOffers(
  source: string,
  offers: RawOffer[],
  locationNote?: string,
  now: Date = new Date(),
): OfferOutcome {
  const review: PriceReviewCandidate[] = [];
  const staleBefore = new Date(now.getTime() - STALE_PRICE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const adoptable: { amount: number; offer: RawOffer; currency: string; observedAt: string }[] = [];

  for (const offer of offers) {
    const amount = asPositiveAmount(offer.price);
    if (amount === null) continue;
    const currency = asCurrency(offer.currency);
    const retailer = typeof offer.retailer === "string" && offer.retailer.trim() ? offer.retailer.trim() : null;

    if (currency === null) {
      review.push({
        source,
        retailer,
        currency: "unstated",
        priceCents: Math.round(amount * 100),
        reason: "The provider gave no currency for this listing, so the amount cannot be read as dollars. Confirm the currency before using it.",
      });
      continue;
    }
    if (currency !== ADOPTABLE_CURRENCY) {
      review.push({
        source,
        retailer,
        currency,
        priceCents: Math.round(amount * 100),
        reason: `This listing is in ${currency}. Converting it needs a dated exchange rate, so it is not adopted automatically.`,
      });
      continue;
    }
    const observedAt = asIsoDate(offer.observedAt, now);
    if (observedAt === null) {
      review.push({
        source,
        retailer,
        currency,
        priceCents: Math.round(amount * 100),
        reason: "The provider gave no usable observation date for this listing, so it may be stale or misdated. Confirm a current price before using it.",
      });
      continue;
    }
    if (observedAt < staleBefore) {
      review.push({
        source,
        retailer,
        currency,
        priceCents: Math.round(amount * 100),
        reason: `This listing was observed on ${observedAt}, more than ${STALE_PRICE_DAYS} days ago. Confirm it still reflects the shelf before using it.`,
      });
      continue;
    }
    adoptable.push({ amount, offer, currency, observedAt });
  }

  adoptable.sort((a, b) => a.amount - b.amount);
  const best = adoptable[0];
  if (!best) return { adopted: null, review };

  const locationId =
    best.offer.locationId !== undefined && best.offer.locationId !== null
      ? String(best.offer.locationId)
      : null;

  return {
    adopted: {
      priceCents: Math.round(best.amount * 100),
      provenance: {
        confidence: "observed",
        source,
        retailer: typeof best.offer.retailer === "string" && best.offer.retailer.trim() ? best.offer.retailer.trim() : null,
        currency: best.currency,
        observedAt: best.observedAt,
        fetchedAt: todayIn(now),
        locationId,
        note: locationNote ? `${RETAIL_OBSERVATION_DISCLAIMER} ${locationNote}` : RETAIL_OBSERVATION_DISCLAIMER,
      },
    },
    review,
  };
}

/**
 * Describe a mass figure together with what it measures.
 *
 * `basis` says where the number came from and `packageBasis` says what it
 * measures. A size parsed out of a multipack title is declared `unknown`,
 * because "Granola Bars 12 count 5 oz" could mean a five-ounce box or
 * five-ounce bars, and the aggregator only accepts an ambiguous figure when the
 * pack count turns out to be one.
 */
export function weightEvidence(options: {
  grams: number;
  basis: WeightBasis;
  packageBasis: WeightProvenance["packageBasis"];
  source: string;
  note: string;
}): { packageMassG: number; weightProvenance: WeightProvenance } {
  return {
    packageMassG: options.grams,
    weightProvenance: {
      basis: options.basis,
      confidence: "observed",
      source: options.source,
      observedAt: todayIn(new Date()),
      packageBasis: options.packageBasis,
      note: options.note,
    },
  };
}
