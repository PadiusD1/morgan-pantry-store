import { isEarlierSaveRecorded, saveErrorMessage } from "./queryClient";
import { classifySaveError, itemActionFailureText } from "./item-action";
import { earlierSaveText, savedCheckInText } from "./saved-result";
import { serverMessage } from "./stock-change";

// The Inventory dialog and CSV import texts, per the shared design for writes
// whose outcome is unknown. Success text comes from the saved response.

export type SaveToast = { title: string; description: string; variant?: "destructive" };

/**
 * The toast of a failed dialog save, and whether the dialog closes. A retry
 * that read back an earlier recorded save says what was recorded and closes,
 * since the item and its stock exist. An uncertain outcome never has a title
 * saying it was not recorded, so the title never contradicts its own body.
 */
export function inventoryFailureToast(
  stage: "item" | "donor" | "stock",
  error: unknown,
  itemName: string,
  withStock = false,
): { toast: SaveToast; close: boolean } {
  if (isEarlierSaveRecorded(error)) {
    if (stage === "stock") {
      return { toast: { title: "Already recorded", description: earlierSaveText(error.recorded, "in") }, close: true };
    }
    // The read back proves only the item or the donor. The stock stage was not
    // reached in this try, so the starting quantity is never called recorded.
    if (!withStock) {
      return { toast: { title: "Already recorded", description: `An earlier try already saved ${itemName}. Your change was not saved.` }, close: true };
    }
    const what = stage === "item" ? itemName : "the new donor";
    return {
      toast: {
        title: stage === "item" ? "Item saved earlier" : "Donor saved earlier",
        description: `An earlier try already saved ${what} with other details. The starting quantity of ${itemName} may not be recorded. Check its quantity in the list before you add stock again.`,
        variant: "destructive",
      },
      close: true,
    };
  }
  const refusal = {
    item: `${itemName} was not saved. Please try again.`,
    donor: "The new donor was not saved. Please try again.",
    stock: "The starting quantity was not recorded. Please try again.",
  }[stage];
  const outcome = classifySaveError(error);
  const refusedTitle = stage === "item" ? "Not saved" : stage === "donor" ? "Donor not saved" : "Stock not recorded";
  const title = outcome === "refused" ? refusedTitle : outcome === "running" ? "Still saving" : "Save not confirmed";
  return {
    toast: { title, description: saveErrorMessage(error, itemActionFailureText(error, refusal)), variant: "destructive" },
    close: false,
  };
}

/** The toast of a confirmed dialog save, built from the saved transaction. */
export function inventorySuccessToast(itemName: string, saved: unknown, withStock: boolean, withLocation: boolean): SaveToast {
  return withStock
    ? { title: "Inventory added", description: `Saved ${itemName}. ${savedCheckInText(saved, withLocation)}` }
    : { title: "Inventory updated", description: `Saved ${itemName}.` };
}

/**
 * Puts a confirmed create in the cache once. The temporary row becomes the
 * created row, and an earlier row with the same id (a replayed create of a
 * retry) is dropped, so the list never holds the same id twice.
 */
export function upsertCreatedRow<T extends { id: string }>(old: T[] | undefined, tempId: string, created: T): T[] {
  const rows: T[] = [];
  let placed = false;
  for (const row of old ?? []) {
    if (row.id !== tempId && row.id !== created.id) {
      rows.push(row);
    } else if (!placed) {
      rows.push(created);
      placed = true;
    }
  }
  return placed ? rows : [...rows, created];
}

/** Keeps the last failure toast, so a later success dismisses it and shows one confirmation. */
export function failureToastSlot<P>(show: (props: P) => { dismiss: () => void }) {
  let failure: { dismiss: () => void } | null = null;
  return {
    fail(props: P) {
      failure?.dismiss();
      failure = show(props);
    },
    succeed(props: P) {
      failure?.dismiss();
      failure = null;
      show(props);
    },
  };
}

/** A CSV import failure line, with the server's message or a plain fallback, never raw JSON. */
export function importFailureText(row: number, err: unknown): string {
  const fallback = classifySaveError(err) === "refused"
    ? "Please check the row and try again."
    : "The save may already be recorded. Check the list before importing it again.";
  return `Row ${row} not saved. ${serverMessage(err) ?? fallback}`;
}
