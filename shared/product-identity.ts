export type ProductIdentity = { name: string; brand?: string | null; category?: string | null; barcode?: string | null };

export function productSearchText(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/** The same word matching applies to staff entry, inventory and student pickup. */
export function matchesProduct(item: ProductIdentity, query: string): boolean {
  const words = productSearchText(query).split(' ').filter(Boolean);
  const text = productSearchText([item.name, item.brand, item.category, item.barcode].filter(Boolean).join(' '));
  return words.every(word => text.includes(word));
}

/** A plain-text identity for saved snapshots, print, exports and native options.
 * Inventory retains separate name/brand fields. Old snapshots are never rebuilt
 * from current inventory when they are read or reprinted. */
export function productLabel(item: Pick<ProductIdentity, 'name' | 'brand'>): string {
  const name = item.name.trim(), brand = item.brand?.trim();
  if (!brand) return name;
  const words = (value: string) => productSearchText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if ((` ${words(name)} `).includes(` ${words(brand)} `)) return name;
  return `${brand} — ${name}`;
}
