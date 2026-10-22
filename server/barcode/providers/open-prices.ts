import { sameGtin } from "@shared/gtin";
import { JSON_HEADERS, providerFetch } from "../http";
import { resolveOffers, type OfferOutcome, type RawOffer } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "Open Prices";

function reviewReason(row: Record<string, any>): string | null {
  // Upstream validates that price_per is unset for a product_code: null is
  // the normal packaged-product convention, not an assumed kilogram-to-unit
  // conversion. Explicit non-unit declarations still cannot price a package.
  // https://github.com/openfoodfacts/open-prices/blob/main/open_prices/prices/validators.py
  if ((row.type !== undefined && row.type !== "PRODUCT")
    || (row.price_per != null && row.price_per !== "" && row.price_per !== "UNIT")) {
    return "This observation does not establish the price of one packaged item. Confirm the package basis before using it.";
  }
  if (row.price_is_discounted !== false || row.discount_type
    || row.price_without_discount != null) {
    return "This observation has a discount or incomplete discount information. Confirm an unconditional package price before using it.";
  }
  // PriceFull embeds Proof.owner_comment. A false discount flag alone does
  // not rule out receipt-level app, member, coupon or quantity conditions.
  // Free text is not reliably classifiable across languages, so any note is
  // retained for review; clean observations remain automatically usable.
  // https://prices.openfoodfacts.org/api/schema (checked 2026-10-21)
  if (!row.proof || typeof row.proof !== "object"
    || !("owner_comment" in row.proof) || !("owner_comment" in row)) {
    return "The observation's price or receipt notes are unavailable, so purchase conditions cannot be checked. Review its proof before using it.";
  }
  if ([row.owner_comment, row.proof.owner_comment].some((note) => note != null
    && (typeof note !== "string" || note.trim().length > 0))) {
    return "A price or receipt contributor note may specify purchase conditions. Review the original note and confirm an unconditional price before using it.";
  }
  return null;
}


/**
 * Open Prices, the Open Food Facts price database, read only and under ODbL.
 *
 * This is a price source. It contributes a dated retail observation and does
 * not decide the product's name, because its records are contributed per
 * receipt rather than per catalogue entry. Coverage for any given US pantry SKU
 * is unproven, so it adds a price when one exists and otherwise nothing.
 */
export async function lookupOpenPrices(barcode: string): Promise<ProviderResult | null> {
  const res = await providerFetch(
    NAME,
    `https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(barcode)}&order_by=-date&size=10`,
    { headers: { ...JSON_HEADERS }, notFound: [404] },
  );
  if (!res) return null;
  const data = await res.json();
  const rows: Record<string, any>[] = Array.isArray(data?.items) ? data.items : [];
  if (rows.length === 0) return null;

  const matching = rows.slice(0, 10).filter((row) => sameGtin(row?.product_code, barcode));
  if (matching.length === 0) return null;
  const price: OfferOutcome = { adopted: null, review: [] };
  for (const row of matching) {
    const offer: RawOffer = {
      price: row.price, currency: row.currency, observedAt: row.date,
      retailer: row.location?.osm_name ?? null, locationId: row.location_id ?? null,
    };
    const outcome = resolveOffers("Open Prices (ODbL)", [offer]);
    const reason = reviewReason(row);
    price.review.push(...outcome.review.map((candidate) => ({
      ...candidate, reason: reason ? `${candidate.reason} ${reason}` : candidate.reason,
    })));
    if (!outcome.adopted) continue;
    if (reason) {
      const { priceCents, provenance } = outcome.adopted;
      price.review.push({ source: "Open Prices (ODbL)", retailer: provenance.retailer,
        currency: provenance.currency, priceCents, reason });
    } else if (!price.adopted || outcome.adopted.priceCents < price.adopted.priceCents) {
      price.adopted = outcome.adopted;
    }
  }

  return {
    // Left empty on purpose: a price contributor does not name the product.
    name: "",
    gtinVerified: true,
    ...(price.adopted
      ? { priceCents: price.adopted.priceCents, priceProvenance: price.adopted.provenance }
      : {}),
    ...(price.review.length ? { priceReview: price.review } : {}),
    allergens: [],
    raw: { openPrices: matching },
  };
}
