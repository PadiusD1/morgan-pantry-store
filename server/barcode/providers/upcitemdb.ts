import { packageMassGrams } from "@shared/item-measurements";
import { sameGtin } from "@shared/gtin";
import { USER_AGENT, providerFetch } from "../http";
import { resolveOffers, weightEvidence, type RawOffer } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "UPC Item DB";

export async function lookupUpcItemDb(barcode: string): Promise<ProviderResult | null> {
  const apiKey = process.env.UPCITEMDB_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  // The prod endpoint when a key exists, otherwise the free trial endpoint.
  let endpoint: string;
  if (apiKey) {
    headers["user_key"] = apiKey;
    endpoint = `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`;
  } else {
    endpoint = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  }

  // The free Explorer tier allows 100 combined requests a day. Exhausting it,
  // or having the key rejected, surfaces as an outage, never as proof that the
  // product is unknown. Only the documented 404 is a real miss.
  const res = await providerFetch(NAME, endpoint, { headers, notFound: [404] });
  if (!res) return null;
  const data = await res.json();
  if (!Array.isArray(data.items) || data.items.length === 0) return null;

  // Take the record that actually carries the scanned GTIN.
  const item = data.items.find((candidate: { upc?: string; ean?: string; gtin?: string }) =>
    sameGtin(candidate.upc, barcode) || sameGtin(candidate.ean, barcode) || sameGtin(candidate.gtin, barcode),
  );
  if (!item) return null;
  const name = String(item.title || "").trim();
  if (!name) return null;

  // Net mass from package-size text only. packageMassGrams refuses fluid
  // measures, serving text and any "12 x 1.5 oz" multipack expression, but it
  // cannot tell whether "5 oz" on a twelve-pack title is the box or one bar.
  // That ambiguity is declared, and the aggregator resolves it against the
  // final pack count instead of assuming the larger reading.
  let grams: number | null = null;
  for (const text of [item.size, item.dimension, item.title, item.description]) {
    if (typeof text !== "string" || !text) continue;
    grams = packageMassGrams(text);
    if (grams !== null) break;
  }
  const mass = grams === null
    ? null
    : weightEvidence({
        grams,
        basis: "label_net_mass",
        packageBasis: "unknown",
        source: "UPC Item DB package text",
        note: "Net mass read from listing text, which may describe the package or one unit inside it. Usable only where the package is a single unit.",
      });

  // Offers are retailer listings. resolveOffers refuses an offer with no stated
  // currency or no observation date and keeps it visible for review instead.
  const offers: RawOffer[] = (Array.isArray(item.offers) ? item.offers : []).map((offer: Record<string, unknown>) => ({
    price: offer.price,
    currency: offer.currency,
    observedAt: offer.updated_t ?? offer.updated,
    retailer: offer.merchant ?? offer.domain,
  }));
  const price = resolveOffers("UPC Item DB offer", offers);

  return {
    name,
    brand: item.brand || undefined,
    category: item.category || "Uncategorized",
    description: item.description || undefined,
    gtinVerified: true,
    ...(mass ?? {}),
    ...(price.adopted
      ? { priceCents: price.adopted.priceCents, priceProvenance: price.adopted.provenance }
      : {}),
    ...(price.review.length ? { priceReview: price.review } : {}),
    allergens: [],
    raw: { item },
  };
}
