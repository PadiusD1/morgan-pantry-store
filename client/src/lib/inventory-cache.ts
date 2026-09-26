// Recording stock needs the item from the live query cache. A quiet return
// when it is missing let the Inventory page report a check in that was never
// sent, so a missing item is an error the caller shows.

export const ITEM_NOT_LOADED = "This item is not loaded yet, so nothing was recorded. Try again.";

export function findCachedItem<T extends { id: string }>(list: readonly T[] | undefined, itemId: string): T {
  const item = (list ?? []).find((i) => i.id === itemId);
  if (!item) throw new Error(ITEM_NOT_LOADED);
  return item;
}
