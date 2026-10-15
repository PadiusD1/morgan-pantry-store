/** Product photos only. Never expose the provider's entire raw payload publicly. */
export const PRODUCT_IMAGE_HOSTS = ["images.openfoodfacts.org", "images.openbeautyfacts.org", "images.openpetfoodfacts.org"] as const;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
export function safeProductImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !PRODUCT_IMAGE_HOSTS.includes(url.hostname as typeof PRODUCT_IMAGE_HOSTS[number])) return null;
    return url.href;
  } catch { return null; }
}
export function productPhotoSource(payload: unknown): { kind: "upload"; dataUrl: string } | { kind: "remote"; url: string } | null {
  const raw = record(payload);
  const upload = record(raw.frcPhoto);
  if (typeof upload.dataUrl === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(upload.dataUrl) && upload.dataUrl.length <= 250_000) return { kind: "upload", dataUrl: upload.dataUrl };
  const product = record(raw.product);
  const item = record(raw.item);
  for (const candidate of [raw.frcProductImage, product.image_front_url, product.image_url, item.images?.[0]]) {
    const url = safeProductImageUrl(candidate);
    if (url) return { kind: "remote", url };
  }
  return null;
}
export function productPhotoPath(item: { id: string; updatedAt?: Date | string; rawPayload?: unknown }): string | null {
  return productPhotoSource(item.rawPayload) ? `/api/public/inventory/${encodeURIComponent(item.id)}/photo?v=${encodeURIComponent(String(item.updatedAt ?? ""))}` : null;
}

/** Staff lists use the same-origin URL; do not repeat every uploaded image's bytes. */
export function inventoryPhotoMetadata<T extends { id: string; updatedAt?: Date | string; rawPayload?: unknown }>(item: T) {
  const raw = record(item.rawPayload); const photo = record(raw.frcPhoto);
  const { dataUrl: _bytes, ...metadata } = photo;
  return { ...item, imageUrl: productPhotoPath(item), rawPayload: raw.frcPhoto ? { ...raw, frcPhoto: metadata } : item.rawPayload };
}
