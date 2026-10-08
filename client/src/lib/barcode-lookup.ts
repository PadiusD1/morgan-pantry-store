import { apiRequest } from "./queryClient";
import type { ApiInventoryItem } from "./api-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LookupLog = {
  api: string;
  status: "success" | "miss" | "error";
  latencyMs: number;
  error?: string;
};

export type EnrichedProduct = {
  name: string;
  brand: string | null;
  category: string;
  barcode: string;

  packageType: string;
  unitCount: number;
  packComponents: { name: string; barcode?: string; quantity: number; weightG?: number }[];

  netWeightG: number | null;
  unitWeightG: number | null;
  weightIsEstimated: boolean;
  weightPerUnitLbs: number;

  costCents: number | null;
  costIsEstimated: boolean;
  currency: string;
  valuePerUnitUsd: number;

  allergens: string[];

  winningSource: string;
  matchConfidence: number;
};

export type BarcodeLookupResult =
  | {
      status: "exists";
      item: ApiInventoryItem;
      logs: LookupLog[];
    }
  | {
      status: "created";
      item: ApiInventoryItem;
      product: EnrichedProduct;
      logs: LookupLog[];
    }
  | {
      status: "not_found";
      barcode: string;
      logs: LookupLog[];
    };

// Dev-only logger — stripped from production builds via Vite's import.meta.env.DEV
const debugLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};
const debugError = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};

// ─── Lookup Function ─────────────────────────────────────────────────────────

export async function lookupBarcode(
  barcode: string,
): Promise<BarcodeLookupResult | { status: "debounced" }> {
  const trimmed = barcode.trim();
  if (!trimmed) {
    return { status: "not_found", barcode: trimmed, logs: [] };
  }

  // Each scan represents a unit. The pages serialize their scan queues, so a
  // quick second scan of the same product must not be discarded as a duplicate.
  const start = Date.now();
  debugLog(`[barcode-lookup] Looking up barcode: ${trimmed}`);

  try {
    const res = await apiRequest("GET", `/api/barcode-lookup/${encodeURIComponent(trimmed)}`);
    const data: BarcodeLookupResult = await res.json();
    const totalMs = Date.now() - start;

    // Log results
    debugLog(`[barcode-lookup] Result: ${data.status} (${totalMs}ms)`);
    if (data.logs) {
      for (const log of data.logs) {
        const prefix = log.status === "success" ? "+" : log.status === "error" ? "!" : "-";
        debugLog(
          `[barcode-lookup]   ${prefix} ${log.api}: ${log.status} (${log.latencyMs}ms)${log.error ? ` - ${log.error}` : ""}`,
        );
      }
    }

    // Log enrichment details for created items
    if (data.status === "created" && data.product) {
      const p = data.product;
      debugLog(
        `[barcode-lookup] Enrichment: source=${p.winningSource}, confidence=${p.matchConfidence.toFixed(2)}, ` +
        `pkg=${p.packageType}×${p.unitCount}, weight=${p.netWeightG ?? "?"}g${p.weightIsEstimated ? " [est]" : ""}, ` +
        `cost=${p.costCents ?? "?"}¢${p.costIsEstimated ? " [est]" : ""}`,
      );
    }

    return data;
  } catch (err) {
    const totalMs = Date.now() - start;
    debugError(`[barcode-lookup] Network error (${totalMs}ms):`, err);
    // An outage, expired session or rate limit is not a confirmed missing item.
    throw err;
  }
}
