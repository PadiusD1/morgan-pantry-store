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
