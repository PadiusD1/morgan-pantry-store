import type { LookupResult } from "./types";

/**
 * Per-process memo of recent lookups.
 *
 * A no-match is only ever remembered when every enabled provider answered and
 * at least one said "miss". An outage, a timeout or an exhausted rate limit is
 * not evidence that the product does not exist, so those answers are not
 * cached and the next scan asks again.
 */
const entries = new Map<string, { result: LookupResult; expiresAt: number }>();

export const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
/** Short, so a newly listed product is found soon after it appears. */
export const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

export function getCachedResult(barcode: string): LookupResult | null {
  const entry = entries.get(barcode);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    entries.delete(barcode);
    return null;
  }
  return entry.result;
}

export function setCachedResult(barcode: string, result: LookupResult, ttlMs: number): void {
  entries.set(barcode, { result, expiresAt: Date.now() + ttlMs });
  if (entries.size > MAX_ENTRIES) {
    const closestToExpiry = [...entries.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, 1000);
    for (const [key] of closestToExpiry) entries.delete(key);
  }
}

/** Test seam: the cache is process state, so suites must be able to clear it. */
export function clearBarcodeCache(): void {
  entries.clear();
}
