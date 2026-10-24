import { log } from "./app";
import { FOUND_TTL_MS, MISS_TTL_MS, clearBarcodeCache, getCachedResult, setCachedResult } from "./barcode/cache";
import { API_TIMEOUT_MS, withRetry, withTimeout } from "./barcode/http";
import { identityProblemFor } from "./barcode/identity";
import { buildNormalizedProduct, computeConfidence, mergeSupplemental, selectBest, type ScoredResult } from "./barcode/normalize";
import { STUB_PROVIDER, getProviders, providerReadiness } from "./barcode/registry";
import type { LookupLog, LookupResult } from "./barcode/types";

export { clearBarcodeCache, getProviders, providerReadiness, identityProblemFor };
export { computeConfidence, mergeSupplemental } from "./barcode/normalize";
export type {
  ApiProvider, LookupLog, LookupResult, NormalizedProduct, PackageType, ProviderResult,
} from "./barcode/types";

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

function releaseLookupSlot(): void {
  activeLookups--;
  const next = lookupQueue.shift();
  if (next) {
    activeLookups++;
    next.resolve();
  }
}

/**
 * Look one barcode up across every configured provider.
 *
 * The identity gate runs before any outside call, so a store-local code or a
 * misread number never reaches a product database. The local fixture stub is
 * exempt: its synthetic codes exist precisely so they cannot collide with a
 * real GTIN, and it makes no outside call to misdirect.
 */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  const providers = getProviders().filter((provider) => provider.enabled);
  const fixtureOnly = providers.length > 0 && providers.every((provider) => provider.name === STUB_PROVIDER);

  if (!fixtureOnly) {
    const identityProblem = identityProblemFor(barcode);
    if (identityProblem) {
      return {
        found: false,
        logs: [{ api: "gs1-identity", status: "miss", latencyMs: 0, error: identityProblem }],
        identityProblem,
      };
    }
  }

  const cached = getCachedResult(barcode);
  if (cached) {
    log(`Barcode ${barcode}: cache hit`, "barcode-lookup");
    return cached;
  }

  await acquireLookupSlot();
  try {
    return await runLookup(barcode);
  } finally {
    releaseLookupSlot();
  }
}

async function runLookup(barcode: string): Promise<LookupResult> {
  // Another request may have populated the cache while this one queued.
  const cached = getCachedResult(barcode);
  if (cached) {
    log(`Barcode ${barcode}: cache hit (after queue)`, "barcode-lookup");
    return cached;
  }

  const providers = getProviders().filter((provider) => provider.enabled);
  const logs: LookupLog[] = [];
  const scored: ScoredResult[] = [];

  await Promise.allSettled(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const result = await withRetry(
          () => withTimeout(provider.lookup(barcode), API_TIMEOUT_MS),
          1,
          300,
        );
        const latencyMs = Date.now() - start;
        if (!result) {
          logs.push({ api: provider.name, status: "miss", latencyMs });
          return;
        }
        const confidence = computeConfidence(result);
        if (confidence === 0) {
          // The provider answered about a different product.
          logs.push({
            api: provider.name,
            status: "miss",
            latencyMs,
            error: "response did not carry the scanned GTIN",
          });
          return;
        }
        logs.push({ api: provider.name, status: "success", latencyMs });
        scored.push({ provider: provider.name, priority: provider.priority, result, confidence });
      } catch (err) {
        logs.push({
          api: provider.name,
          status: "error",
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // An outage, a timeout or an exhausted rate limit leaves the question open.
  const inconclusive = logs.some((entry) => entry.status === "error");
  const summary = logs.map((entry) => `${entry.api}:${entry.status}/${entry.latencyMs}ms`).join(", ");

  const best = selectBest(scored);
  if (!best) {
    log(`Barcode ${barcode}: no match (${summary})`, "barcode-lookup");
    const notFound: LookupResult = { found: false, logs, ...(inconclusive ? { inconclusive: true } : {}) };
    // Only a complete round of answers, with at least one real miss and no
    // failure, is evidence worth remembering.
    if (!inconclusive && logs.some((entry) => entry.status === "miss")) {
      setCachedResult(barcode, notFound, MISS_TTL_MS);
    }
    return notFound;
  }

  const merged = mergeSupplemental(
    best.result,
    scored.filter((entry) => entry.provider !== best.provider).map((entry) => entry.result),
  );
  const product = buildNormalizedProduct({
    barcode,
    merged,
    winningSource: best.provider,
    matchConfidence: best.confidence,
    logs,
  });

  log(
    `Barcode ${barcode}: found via ${best.provider} (confidence ${best.confidence.toFixed(2)}, ` +
      `pkg ${product.packageType}x${product.unitCount}, ` +
      `weight ${product.netWeightG ?? "unknown"}g [${product.weightProvenance.basis}], ` +
      `price ${product.costCents ?? "unknown"} cents [${product.priceProvenance.source ?? "none"}]) (${summary})`,
    "barcode-lookup",
  );

  const found: LookupResult = { found: true, product, logs, ...(inconclusive ? { inconclusive: true } : {}) };
  // A found product is cached even when another provider failed: the record we
  // have is real, and the failure only means it could have been enriched more.
  setCachedResult(barcode, found, FOUND_TTL_MS);
  return found;
}
