import { packageMassGrams } from "@shared/item-measurements";
import { sameGtin } from "@shared/gtin";
import { JSON_HEADERS, providerFetch } from "../http";
import { resolveOffers, weightEvidence, type RawOffer } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "Barcode Lookup";

/**
 * Barcode Lookup, an optional keyed provider.
 *
 * It stays disabled unless BARCODE_LOOKUP_API_KEY is already present in the
 * deployment. No account is created and no plan is bought here.
 */
export async function lookupBarcodeLookupCom(barcode: string): Promise<ProviderResult | null> {
  const key = process.env.BARCODE_LOOKUP_API_KEY;
  if (!key) return null;

  // 404 is the documented answer for a barcode not in the database. A 403 is
  // an invalid or exhausted key, which leaves the question open.
  const res = await providerFetch(
    NAME,
    `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(barcode)}&formatted=y&key=${encodeURIComponent(key)}`,
    { headers: { ...JSON_HEADERS }, notFound: [404] },
  );
  if (!res) return null;
  const data = await res.json();
  const products: Record<string, any>[] = Array.isArray(data?.products) ? data.products : [];
  const product = products.find((candidate) => sameGtin(candidate?.barcode_number, barcode));
  if (!product) return null;
  const name = String(product.title ?? product.product_name ?? "").trim();
  if (!name) return null;

  // A declared multipack count is better evidence than parsing the title.
  const multipack = Number.parseInt(String(product.multipack ?? ""), 10);
  const unitCountHint =
    Number.isInteger(multipack) && multipack > 1 && multipack <= 500 ? multipack : undefined;

  // The provider's generic `weight` field may be a shipping weight including
  // packaging, which is not the net contents, so it is never read. The declared
  // `size` is read through the parser that refuses volumes and multipack
  // expressions. On a declared multipack that size may describe one unit inside
  // the box, so its basis is ambiguous and the aggregator decides.
  const grams = typeof product.size === "string" ? packageMassGrams(product.size) : null;
  const mass = grams === null
    ? null
    : weightEvidence({
        grams,
        basis: "label_net_mass",
        packageBasis: unitCountHint ? "unknown" : "whole_package",
        source: "Barcode Lookup declared size",
        note: unitCountHint
          ? `The listing declares a pack of ${unitCountHint}, so this size may describe one unit rather than the pack. The provider's generic weight field was not used because it can include packaging.`
          : "Net mass read from the declared package size. The provider's generic weight field was not used because it can include packaging.",
      });

  // Field names follow the official V3 store attributes: price, currency,
  // name and last_update. Guessed names such as store_price silently dropped
  // every documented offer, which looked like a provider with no price data.
  const offers: RawOffer[] = (Array.isArray(product.stores) ? product.stores : []).map(
    (store: Record<string, unknown>) => ({
      price: store.price,
      currency: store.currency,
      observedAt: store.last_update,
      retailer: store.name,
    }),
  );
  const price = resolveOffers("Barcode Lookup store offer", offers);

  return {
    name,
    brand: product.brand || product.manufacturer || undefined,
    category: typeof product.category === "string" ? product.category.split(">")[0].trim() : "Uncategorized",
    description: product.description || undefined,
    gtinVerified: true,
    ...(unitCountHint !== undefined ? { unitCountHint } : {}),
    ...(mass ?? {}),
    ...(price.adopted
      ? { priceCents: price.adopted.priceCents, priceProvenance: price.adopted.provenance }
      : {}),
    ...(price.review.length ? { priceReview: price.review } : {}),
    allergens: [],
    raw: { barcodeLookup: product },
  };
}
