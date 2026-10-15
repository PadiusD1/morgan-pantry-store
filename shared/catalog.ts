/** Catalog evidence is separate from immutable historical checkout snapshots. */
export type CatalogItem = {
  id: string; name: string; barcode?: string | null; quantity: number;
  weightPerUnitLbs: string | number; valuePerUnitUsd: string | number;
  rawPayload?: unknown; updatedAt: string | Date;
};
export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** No arbitrary tracking hosts, credentials, script URLs, SVG or query strings. */
export function safeCatalogImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  if (/^\/item-photos\/[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp)$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "images.openfoodfacts.org" && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/images\/products\/[a-zA-Z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}
export function catalogImage(raw: unknown): { imageUrl: string | null; imageAlt: string; imageSource: string | null } {
  const payload = objectValue(raw);
  const saved = objectValue(payload.frcCatalog);
  // An explicit empty URL is a staff removal, not permission to resurrect an old image.
  if (Object.prototype.hasOwnProperty.call(saved, "imageUrl")) {
    const imageUrl = safeCatalogImage(saved.imageUrl);
    return { imageUrl, imageAlt: typeof saved.imageAlt === "string" ? saved.imageAlt.slice(0, 250) : "", imageSource: imageUrl ? (imageUrl.startsWith("https://images.openfoodfacts.org/") ? "Open Food Facts" : "FRC") : null };
  }
  const product = objectValue(payload.product);
  const imageUrl = safeCatalogImage(product.image_front_url) ?? safeCatalogImage(product.image_url);
  return { imageUrl, imageAlt: "", imageSource: imageUrl ? "Open Food Facts" : null };
}
export function positiveMeasurement(value: unknown): boolean {
  return (typeof value === "number" || typeof value === "string") && Number.isFinite(Number(value)) && Number(value) > 0;
}
export function catalogGaps(item: CatalogItem): string[] {
  return [!positiveMeasurement(item.weightPerUnitLbs) ? "weight" : "", !positiveMeasurement(item.valuePerUnitUsd) ? "value" : "", !catalogImage(item.rawPayload).imageUrl ? "photo" : ""].filter(Boolean);
}
export function catalogQuality(items: readonly CatalogItem[]) {
  const rows = items.map(item => ({ id: item.id, name: item.name, barcode: item.barcode ?? null, quantity: item.quantity,
    weightPerUnitLbs: item.weightPerUnitLbs, valuePerUnitUsd: item.valuePerUnitUsd, updatedAt: item.updatedAt,
    ...catalogImage(item.rawPayload), gaps: catalogGaps(item) }));
  return { total: rows.length, missingWeight: rows.filter(r => r.gaps.includes("weight")).length,
    missingValue: rows.filter(r => r.gaps.includes("value")).length, missingPhoto: rows.filter(r => r.gaps.includes("photo")).length,
    rows: rows.filter(r => r.gaps.length).sort((a,b) => Number(b.quantity > 0) - Number(a.quantity > 0) || a.name.localeCompare(b.name)) };
}
