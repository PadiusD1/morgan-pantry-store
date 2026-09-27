import { itemActionFailureText } from "./item-action";
import { isEarlierSaveRecorded, saveErrorMessage } from "./queryClient";

/**
 * The manual new item on the check out page. The create is sent under one key
 * derived from the add action key, the same suffix the check in page uses, so
 * a retry of the same item replays the item the server already saved and
 * never creates a second one. The item goes into the cart only after the
 * server answered with its canonical id.
 */

/** The Idempotency-Key of the item create for one add action key. */
export function manualItemKey(actionKey: string): string {
  return `${actionKey}.item`;
}

export type ManualItemSteps = {
  /** Sends the create under the given key and resolves the canonical id once the server answered. */
  saveItem: (idempotencyKey: string) => Promise<string>;
  /** Adds the confirmed item to the cart. */
  addToCart: (itemId: string) => void;
};

export type ManualItemResult =
  | { ok: true; itemId: string }
  | { ok: false; renew: boolean; closeForm: boolean; text: string };

const REFUSAL = "The new item was not saved. Please try again.";

function recordedName(recorded: unknown): string | undefined {
  const name = (recorded as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export async function addManualItem(actionKey: string, steps: ManualItemSteps): Promise<ManualItemResult> {
  let itemId: string;
  try {
    itemId = await steps.saveItem(manualItemKey(actionKey));
  } catch (err) {
    if (isEarlierSaveRecorded(err)) {
      // An earlier try under this key saved the item with other details. It
      // exists now, so the action is over. A new key would create a second
      // item, and the saved one may differ from the form, so it is not put in
      // the cart. Staff pick it from the list.
      const name = recordedName(err.recorded);
      const what = name ? `this item as ${name}` : "this item with other details";
      return {
        ok: false,
        renew: true,
        closeForm: true,
        text: `An earlier try already saved ${what}. It was not added to the cart. Pick it from the list to add it.`,
      };
    }
    // A known refusal shows the server's message, the held 409 asks to wait,
    // and a lost response or a 5xx says the save may already be recorded. The
    // form and the key are kept so the retry replays the same create.
    return { ok: false, renew: false, closeForm: false, text: saveErrorMessage(err, itemActionFailureText(err, REFUSAL)) };
  }
  if (!itemId) {
    return { ok: false, renew: false, closeForm: false, text: itemActionFailureText(new Error("lost"), REFUSAL) };
  }
  steps.addToCart(itemId);
  return { ok: true, itemId };
}
