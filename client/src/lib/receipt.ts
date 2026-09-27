// A check out receipt is built from what the server saved, never from the cart,
// so it can never show something that was not recorded.

export type ReceiptData = {
  clientName: string;
  clientIdentifier: string;
  items: { name: string; quantity: number }[];
  timestamp: string;
};

type SavedCheckOut = {
  clientId?: string | null;
  clientName?: string | null;
  timestamp?: string | null;
  items?: Array<{ name?: string | null; quantity?: number | null }> | null;
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
  if (!Array.isArray(tx.items) || tx.items.length === 0) return null;
  const person = tx.clientId ? people.find((p) => p.id === tx.clientId) : undefined;
  return {
    clientName: tx.clientName?.trim() ?? "",
    clientIdentifier: person?.identifier ?? "",
    items: tx.items.map((line) => ({ name: String(line?.name ?? ""), quantity: Number(line?.quantity) || 0 })),
    timestamp: tx.timestamp ? String(tx.timestamp) : fallbackTimestamp,
  };
}

type SavedFulfilment = {
  clientName?: string | null;
  clientIdentifier?: string | null;
  fulfilledAt?: string | null;
  items?: Array<{ itemName?: string | null; fulfilledQuantity?: number | null }> | null;
  transaction?: { timestamp?: string | null } | null;
};

/**
 * The receipt for a fulfilled request, from the saved request the server
 * returned. Only lines with a fulfilled quantity above zero were given out.
 * Returns null when nothing fulfilled was saved.
 */
export function receiptFromFulfilled(saved: unknown, fallbackTimestamp: string): ReceiptData | null {
  if (!saved || typeof saved !== "object") return null;
  const request = saved as SavedFulfilment;
  const items = (Array.isArray(request.items) ? request.items : [])
    .map((line) => ({ name: String(line?.itemName ?? ""), quantity: Number(line?.fulfilledQuantity) || 0 }))
    .filter((line) => line.quantity > 0);
  if (items.length === 0) return null;
  const time = request.transaction?.timestamp ?? request.fulfilledAt;
  return {
    clientName: request.clientName?.trim() ?? "",
    clientIdentifier: request.clientIdentifier ?? "",
    items,
    timestamp: time ? String(time) : fallbackTimestamp,
  };
}
