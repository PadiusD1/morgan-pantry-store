import { finishKeptSave, isEarlierSaveRecorded, type EarlierSaveRecordedError } from "./queryClient";

/**
 * What a check out held by an earlier try actually recorded. A visit means a
 * distribution is recorded under the old key and the page shows it. A person
 * means only the new person was saved and no visit was sent under that key,
 * so picking that person and saving again records the visit once.
 */
export type EarlierCheckOut = { kind: "visit"; recorded: unknown } | { kind: "person"; recorded: unknown };

function isPersonRecord(recorded: unknown): boolean {
  if (!recorded || typeof recorded !== "object") return false;
  const saved = recorded as { items?: unknown; name?: unknown };
  return !Array.isArray(saved.items) && typeof saved.name === "string" && saved.name.trim() !== "";
}

/**
 * Settles a held 422 before the page renews its key. When the person create was
 * held, the visit sent after it under the same key may already be recorded, so
 * the kept visit body is sent once more under the old key. The server replays
 * it, or records it once if it never arrived. A lost answer here is thrown, so
 * the page keeps the old key and says the save may already be recorded.
 */
export async function settleEarlierSave(err: EarlierSaveRecordedError, key: string): Promise<EarlierCheckOut> {
  if (!isPersonRecord(err.recorded)) return { kind: "visit", recorded: err.recorded };
  try {
    const res = await finishKeptSave("POST", "/api/transactions", key);
    if (!res) return { kind: "person", recorded: err.recorded };
    return { kind: "visit", recorded: await res.json().catch(() => null) };
  } catch (e) {
    if (isEarlierSaveRecorded(e)) return { kind: "visit", recorded: e.recorded };
    throw e;
  }
}
