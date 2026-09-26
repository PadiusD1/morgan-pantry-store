// Text a save shows is built from what the server stored, never from the form.

type SavedTransaction = {
  clientName?: string | null;
  items?: Array<{ quantity?: number | null }> | null;
};

function asSaved(recorded: unknown): SavedTransaction {
  return recorded && typeof recorded === "object" ? (recorded as SavedTransaction) : {};
}

/** The units the server recorded across the saved lines. */
export function recordedUnits(recorded: unknown): number {
  const items = asSaved(recorded).items ?? [];
  return items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
}

/** The success text of a check in, from the saved transaction. */
export function savedCheckInText(recorded: unknown, withLocation: boolean): string {
  return `Recorded ${recordedUnits(recorded)} units received${withLocation ? " with location" : ""}.`;
}

/** The person a saved check out names, else the name the page resolved. */
export function savedCheckOutName(recorded: unknown, fallback: string): string {
  return asSaved(recorded).clientName?.trim() || fallback;
}

/** What an earlier try recorded, when a retry with edited values was not saved. */
export function earlierSaveText(recorded: unknown, kind: "in" | "out"): string {
  const units = recordedUnits(recorded);
  const what =
    kind === "in"
      ? `${units} units received`
      : `a check out of ${units} units for ${savedCheckOutName(recorded, "this person")}`;
  return `An earlier try already recorded ${what}. Your change was not saved.`;
}
