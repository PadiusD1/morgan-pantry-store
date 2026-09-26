import { log } from "./app";
import { lookupStubProduct } from "./barcode-stub";

// ─── Server-Side Barcode Result Cache ────────────────────────────────────────
// Prevents re-hitting external APIs for the same barcode within a session.
// Survives across requests but clears on server restart (intentional).

const barcodeCache = new Map<string, { result: LookupResult; cachedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedResult(barcode: string): LookupResult | null {
  const entry = barcodeCache.get(barcode);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    barcodeCache.delete(barcode);
    return null;
  }
  return entry.result;
}

function setCachedResult(barcode: string, result: LookupResult) {
  barcodeCache.set(barcode, { result, cachedAt: Date.now() });
  // Evict old entries when cache grows too large
  if (barcodeCache.size > 5000) {
    const oldest = [...barcodeCache.entries()]
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
      .slice(0, 1000);
    for (const [key] of oldest) barcodeCache.delete(key);
  }
}

// ─── Core Types ──────────────────────────────────────────────────────────────

export type PackageType = "single" | "multi_pack" | "variety_pack" | "case";

/** Raw data returned by a single provider before normalization. */
export type ProviderResult = {
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  weightG?: number;
  weightUnit?: string;
  priceCents?: number;
  currency?: string;
  allergens?: string[];
  imageUrl?: string;
  raw: Record<string, unknown>;
};

/** Confidence-scored, normalized product after aggregation. */
export type NormalizedProduct = {
  name: string;
  brand: string | null;
  category: string;
  barcode: string;

  // Package
  packageType: PackageType;
  unitCount: number;
  packComponents: { name: string; barcode?: string; quantity: number; weightG?: number }[];

  // Weight
  netWeightG: number | null;
  unitWeightG: number | null;
  weightIsEstimated: boolean;
  weightPerUnitLbs: number;

  // Cost
  costCents: number | null;
  costIsEstimated: boolean;
  currency: string;
  valuePerUnitUsd: number;

  // Allergens
  allergens: string[];

  // Provenance
  dataSourcesTried: { api: string; status: string; latencyMs: number; error?: string }[];
  winningSource: string;
  matchConfidence: number;
  rawPayload: Record<string, unknown>;
};

export type LookupLog = {
  api: string;
  status: "success" | "miss" | "error";
  latencyMs: number;
  error?: string;
};

export type LookupResult = {
  found: boolean;
  product?: NormalizedProduct;
  logs: LookupLog[];
};

// ─── Provider Interface ─────────────────────────────────────────────────────

type ApiProvider = {
  name: string;
  enabled: boolean;
  priority: number; // lower = higher priority
  lookup: (barcode: string) => Promise<ProviderResult | null>;
};

const API_TIMEOUT_MS = 8000; // Increased from 5s for slower connections

// ─── Concurrency Limiter ─────────────────────────────────────────────────────
// Prevents overwhelming external APIs when many barcodes are scanned rapidly.
// Only N lookups run concurrently; the rest queue up.

const MAX_CONCURRENT_LOOKUPS = 3;
let activeLookups = 0;
const lookupQueue: Array<{ resolve: (v: void) => void }> = [];

async function acquireLookupSlot(): Promise<void> {
  if (activeLookups < MAX_CONCURRENT_LOOKUPS) {
    activeLookups++;
    return;
  }
  return new Promise<void>((resolve) => {
    lookupQueue.push({ resolve });
  });
}

function releaseLookupSlot() {
  activeLookups--;
  const next = lookupQueue.shift();
  if (next) {
    activeLookups++;
    next.resolve();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Retry a provider lookup up to `maxRetries` times with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── Open Food Facts ────────────────────────────────────────────────────────

async function lookupOpenFoodFacts(barcode: string): Promise<ProviderResult | null> {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const name = p.product_name || p.generic_name || "";
  if (!name) return null;

  const rawCategory =
    (Array.isArray(p.categories_tags) && p.categories_tags[0]?.split(":").pop()) || "";
  const category = rawCategory
    ? rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1).replace(/-/g, " ")
    : "Uncategorized";

  // Weight in grams
  let weightG: number | undefined;
  const qty = parseFloat(p.product_quantity);
  if (!isNaN(qty) && qty > 0) {
    const unit = (p.product_quantity_unit || "g").toLowerCase();
    if (unit === "g") weightG = qty;
    else if (unit === "kg") weightG = qty * 1000;
    else if (unit === "oz") weightG = qty * 28.3495;
    else if (unit === "lb" || unit === "lbs") weightG = qty * 453.592;
  }

  const allergens = (p.allergens_tags || []).map((a: string) =>
    (a.split(":").pop() || a).replace(/-/g, " "),
  );

  return {
    name,
    brand: p.brands || undefined,
    category,
    description: p.generic_name || undefined,
    weightG,
    allergens,
    imageUrl: p.image_url || undefined,
    raw: { product: p },
  };
}

// ─── UPC Item DB ────────────────────────────────────────────────────────────

async function lookupUpcItemDb(barcode: string): Promise<ProviderResult | null> {
  const apiKey = process.env.UPCITEMDB_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Use prod endpoint if API key is available, otherwise trial (rate-limited)
  let endpoint: string;
  if (apiKey) {
    headers["user_key"] = apiKey;
    endpoint = `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`;
  } else {
    endpoint = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  }

  const res = await fetch(endpoint, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0];
  const name = item.title || "";
  if (!name) return null;

  // Try to extract weight from description
  let weightG: number | undefined;
  const weightMatch = (item.description || item.title || "").match(
    /(\d+(?:\.\d+)?)\s*(oz|lb|lbs|g|kg)/i,
  );
  if (weightMatch) {
    const val = parseFloat(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    if (unit === "oz") weightG = val * 28.3495;
    else if (unit === "lb" || unit === "lbs") weightG = val * 453.592;
    else if (unit === "g") weightG = val;
    else if (unit === "kg") weightG = val * 1000;
  }

  // Try to extract price from offers
  let priceCents: number | undefined;
  if (item.offers && item.offers.length > 0) {
    const lowestPrice = item.offers
      .map((o: { price?: number }) => o.price)
      .filter((p: unknown): p is number => typeof p === "number" && p > 0)
      .sort((a: number, b: number) => a - b)[0];
    if (lowestPrice) {
      priceCents = Math.round(lowestPrice * 100);
    }
  }

  return {
    name,
    brand: item.brand || undefined,
    category: item.category || "Uncategorized",
    description: item.description || undefined,
    weightG,
    priceCents,
    currency: "USD",
    allergens: [],
    raw: { item },
  };
}

// ─── Nutritionix ────────────────────────────────────────────────────────────

async function lookupNutritionix(barcode: string): Promise<ProviderResult | null> {
  const appId = process.env.NUTRITIONIX_APP_ID;
  const appKey = process.env.NUTRITIONIX_APP_KEY;
  if (!appId || !appKey) return null;

  const res = await fetch(
    `https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(barcode)}`,
    {
      headers: {
        "x-app-id": appId,
        "x-app-key": appKey,
      },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.foods || data.foods.length === 0) return null;

  const food = data.foods[0];
  const name = food.food_name || "";
  if (!name) return null;

  let weightG: number | undefined;
  const grams = food.serving_weight_grams;
  if (grams && !isNaN(grams)) {
    weightG = grams;
  }

  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    brand: food.brand_name || undefined,
    category: food.brand_name || "Uncategorized",
    description: food.nf_ingredient_statement || undefined,
    weightG,
    allergens: [],
    raw: { food },
  };
}

// ─── USDA FoodData Central (free, key optional) ────────────────────────────

async function lookupUsda(barcode: string): Promise<ProviderResult | null> {
  const apiKey = process.env.USDA_API_KEY || "DEMO_KEY";

  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(barcode)}&dataType=Branded&pageSize=1&api_key=${apiKey}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.foods || data.foods.length === 0) return null;

  const food = data.foods[0];
  const name = food.description || food.lowercaseDescription || "";
  if (!name) return null;

  // Try to get weight from servingSize
  let weightG: number | undefined;
  if (food.servingSize && food.servingSizeUnit) {
    const unit = food.servingSizeUnit.toLowerCase();
    if (unit === "g") weightG = food.servingSize;
    else if (unit === "ml") weightG = food.servingSize; // approximate
    else if (unit === "oz") weightG = food.servingSize * 28.3495;
  }

  return {
    name,
    brand: food.brandName || food.brandOwner || undefined,
    category: food.brandedFoodCategory || "Uncategorized",
    description: food.ingredients || undefined,
    weightG,
    allergens: [],
    raw: { food },
  };
}

// ─── Provider Registry ──────────────────────────────────────────────────────

function getProviders(): ApiProvider[] {
  const stub = process.env.FRC_BARCODE_STUB;
  if (stub) {
    return [{ name: "Local stub", enabled: true, priority: 1, lookup: (code) => lookupStubProduct(stub, code) }];
  }
  return [
    {
      name: "Open Food Facts",
      enabled: true,
      priority: 1,
      lookup: lookupOpenFoodFacts,
    },
    {
      name: "UPC Item DB",
      enabled: true,
      priority: 2,
      lookup: lookupUpcItemDb,
    },
    {
      name: "USDA FoodData Central",
      enabled: true,
      priority: 3,
      lookup: lookupUsda,
    },
    {
      name: "Nutritionix",
      enabled: !!(process.env.NUTRITIONIX_APP_ID && process.env.NUTRITIONIX_APP_KEY),
      priority: 4,
      lookup: lookupNutritionix,
    },
  ];
}

// ─── Variety Pack / Multi-Pack Detection ────────────────────────────────────

const VARIETY_PACK_PATTERNS = [
  /variety\s*pack/i,
  /assorted\s*(pack|flavors?|mix)/i,
  /sampler\s*pack/i,
  /mixed\s*(pack|flavors?)/i,
];

const MULTI_PACK_PATTERNS = [
  /(\d+)\s*(?:ct|count|pk|pack|cans?|bottles?|bags?|bars?|boxes?|pouches?|packets?|rolls?)\b/i,
  /(?:pack\s*of|box\s*of|case\s*of)\s*(\d+)/i,
  /(\d+)\s*[-x×]\s*(?:\d+(?:\.\d+)?\s*(?:oz|g|ml|fl\s*oz))/i,
];

const CASE_PATTERNS = [
  /\bcase\b/i,
  /\bbulk\b/i,
];

type PackInfo = {
  packageType: PackageType;
  unitCount: number;
  components: { name: string; quantity: number }[];
};

function detectPackInfo(name: string, description?: string): PackInfo {
  const text = `${name} ${description || ""}`;

  // Check variety pack first
  for (const pattern of VARIETY_PACK_PATTERNS) {
    if (pattern.test(text)) {
      // Try to find count
      let unitCount = 1;
      for (const mp of MULTI_PACK_PATTERNS) {
        const match = text.match(mp);
        if (match) {
          const count = parseInt(match[1] || match[2], 10);
          if (count > 1 && count <= 200) {
            unitCount = count;
            break;
          }
        }
      }
      return { packageType: "variety_pack", unitCount, components: [] };
    }
  }

  // Check case
  for (const pattern of CASE_PATTERNS) {
    if (pattern.test(text)) {
      let unitCount = 1;
      for (const mp of MULTI_PACK_PATTERNS) {
        const match = text.match(mp);
        if (match) {
          const count = parseInt(match[1] || match[2], 10);
          if (count > 1 && count <= 500) {
            unitCount = count;
            break;
          }
        }
      }
      if (unitCount > 1) {
        return { packageType: "case", unitCount, components: [] };
      }
    }
  }

  // Check multi-pack
  for (const pattern of MULTI_PACK_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1] || match[2], 10);
      if (count > 1 && count <= 200) {
        return { packageType: "multi_pack", unitCount: count, components: [] };
      }
    }
  }

  return { packageType: "single", unitCount: 1, components: [] };
}

// ─── Confidence Scoring ─────────────────────────────────────────────────────

function computeConfidence(result: ProviderResult, barcode: string): number {
  let score = 0.5; // base: found a result

  if (result.name && result.name.length > 3) score += 0.1;
  if (result.brand) score += 0.1;
  if (result.weightG && result.weightG > 0) score += 0.1;
  if (result.priceCents && result.priceCents > 0) score += 0.05;
  if (result.allergens && result.allergens.length > 0) score += 0.05;
  if (result.category && result.category !== "Uncategorized") score += 0.05;
  if (result.description && result.description.length > 10) score += 0.05;

  return Math.min(score, 1.0);
}

// ─── Weight Estimation ──────────────────────────────────────────────────────

// Category-based average weights (grams) for common pantry items
const CATEGORY_WEIGHT_ESTIMATES: Record<string, number> = {
  "beverages": 355,
  "cereals": 340,
  "snacks": 200,
  "canned": 400,
  "dairy": 450,
  "bread": 560,
  "pasta": 454,
  "rice": 907,
  "condiments": 340,
  "soups": 305,
  "frozen": 400,
  "baby food": 113,
};

function parseWeightFromText(text: string): number | null {
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*-?\s*(oz|lb|lbs|g|kg|ml|fl\s*oz)/i,
  );
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase().replace(/\s/g, "");
  if (unit === "g") return val;
  if (unit === "kg") return val * 1000;
  if (unit === "oz") return val * 28.3495;
  if (unit === "lb" || unit === "lbs") return val * 453.592;
  if (unit === "ml" || unit === "floz") return val * 29.5735; // approximate
  return null;
}

function estimateWeight(
  providerResult: ProviderResult,
  category: string,
): { weightG: number | null; isEstimated: boolean } {
  // If provider gave us weight, use it
  if (providerResult.weightG && providerResult.weightG > 0) {
    return { weightG: providerResult.weightG, isEstimated: false };
  }

  // Try to parse from product name (e.g. "Chester's BBQ Fries - 5.25oz")
  if (providerResult.name) {
    const g = parseWeightFromText(providerResult.name);
    if (g && g > 0) return { weightG: g, isEstimated: false };
  }

  // Try to parse from description
  if (providerResult.description) {
    const g = parseWeightFromText(providerResult.description);
    if (g && g > 0) return { weightG: g, isEstimated: false };
  }

  // Try category-based estimate
  const lowerCat = category.toLowerCase();
  for (const [key, weight] of Object.entries(CATEGORY_WEIGHT_ESTIMATES)) {
    if (lowerCat.includes(key)) {
      return { weightG: weight, isEstimated: true };
    }
  }

  return { weightG: null, isEstimated: false };
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

const CATEGORY_COST_ESTIMATES: Record<string, number> = {
  "beverages": 199,
  "cereals": 399,
  "snacks": 349,
  "canned": 149,
  "dairy": 399,
  "bread": 299,
  "pasta": 179,
  "rice": 299,
  "condiments": 299,
  "soups": 199,
  "frozen": 349,
  "baby food": 149,
};

function estimateCost(
  providerResult: ProviderResult,
  category: string,
): { costCents: number | null; isEstimated: boolean } {
  // If provider gave us price, use it
  if (providerResult.priceCents && providerResult.priceCents > 0) {
    return { costCents: providerResult.priceCents, isEstimated: false };
  }

  // Try category-based estimate
  const lowerCat = category.toLowerCase();
  for (const [key, cost] of Object.entries(CATEGORY_COST_ESTIMATES)) {
    if (lowerCat.includes(key)) {
      return { costCents: cost, isEstimated: true };
    }
  }

  return { costCents: null, isEstimated: false };
}

// ─── Best Result Selection ──────────────────────────────────────────────────

type ScoredResult = {
  provider: string;
  result: ProviderResult;
  confidence: number;
};

function selectBest(scored: ScoredResult[]): ScoredResult | null {
  if (scored.length === 0) return null;
  // Sort by confidence descending, then by provider priority (name order from getProviders)
  return scored.sort((a, b) => b.confidence - a.confidence)[0];
}

// ─── Merge supplemental data from other providers ───────────────────────────

function mergeSupplemental(
  best: ProviderResult,
  others: ProviderResult[],
): ProviderResult {
  const merged = { ...best };

  for (const other of others) {
    if (!merged.brand && other.brand) merged.brand = other.brand;
    if (!merged.weightG && other.weightG) merged.weightG = other.weightG;
    if (!merged.priceCents && other.priceCents) merged.priceCents = other.priceCents;
    if ((!merged.allergens || merged.allergens.length === 0) && other.allergens?.length) {
      merged.allergens = other.allergens;
    }
    if (!merged.description && other.description) merged.description = other.description;
    if (merged.category === "Uncategorized" && other.category && other.category !== "Uncategorized") {
      merged.category = other.category;
    }
  }

  return merged;
}

// ─── Main Orchestration ─────────────────────────────────────────────────────

export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  // Check server-side cache first (no concurrency slot needed)
  const cached = getCachedResult(barcode);
  if (cached) {
    log(`Barcode ${barcode}: cache hit`, "barcode-lookup");
    return cached;
  }

  // Acquire concurrency slot — queues if too many lookups are active
  await acquireLookupSlot();
  try {
    return await _lookupBarcodeInternal(barcode);
  } finally {
    releaseLookupSlot();
  }
}

async function _lookupBarcodeInternal(barcode: string): Promise<LookupResult> {
  // Double-check cache (another request may have populated it while we waited)
  const cached = getCachedResult(barcode);
  if (cached) {
    log(`Barcode ${barcode}: cache hit (after queue)`, "barcode-lookup");
    return cached;
  }

  const providers = getProviders().filter((p) => p.enabled);
  const logs: LookupLog[] = [];
  const scored: ScoredResult[] = [];

  // Run all enabled providers in parallel with timeout + retry
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const result = await withRetry(
          () => withTimeout(provider.lookup(barcode), API_TIMEOUT_MS),
          1, // 1 retry
          300,
        );
        const latencyMs = Date.now() - start;
        if (result) {
          logs.push({ api: provider.name, status: "success", latencyMs });
          const confidence = computeConfidence(result, barcode);
          scored.push({ provider: provider.name, result, confidence });
          return result;
        }
        logs.push({ api: provider.name, status: "miss", latencyMs });
        return null;
      } catch (err) {
        const latencyMs = Date.now() - start;
        const error = err instanceof Error ? err.message : String(err);
        logs.push({ api: provider.name, status: "error", latencyMs, error });
        return null;
      }
    }),
  );

  // Select best result
  const best = selectBest(scored);
  if (!best) {
    log(
      `Barcode ${barcode}: no match (${logs.map((l) => `${l.api}:${l.status}/${l.latencyMs}ms`).join(", ")})`,
      "barcode-lookup",
    );
    const notFoundResult: LookupResult = { found: false, logs };
    // Cache not-found for shorter duration (1 hour) to allow retries later
    barcodeCache.set(barcode, { result: notFoundResult, cachedAt: Date.now() - (CACHE_TTL_MS - 60 * 60 * 1000) });
    return notFoundResult;
  }

  // Merge supplemental data from other providers
  const otherResults = scored
    .filter((s) => s.provider !== best.provider)
    .map((s) => s.result);
  const merged = mergeSupplemental(best.result, otherResults);

  // Detect package type
  const packInfo = detectPackInfo(merged.name, merged.description);

  // Estimate weight
  const category = merged.category || "Uncategorized";
  const weight = estimateWeight(merged, category);

  // Compute unit weight
  let unitWeightG: number | null = null;
  if (weight.weightG && packInfo.unitCount > 1) {
    unitWeightG = weight.weightG / packInfo.unitCount;
  } else if (weight.weightG) {
    unitWeightG = weight.weightG;
  }

  // Convert to lbs for legacy field
  const weightLbs = weight.weightG ? weight.weightG / 453.592 : 0;

  // Estimate cost
  const cost = estimateCost(merged, category);

  // Convert cost to dollars for legacy field
  const valueUsd = cost.costCents ? cost.costCents / 100 : 0;

  // Build normalized product
  const product: NormalizedProduct = {
    name: merged.name,
    brand: merged.brand || null,
    category,
    barcode,

    packageType: packInfo.packageType,
    unitCount: packInfo.unitCount,
    packComponents: packInfo.components,

    netWeightG: weight.weightG,
    unitWeightG,
    weightIsEstimated: weight.isEstimated,
    weightPerUnitLbs: Math.round(weightLbs * 10000) / 10000,

    costCents: cost.costCents,
    costIsEstimated: cost.isEstimated,
    currency: merged.currency || "USD",
    valuePerUnitUsd: Math.round(valueUsd * 100) / 100,

    allergens: merged.allergens || [],

    dataSourcesTried: logs.map((l) => ({
      api: l.api,
      status: l.status,
      latencyMs: l.latencyMs,
      error: l.error,
    })),
    winningSource: best.provider,
    matchConfidence: best.confidence,
    rawPayload: merged.raw,
  };

  log(
    `Barcode ${barcode}: found via ${best.provider} (confidence: ${best.confidence.toFixed(2)}, ` +
    `pkg: ${packInfo.packageType}×${packInfo.unitCount}, ` +
    `weight: ${weight.weightG ?? "?"}g${weight.isEstimated ? " [est]" : ""}, ` +
    `cost: ${cost.costCents ?? "?"}¢${cost.isEstimated ? " [est]" : ""}) ` +
    `(${logs.map((l) => `${l.api}:${l.status}/${l.latencyMs}ms`).join(", ")})`,
    "barcode-lookup",
  );

  const finalResult: LookupResult = { found: true, product, logs };
  setCachedResult(barcode, finalResult);
  return finalResult;
}
