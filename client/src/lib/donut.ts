// Data shaping for the inventory by category donut on the dashboard.

export type DonutSlice = { name: string; value: number; percent: number };

export const DONUT_MAX_SLICES = 6;
export const DONUT_OTHER = "Other";
export const DONUT_UNCATEGORIZED = "Uncategorized";

// Sums quantity per category, drops zero and negative slices, keeps the
// largest ones and groups the tail into Other so no sliver needs a label.
// percent is a whole number share of the total for the legend.
export function donutSlices(
  items: ReadonlyArray<{ category?: string | null; quantity: number }>,
  maxSlices = DONUT_MAX_SLICES,
): DonutSlice[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty)) continue;
    const cat = item.category?.trim() || DONUT_UNCATEGORIZED;
    counts.set(cat, (counts.get(cat) ?? 0) + qty);
  }
  const otherOwn = Math.max(0, counts.get(DONUT_OTHER) ?? 0);
  counts.delete(DONUT_OTHER);
  const named = Array.from(counts, ([name, value]) => ({ name, value }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const limit = Math.max(1, maxSlices);
  const fits = named.length + (otherOwn > 0 ? 1 : 0) <= limit;
  const head = fits ? named : named.slice(0, limit - 1);
  const tail = fits ? 0 : named.slice(limit - 1).reduce((sum, s) => sum + s.value, 0);
  const other = otherOwn + tail;
  const slices = other > 0 ? [...head, { name: DONUT_OTHER, value: other }] : head;

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return slices.map((s) => ({ ...s, percent: total > 0 ? Math.round((s.value / total) * 100) : 0 }));
}
