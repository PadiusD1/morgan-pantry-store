import type { InventoryItem } from "./repository";

function searchable(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Keep equally named products separate; staff choose a specific saved row. */
export function suggestInventoryItems<T extends Pick<InventoryItem, "id" | "name" | "brand" | "barcode" | "category">>(
  items: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = searchable(query);
  if (!needle) return [];
  const words = needle.split(" ");
  const rank = (item: T) => {
    const name = searchable(item.name);
    return name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
  };
  return items
    .filter((item) => {
      const text = searchable([item.name, item.brand, item.barcode, item.category].filter(Boolean).join(" "));
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Selecting a match carries its saved identity and all editable details. */
export function itemEntryFields(item: InventoryItem) {
  return {
    id: item.id || undefined,
    name: item.name || "",
    brand: item.brand || "",
    category: item.category || "Uncategorized",
    barcode: item.barcode || "",
    quantity: item.quantity,
    weightPerUnitLbs: item.weightPerUnitLbs,
    valuePerUnitUsd: item.valuePerUnitUsd,
    reorderThreshold: item.reorderThreshold ?? undefined,
    allergens: [...(item.allergens || [])],
  };
}

/** An older lookup must not replace an item or details the person just chose. */
export function createItemLookupGuard() {
  let revision = 0;
  return {
    start() {
      const request = ++revision;
      return () => request === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}
