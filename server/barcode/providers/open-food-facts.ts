import { packageMassGrams } from "@shared/item-measurements";
import { sameGtin } from "@shared/gtin";
import { JSON_HEADERS, massFromQuantity, providerFetch } from "../http";
import { weightEvidence } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "Open Food Facts";

// v2 returns the stored code with the record, which is what lets us confirm the
// response belongs to the scanned GTIN rather than trusting our own request.
const FIELDS = [
  "code", "product_name", "generic_name", "brands", "categories_tags",
  "product_quantity", "product_quantity_unit", "quantity", "allergens_tags", "image_url",
].join(",");

/** Open Food Facts product data, reused under ODbL with attribution. */
export async function lookupOpenFoodFacts(barcode: string): Promise<ProviderResult | null> {
  const res = await providerFetch(
    NAME,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`,
    { headers: { ...JSON_HEADERS }, notFound: [404] },
  );
  if (!res) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const name = String(p.product_name || p.generic_name || "").trim();
  if (!name) return null;

  // The record must carry the scanned GTIN. A redirect to a merged or
  // different product shows up here as a mismatch.
  const gtinVerified = sameGtin(p.code ?? data.code, barcode);

  const rawCategory =
    (Array.isArray(p.categories_tags) && p.categories_tags[0]?.split(":").pop()) || "";
  const category = rawCategory
    ? rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1).replace(/-/g, " ")
    : "Uncategorized";

  // product_quantity is the net content of one package, and its unit must be
  // stated. A record that gives 1000 with no unit alongside "1 L" is a litre of
  // juice, not a kilogram, and guessing grams would invent a density.
  const structuredMass = massFromQuantity(p.product_quantity, p.product_quantity_unit);
  // The free-text net quantity is the fallback. That parser refuses volumes,
  // serving text and multipack expressions on its own.
  const labelMass = structuredMass === null && typeof p.quantity === "string"
    ? packageMassGrams(p.quantity)
    : null;

  const mass = structuredMass !== null
    ? weightEvidence({
        grams: structuredMass,
        basis: "provider_net_quantity",
        packageBasis: "whole_package",
        source: "Open Food Facts net quantity (ODbL)",
        note: "Net content published for this barcode with an explicit mass unit. Confirm one inventory unit is this package.",
      })
    : labelMass !== null
      ? weightEvidence({
          grams: labelMass,
          basis: "label_net_mass",
          // Read out of free text, so what it measures is not certain.
          packageBasis: "unknown",
          source: "Open Food Facts quantity text (ODbL)",
          note: "Net mass read from the free-text package quantity. Usable only where the package is a single unit.",
        })
      : null;

  const allergens = (p.allergens_tags || []).map((a: string) =>
    (a.split(":").pop() || a).replace(/-/g, " "),
  );

  return {
    name,
    brand: p.brands || undefined,
    category,
    description: p.generic_name || undefined,
    gtinVerified,
    ...(gtinVerified && mass ? mass : {}),
    allergens,
    imageUrl: p.image_url || undefined,
    raw: { product: p },
  };
}
