import { serverMessage } from "./stock-change";

/**
 * One logical item action (a new item, an inline new donor and its stock) run
 * as a whole. Each component write keeps one key derived from the action key,
 * so a retry of the same action reuses every key and the server replays what
 * it already saved. The stock is posted only after the item and donor answer,
 * with the canonical ids from their responses, never a temporary id.
 */

export type RequestFn = (
  method: string,
  url: string,
  data?: unknown,
  options?: { idempotencyKey?: string },
) => Promise<Response>;

export type ComponentKeys = { item: string; donor: string; stock: string };

/** The stable key of each component write for one action key. */
export function componentKeys(actionKey: string): ComponentKeys {
  return { item: `${actionKey}.item`, donor: `${actionKey}:donor`, stock: `${actionKey}.stock` };
}

export type ItemAction = {
  /** Body of a new item, or absent when the item already exists. */
  newItem?: unknown;
  /** Id of an existing item, used when there is no new item. */
  itemId?: string;
  /** Name of a donor typed inline, created or found on the server. */
  newDonorName?: string;
  /** Builds the stock write from the canonical ids, or null when there is no stock to post. */
  stock?: (ids: { itemId: string; donorId?: string; donorName?: string }) => { url: string; body: unknown } | null;
};

export type ItemActionResult = { itemId: string; donorId?: string; donorName?: string; stock?: unknown };

async function json(res: Response): Promise<any> {
  return res.json();
}

/**
 * Runs the whole action. The item and donor writes run together and both are
 * awaited before anything else, so a failure never leaves one of them still in
 * flight. The first failure is thrown and the stock is not posted.
 */
export async function runItemAction(
  request: RequestFn,
  actionKey: string,
  action: ItemAction,
): Promise<ItemActionResult> {
  const keys = componentKeys(actionKey);
  const itemWrite = action.newItem !== undefined
    ? request("POST", "/api/inventory", action.newItem, { idempotencyKey: keys.item }).then(json)
    : Promise.resolve(action.itemId ? { id: action.itemId } : null);
  const donorName = action.newDonorName?.trim();
  const donorWrite = donorName
    ? request("POST", "/api/donors", { name: donorName, status: "active" }, { idempotencyKey: keys.donor }).then(json)
    : Promise.resolve(undefined);

  const [itemResult, donorResult] = await Promise.allSettled([itemWrite, donorWrite]);
  if (itemResult.status === "rejected") throw asError(itemResult.reason);
  if (donorResult.status === "rejected") throw asError(donorResult.reason);
  const item = itemResult.value;
  if (!item?.id) throw new Error("The item was not found. Nothing was recorded.");
  const donor = donorResult.value as { id?: string; name?: string } | undefined;

  const result: ItemActionResult = { itemId: String(item.id), donorId: donor?.id, donorName: donor?.name };
  const stock = action.stock?.({ itemId: result.itemId, donorId: result.donorId, donorName: result.donorName });
  if (stock) {
    const res = await request("POST", stock.url, stock.body, { idempotencyKey: keys.stock });
    result.stock = await json(res);
  }
  return result;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export type SaveOutcome = "refused" | "uncertain" | "running";

/**
 * Sorts a failed write per the shared design. A 4xx other than the held 409
 * and 422 is a known refusal the server rolled back. The held 409 means the
 * first try is still running. Anything else, a 5xx, a held 422, a lost response or a timeout, is
 * uncertain and the save may already be recorded.
 */
export function classifySaveError(err: unknown): SaveOutcome {
  const message = err instanceof Error ? err.message : "";
  const status = Number(/^(\d{3}):/.exec(message)?.[1]);
  // Only the held 409 means the first try is still running. Another 409, a
  // stale count for example, is a refusal the server rolled back.
  if (status === 409 && /still being saved/i.test(message)) return "running";
  if (status >= 400 && status < 500 && status !== 422) return "refused";
  return "uncertain";
}

/** Short plain text for a failed item action, per the shared design. A known refusal shows the server's message. */
export function itemActionFailureText(err: unknown, refusal: string): string {
  const outcome = classifySaveError(err);
  if (outcome === "running") return "The first try is still saving. Please wait a moment, then check the list.";
  if (outcome === "refused") return serverMessage(err) ?? refusal;
  return "The save may already be recorded. Check the list before saving again, the same entries are kept.";
}

/**
 * Keeps a temporary item id mapped to its create until the whole action ends,
 * success included, so a handler still holding the temporary id resolves the
 * canonical id after the create has finished. Only a failed create is dropped.
 */
export function trackCreate(
  pending: Map<string, Promise<string>>,
  tempId: string,
  create: Promise<string>,
): Promise<string> {
  pending.set(tempId, create);
  create.catch(() => {
    if (pending.get(tempId) === create) pending.delete(tempId);
  });
  return create;
}

export type ItemSaveSteps<P> = {
  /** Saves the item and resolves its canonical id once confirmed. */
  saveItem: () => Promise<string>;
  /** Picks or creates the donor, when a starting quantity is recorded. */
  pickDonor?: () => Promise<P>;
  /** Records the starting quantity against the canonical id. */
  recordStock?: (itemId: string, picked: P | undefined) => Promise<unknown>;
};

export type ItemSaveResult =
  | { ok: true; itemId: string }
  | { ok: false; stage: "item" | "donor" | "stock"; error: unknown };

/**
 * The Inventory dialog save. Each write is awaited in turn and the first
 * failure stops the rest, so the page shows Saved and closes only after the
 * item, the donor and the starting quantity are all confirmed.
 */
export async function runItemSave<P>(steps: ItemSaveSteps<P>): Promise<ItemSaveResult> {
  let itemId: string;
  try {
    itemId = await steps.saveItem();
  } catch (error) {
    return { ok: false, stage: "item", error };
  }
  if (!steps.recordStock) return { ok: true, itemId };
  let picked: P | undefined;
  if (steps.pickDonor) {
    try {
      picked = await steps.pickDonor();
    } catch (error) {
      return { ok: false, stage: "donor", error };
    }
  }
  try {
    await steps.recordStock(itemId, picked);
  } catch (error) {
    return { ok: false, stage: "stock", error };
  }
  return { ok: true, itemId };
}

export type CheckInSteps<P> = {
  /** Resolves the canonical id once the new item's create is confirmed, absent for an existing item. */
  saveItem?: () => Promise<string>;
  /** Id of an existing item, used when there is no new item. */
  itemId?: string;
  /** Picks or creates the donor. */
  pickDonor?: () => Promise<P>;
  /** Records the stock against the canonical id and resolves the saved response. */
  recordStock: (itemId: string, picked: P | undefined) => Promise<unknown>;
};

export type CheckInResult =
  | { ok: true; itemId: string; saved: unknown }
  | { ok: false; stage: "item" | "donor" | "stock"; error: unknown };

/**
 * The check in page action. The item and donor writes run together and both
 * are awaited before the stock, which is posted once against the canonical
 * id, so a donor answering after the item never loses the stock.
 */
export async function runCheckInAction<P>(steps: CheckInSteps<P>): Promise<CheckInResult> {
  const [itemResult, donorResult] = await Promise.allSettled([
    steps.saveItem ? steps.saveItem() : Promise.resolve(steps.itemId ?? ""),
    steps.pickDonor ? steps.pickDonor() : Promise.resolve(undefined),
  ]);
  if (itemResult.status === "rejected") return { ok: false, stage: "item", error: itemResult.reason };
  if (donorResult.status === "rejected") return { ok: false, stage: "donor", error: donorResult.reason };
  const itemId = itemResult.value;
  if (!itemId) return { ok: false, stage: "item", error: new Error("The item was not found. Nothing was recorded.") };
  try {
    const saved = await steps.recordStock(itemId, donorResult.value);
    return { ok: true, itemId, saved };
  } catch (error) {
    return { ok: false, stage: "stock", error };
  }
}

/**
 * The held 422 read back for the new item or the inline donor carries that
 * record, not a stock count, so the page names what the earlier try saved.
 */
export function earlierComponentText(stage: "item" | "donor"): string {
  const what = stage === "item" ? "the new item" : "the new donor";
  return `An earlier try already saved ${what} with other details. Your change was not saved. Check the list, then save again.`;
}

/** Saves one import row, and resolves only after the server confirmed it. */
export async function importRow<T>(
  counts: { created: number },
  save: () => Promise<T>,
): Promise<T> {
  const saved = await save();
  counts.created++;
  return saved;
}
