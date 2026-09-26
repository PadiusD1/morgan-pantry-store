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
 * Sorts a failed write per the shared design. A 4xx other than 409 and 422 is
 * a known refusal the server rolled back. A 409 means the first try is still
 * running. Anything else, a 5xx, a held 422, a lost response or a timeout, is
 * uncertain and the save may already be recorded.
 */
export function classifySaveError(err: unknown): SaveOutcome {
  const status = Number(/^(\d{3}):/.exec(err instanceof Error ? err.message : "")?.[1]);
  if (status === 409) return "running";
  if (status >= 400 && status < 500 && status !== 422) return "refused";
  return "uncertain";
}

/** Short plain text for a failed item action, per the shared design. */
export function itemActionFailureText(err: unknown, refusal: string): string {
  const outcome = classifySaveError(err);
  if (outcome === "running") return "The first try is still saving. Please wait a moment, then check the list.";
  if (outcome === "refused") return refusal;
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
