// A check out receipt is built from what the server saved, never from the cart,
// so it can never show something that was not recorded.

export type ReceiptLine = { name: string; quantity: number; weightPerUnitLbs?: number; valuePerUnitUsd?: number };

// PostgreSQL numerics arrive as strings. Never use current inventory to price
// an earlier receipt, and never interpret absent/invalid measurements as known.
function recordedNumber(value: unknown): number | undefined {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function measurements(line: { weightPerUnitLbs?: unknown; valuePerUnitUsd?: unknown }): Partial<ReceiptLine> {
  const weight = recordedNumber(line.weightPerUnitLbs);
  const value = recordedNumber(line.valuePerUnitUsd);
  return { ...(weight === undefined ? {} : { weightPerUnitLbs: weight }), ...(value === undefined ? {} : { valuePerUnitUsd: value }) };
}
export function receiptTotals(receipt: Pick<ReceiptData, "items">) {
  return receipt.items.reduce((total, item) => {
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    const weight = recordedNumber(item.weightPerUnitLbs);
    const value = recordedNumber(item.valuePerUnitUsd);
    total.units += quantity;
    total.weightLbs += quantity * (weight ?? 0);
    total.valueCents += quantity * Math.round((value ?? 0) * 100);
    if (!(weight && weight > 0)) total.unweighedUnits += quantity;
    if (!(value && value > 0)) total.unvaluedUnits += quantity;
    return total;
  }, { units: 0, weightLbs: 0, valueCents: 0, unweighedUnits: 0, unvaluedUnits: 0 });
}

export type ReceiptData = {
  clientName: string;
  clientIdentifier: string;
  items: ReceiptLine[];
  timestamp: string;
  /** The event the server saved on this checkout, never the one on screen now. */
  eventName?: string;
};

type SavedCheckOut = {
  type?: string;
  clientId?: string | null;
  clientName?: string | null;
  eventName?: string | null;
  timestamp?: string | null;
  items?: Array<{ name?: string | null; quantity?: number | null; weightPerUnitLbs?: unknown; valuePerUnitUsd?: unknown }> | null;
};

/**
 * The receipt for a saved check out. `people` are known person records, used
 * only to show the ID of the person the server recorded. `fallbackTimestamp`
 * is used only when the saved result carries no time. Returns null when the
 * saved result is not a recorded check out with lines.
 */
export function receiptFromSaved(
  saved: unknown,
  people: ReadonlyArray<{ id: string; identifier?: string | null }>,
  fallbackTimestamp: string,
): ReceiptData | null {
  if (!saved || typeof saved !== "object") return null;
  const tx = saved as SavedCheckOut;
  if (tx.type && tx.type !== "OUT") return null;
  if (!Array.isArray(tx.items) || tx.items.length === 0) return null;
  const person = tx.clientId ? people.find((p) => p.id === tx.clientId) : undefined;
  return {
    clientName: tx.clientName?.trim() ?? "",
    clientIdentifier: person?.identifier ?? "",
    items: tx.items.map((line) => ({ name: String(line?.name ?? ""), quantity: Number(line?.quantity) || 0, ...measurements(line ?? {}) })),
    timestamp: tx.timestamp ? String(tx.timestamp) : fallbackTimestamp,
    ...(typeof tx.eventName === "string" && tx.eventName.trim() ? { eventName: tx.eventName.trim() } : {}),
  };
}

type SavedFulfilment = {
  clientName?: string | null;
  clientIdentifier?: string | null;
  fulfilledAt?: string | null;
  items?: Array<{ itemName?: string | null; fulfilledQuantity?: number | null }> | null;
  transaction?: SavedCheckOut | null;
};

/**
 * The receipt for a fulfilled request, from the saved request the server
 * returned. Only lines with a fulfilled quantity above zero were given out.
 * Returns null when nothing fulfilled was saved.
 */
export function receiptFromFulfilled(saved: unknown, fallbackTimestamp: string): ReceiptData | null {
  if (!saved || typeof saved !== "object") return null;
  const request = saved as SavedFulfilment;
  const transactionReceipt = receiptFromSaved(request.transaction, [], fallbackTimestamp);
  const items = transactionReceipt?.items ?? (Array.isArray(request.items) ? request.items : [])
    .map((line) => ({ name: String(line?.itemName ?? ""), quantity: Number(line?.fulfilledQuantity) || 0 }))
    .filter((line) => line.quantity > 0);
  if (items.length === 0) return null;
  const time = request.transaction?.timestamp ?? request.fulfilledAt;
  return {
    clientName: request.clientName?.trim() ?? "",
    clientIdentifier: request.clientIdentifier ?? "",
    items,
    timestamp: time ? String(time) : fallbackTimestamp,
    ...(transactionReceipt?.eventName ? { eventName: transactionReceipt.eventName } : {}),
  };
}
