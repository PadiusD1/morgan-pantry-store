import { sameGtin } from "@shared/gtin";
import { USER_AGENT, providerFetch } from "../http";
import { weightEvidence } from "../evidence";
import type { ProviderResult } from "../types";

const NAME = "Nutritionix";

/**
 * A serving unit that denotes one whole consumable item rather than a portion
 * of one. "1 bottle" or "1 bar" is one retail unit; "1 cup" or "2 tbsp" is a
 * portion and tells us nothing about the package.
 */
const SINGLE_UNIT_SERVINGS = /^(package|container|bottle|can|jar|pouch|bar|box|carton|cup\s+container)$/i;

export async function lookupNutritionix(barcode: string): Promise<ProviderResult | null> {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const appKey = process.env.NUTRITIONIX_APP_KEY;
  if (!appId || !appKey) return null;

  // A UPC the database does not hold answers 404. A 401 means the application
  // credentials were refused, which proves nothing about the product.
  const res = await providerFetch(
    NAME,
    `https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(barcode)}`,
    {
      headers: { "x-app-id": appId, "x-app-key": appKey, "User-Agent": USER_AGENT, Accept: "application/json" },
      notFound: [404],
    },
  );
  if (!res) return null;
  const data = await res.json();
  if (!Array.isArray(data.foods) || data.foods.length === 0) return null;

  const food = data.foods[0];
  const name = String(food.food_name || "").trim();
  if (!name) return null;

  // serving_weight_grams is the mass of ONE SERVING. It is only usable when the
  // serving is declared as one whole unit, and even then it describes that one
  // unit: on a twelve-pack of bars, "1 bar" is a component. It is therefore
  // declared as a single unit, and the aggregator multiplies by the pack count
  // exactly once rather than recording a box as one bar.
  const servingQty = Number(food.serving_qty);
  const servingUnit = String(food.serving_unit ?? "").trim();
  const grams = Number(food.serving_weight_grams);
  const usable =
    servingQty === 1 &&
    SINGLE_UNIT_SERVINGS.test(servingUnit) &&
    Number.isFinite(grams) &&
    grams > 0 &&
    grams <= 100_000;

  const mass = usable
    ? weightEvidence({
        grams,
        basis: "provider_net_quantity",
        packageBasis: "single_unit",
        source: "Nutritionix single-unit serving",
        note: `The serving is declared as 1 ${servingUnit}, so this is the mass of one unit, not necessarily of the whole package.`,
      })
    : null;

  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    brand: food.brand_name || undefined,
    category: food.brand_name || "Uncategorized",
    description: food.nf_ingredient_statement || undefined,
    gtinVerified: sameGtin(food.upc, barcode),
    ...(mass ?? {}),
    allergens: [],
    raw: { food },
  };
}
