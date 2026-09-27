import { finishKeptSave, isEarlierSaveRecorded } from "./queryClient";

/**
 * What an earlier try of a check in held at its item or donor stage recorded.
 * A stock means the earlier try sent its stock under the old key, and that
 * check in is now read back or recorded once. None means no stock body was
 * kept, so the stock was never sent and saving the saved item again records it
 * once.
 */
export type EarlierCheckIn = { kind: "stock"; recorded: unknown } | { kind: "none" };

/**
 * Settles a held 422 at the item or donor stage before the page renews its key.
 * The stock of an earlier try may already be recorded under the old key, so the
 * kept stock body is sent once more under that key. The server replays it, or
 * records it once if it never arrived. A lost answer here is thrown, so the page
 * keeps the old key and says the stock may already be recorded.
 */
export async function settleEarlierCheckIn(key: string): Promise<EarlierCheckIn> {
  try {
    const res = await finishKeptSave("POST", "/api/transactions", key);
    if (!res) return { kind: "none" };
    return { kind: "stock", recorded: await res.json().catch(() => null) };
  } catch (e) {
    if (isEarlierSaveRecorded(e)) return { kind: "stock", recorded: e.recorded };
    throw e;
  }
}
