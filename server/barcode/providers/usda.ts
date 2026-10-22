import { packageMassGrams } from "@shared/item-measurements";
import { sameGtin } from "@shared/gtin";
import { JSON_HEADERS, providerFetch } from "../http";
import { weightEvidence } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "USDA FoodData Central";

/**
 * USDA FoodData Central branded foods, public domain under CC0.
 *
 * This is a nutrient and branded-label database, not a grocery price feed, so
 * it contributes identity and package weight and never a price.
 */
export async function lookupUsda(barcode: string): Promise<ProviderResult | null> {
  // A data.gov key allows 1000 requests an hour per address. DEMO_KEY allows 30
  // an hour and 50 a day, so an exhausted demo key is an outage, not a miss.
  const apiKey = encodeURIComponent(process.env.USDA_API_KEY || "DEMO_KEY");

  // FoodData Central has no barcode endpoint; a GTIN search runs through the
  // branded-food text query, which can return near matches and unrelated rows.
  // Ask for a page wide enough to hold the real record, then adopt a row only
  // when its own gtinUpc is the scanned GTIN.
  // The search endpoint answers 200 with an empty list for an unknown GTIN. A
  // 403 means the data.gov key was refused or its hourly allowance is spent,
  // which establishes nothing about the product.
  const res = await providerFetch(
    NAME,
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(barcode)}&dataType=Branded&pageSize=25&api_key=${apiKey}`,
    { headers: { ...JSON_HEADERS }, notFound: [404] },
  );
  if (!res) return null;
  const data = await res.json();
  if (!Array.isArray(data.foods) || data.foods.length === 0) return null;

  let food = data.foods.find((candidate: { gtinUpc?: string }) => sameGtin(candidate.gtinUpc, barcode));
  if (!food) return null;

  // SearchResultFood is an abbreviated record. The documented full-food
  // endpoint may supply optional packageWeight omitted by search. Spend at
  // most one extra request, only for an already verified GTIN and a valid FDC
  // ID; never follow near matches or walk further search pages. Both IDs are
  // checked again before any detail fields can contribute evidence.
  // Official endpoint/schema: https://fdc.nal.usda.gov/api-spec/fdc_api.html
  // (checked 2026-10-21). packageWeight remains optional; servingSize is not
  // a package measurement. The shared transport preserves outages/rate limits
  // as failures and aborts requests at its existing deadline.
  if ((typeof food.packageWeight !== "string" || !food.packageWeight.trim())
    && Number.isSafeInteger(food.fdcId) && food.fdcId > 0) {
    const detailResponse = await providerFetch(
      NAME,
      `https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?format=full&api_key=${apiKey}`,
      { headers: { ...JSON_HEADERS }, notFound: [404] },
    );
    if (detailResponse) {
      const detail = await detailResponse.json();
      if (detail?.fdcId === food.fdcId && sameGtin(detail.gtinUpc, barcode)) {
        food = { ...food, ...detail };
      }
    }
  }

  const name = String(food.description || food.lowercaseDescription || "").trim();
  if (!name) return null;

  // packageWeight is the net content of the package, for example "16 oz".
  // servingSize is a serving and is deliberately never read: a can with three
  // servings would otherwise be recorded at a third of its mass.
  const grams = typeof food.packageWeight === "string" ? packageMassGrams(food.packageWeight) : null;
  const mass = grams === null
    ? null
    : weightEvidence({
        grams,
        basis: "provider_net_quantity",
        packageBasis: "whole_package",
        source: "USDA FoodData Central package weight (public domain, CC0)",
        note: "Net package weight from the USDA branded-food record for this GTIN.",
      });

  return {
    name,
    brand: food.brandName || food.brandOwner || undefined,
    category: food.brandedFoodCategory || "Uncategorized",
    description: food.ingredients || undefined,
    gtinVerified: true,
    ...(mass ?? {}),
    allergens: [],
    raw: { food },
  };
}
