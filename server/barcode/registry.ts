import { lookupStubProduct } from "../barcode-stub";
import { lookupBarcodeLookupCom } from "./providers/barcode-lookup-com";
import { lookupKroger } from "./providers/kroger";
import { lookupNutritionix } from "./providers/nutritionix";
import { lookupOpenFoodFacts } from "./providers/open-food-facts";
import { lookupOpenPrices } from "./providers/open-prices";
import { lookupUpcItemDb } from "./providers/upcitemdb";
import { lookupUsda } from "./providers/usda";
import type { ApiProvider } from "./types";

/** The fixture stub name, which the orchestrator treats as a local fixture. */
export const STUB_PROVIDER = "Local stub";

// The fixture stub is for the local stack only. It is never honoured in a
// production process or anywhere Vercel runs the code.
function stubAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL === undefined &&
    process.env.VERCEL_ENV === undefined
  );
}

export function getProviders(): ApiProvider[] {
  const stub = process.env.FRC_BARCODE_STUB;
  if (stub && stubAllowed()) {
    return [{ name: STUB_PROVIDER, enabled: true, priority: 1, lookup: (code) => lookupStubProduct(stub, code) }];
  }
  return [
    { name: "Open Food Facts", enabled: true, priority: 1, lookup: lookupOpenFoodFacts },
    { name: "UPC Item DB", enabled: true, priority: 2, lookup: lookupUpcItemDb },
    { name: "USDA FoodData Central", enabled: true, priority: 3, lookup: lookupUsda },
    {
      name: "Nutritionix",
      enabled: !!(process.env.NUTRITIONIX_APP_ID && process.env.NUTRITIONIX_APP_KEY),
      priority: 4,
      lookup: lookupNutritionix,
    },
    { name: "Open Prices", enabled: true, priority: 5, lookup: lookupOpenPrices },
    {
      name: "Barcode Lookup",
      enabled: !!process.env.BARCODE_LOOKUP_API_KEY,
      priority: 6,
      lookup: lookupBarcodeLookupCom,
    },
    {
      name: "Kroger",
      enabled: !!(
        process.env.KROGER_CLIENT_ID &&
        process.env.KROGER_CLIENT_SECRET &&
        process.env.KROGER_LOCATION_ID
      ),
      priority: 7,
      lookup: lookupKroger,
    },
  ];
}

export type ProviderReadiness = {
  name: string;
  enabled: boolean;
  /** What this deployment still needs, or null when nothing is required. */
  requires: string | null;
  /** What the provider contributes, so a label is never mistaken for coverage. */
  contributes: string;
};

/**
 * What this deployment can actually reach, for the integration status page.
 * A provider in this list is configured, which is not the same as proven to
 * cover the pantry's items.
 */
export function providerReadiness(): ProviderReadiness[] {
  const detail: Record<string, { requires: string | null; contributes: string }> = {
    [STUB_PROVIDER]: { requires: null, contributes: "Synthetic local fixture only; never used in production." },
    "Open Food Facts": { requires: null, contributes: "Identity, category, allergens and net quantity. ODbL." },
    "UPC Item DB": {
      requires: "UPCITEMDB_API_KEY raises the free limit of 100 lookups a day",
      contributes: "Identity, package text and dated retailer offers.",
    },
    "USDA FoodData Central": {
      requires: "USDA_API_KEY raises the DEMO_KEY limit of 30 an hour and 50 a day",
      contributes: "Branded-label identity and net package weight. Public domain, no prices.",
    },
    Nutritionix: {
      requires: "NUTRITIONIX_APP_ID and NUTRITIONIX_APP_KEY",
      contributes: "Identity and single-unit serving mass. No prices.",
    },
    "Open Prices": { requires: null, contributes: "Dated public price observations. ODbL. Coverage of US pantry items is unproven." },
    "Barcode Lookup": {
      requires: "BARCODE_LOOKUP_API_KEY, which must already be authorized",
      contributes: "Identity, declared size, multipack count and store offers.",
    },
    Kroger: {
      requires: "KROGER_CLIENT_ID, KROGER_CLIENT_SECRET and KROGER_LOCATION_ID, none of which are configured or purchased here",
      contributes: "Grocery-retailer identity, size and the regular shelf price at one configured store.",
    },
  };
  return getProviders().map((provider) => ({
    name: provider.name,
    enabled: provider.enabled,
    requires: detail[provider.name]?.requires ?? null,
    contributes: detail[provider.name]?.contributes ?? "",
  }));
}
