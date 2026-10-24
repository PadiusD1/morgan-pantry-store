import { packageMassGrams } from "@shared/item-measurements";
import { sameGtin, strictGtin } from "@shared/gtin";
import { JSON_HEADERS, USER_AGENT, providerFetch, today } from "../http";
import { resolveOffers, weightEvidence, type RawOffer } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "Kroger";

let token: { value: string; expiresAt: number } | null = null;

/** Test seam, so a suite can prove the disabled path without a stale token. */
export function resetKrogerToken(): void {
  token = null;
}

async function accessToken(): Promise<string | null> {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && Date.now() < token.expiresAt) return token.value;

  // A refused credential must raise, not quietly disable the provider and let
  // a no-match be remembered as a fact.
  const res = await providerFetch(NAME, "https://api.kroger.com/v1/connect/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });
  if (!res) return null;
  const body = await res.json();
  if (typeof body?.access_token !== "string") return null;
  const ttl = Number(body.expires_in);
  token = {
    value: body.access_token,
    expiresAt: Date.now() + (Number.isFinite(ttl) ? Math.max(ttl - 60, 60) : 60) * 1000,
  };
  return token.value;
}

/**
 * Kroger Products, a real grocery-retailer source, gated on credentials this
 * deployment may not hold.
 *
 * Kroger's public workspace documents that the product list accepts a search
 * term and a locationId, and a price only exists per store, so a configured
 * location is required before any price is read. Nothing here creates or buys a
 * credential: without all three environment values the provider stays disabled
 * and the integration status page reports it as not configured. Until real
 * credentials exist, retailer coverage for the pantry's actual items is
 * unproven and this adapter is untested against the live service.
 */
export async function lookupKroger(barcode: string): Promise<ProviderResult | null> {
  const locationId = process.env.KROGER_LOCATION_ID;
  const bearer = await accessToken();
  if (!bearer || !locationId) return null;
  const gtin = strictGtin(barcode);
  if (!gtin) return null;

  const params = new URLSearchParams({
    // Kroger indexes the 13-digit form, so the GTIN-14 padding is dropped.
    "filter.term": gtin.replace(/^0+/, ""),
    "filter.locationId": locationId,
    "filter.limit": "25",
  });
  const res = await providerFetch(NAME, `https://api.kroger.com/v1/products?${params}`, {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${bearer}` },
    notFound: [404],
  });
  if (!res) return null;
  const body = await res.json();
  const rows: Record<string, any>[] = Array.isArray(body?.data) ? body.data : [];
  const product = rows.find((candidate) => sameGtin(candidate?.upc, barcode));
  if (!product) return null;
  const name = String(product.description ?? "").trim();
  if (!name) return null;

  const first = Array.isArray(product.items) ? product.items[0] : undefined;
  // "size" is the retailer's declared pack size, which for a multipack may
  // describe one unit inside it, so its basis is left for the aggregator.
  const grams = typeof first?.size === "string" ? packageMassGrams(first.size) : null;
  const mass = grams === null
    ? null
    : weightEvidence({
        grams,
        basis: "label_net_mass",
        packageBasis: "unknown",
        source: "Kroger declared product size",
        note: "Net mass read from the retailer's declared size, which may describe the package or one unit inside it.",
      });

  // A shelf price is dated by the moment it was read, because the API returns
  // the price in effect now for the configured store.
  const offers: RawOffer[] = first?.price?.regular !== undefined
    ? [{
        price: first.price.regular,
        currency: "USD",
        observedAt: today(),
        retailer: "Kroger",
        locationId,
      }]
    : [];
  const price = resolveOffers("Kroger regular shelf price", offers, `This price is for store ${locationId}.`);

  return {
    name,
    brand: product.brand || undefined,
    category: Array.isArray(product.categories) ? product.categories[0] : "Uncategorized",
    gtinVerified: true,
    ...(mass ?? {}),
    ...(price.adopted
      ? { priceCents: price.adopted.priceCents, priceProvenance: price.adopted.provenance }
      : {}),
    ...(price.review.length ? { priceReview: price.review } : {}),
    allergens: [],
    raw: { kroger: product },
  };
}
