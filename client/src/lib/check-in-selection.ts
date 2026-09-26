// Item 10. A newly registered scanned item stays selected on the existing
// items list so a quantity can be set and checked in. Pure functions.

export type SelectableItem = { id: string; name: string; barcode?: string | null };

/**
 * The id the item picker should show. A manually registered item starts with
 * a temporary id that the server replaces, so the pinned item is followed to
 * its saved row by barcode, else by name.
 */
export function resolveSelectedId<T extends SelectableItem>(
  selectedId: string,
  inventory: readonly T[],
  pinned: SelectableItem | null,
): string {
  if (!selectedId || inventory.some((i) => i.id === selectedId)) return selectedId;
  if (!pinned || pinned.id !== selectedId) return selectedId;
  const code = (pinned.barcode ?? "").trim();
  const saved = code
    ? inventory.find((i) => (i.barcode ?? "").trim() === code)
    : inventory.find((i) => i.name.trim() === pinned.name.trim());
  return saved ? saved.id : selectedId;
}

/** The picker options, with the pinned item kept until the list holds it. */
export function itemOptions<T extends SelectableItem>(
  inventory: readonly T[],
  pinned: T | null,
  selectedId: string,
): T[] {
  if (!pinned || pinned.id !== selectedId || inventory.some((i) => i.id === pinned.id)) return [...inventory];
  return [...inventory, pinned];
}

/**
 * The Select reports an empty value when its value is missing from the
 * options for a moment. No real choice is empty, so the pick is kept.
 */
export function nextSelectedId(current: string, incoming: string): string {
  return incoming === "" ? current : incoming;
}
