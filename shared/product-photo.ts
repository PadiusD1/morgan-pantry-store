/** Product photos only. Never expose the provider's entire raw payload publicly. */
export const PRODUCT_IMAGE_HOSTS = ["images.openfoodfacts.org", "images.openbeautyfacts.org", "images.openpetfoodfacts.org"] as const;
/** An uploaded photo counts only in this exact form. PgStorage.getInventoryItems applies the same rule in SQL. */
export const MAX_UPLOAD_DATA_URL_LENGTH = 250_000;
export const UPLOAD_DATA_URL_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const UPLOAD_DATA_URL_SQL_PATTERN = "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$";
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
  if (typeof upload.dataUrl === "string" && UPLOAD_DATA_URL_PATTERN.test(upload.dataUrl) && upload.dataUrl.length <= MAX_UPLOAD_DATA_URL_LENGTH) return { kind: "upload", dataUrl: upload.dataUrl };
  const product = record(raw.product);
  const item = record(raw.item);
  for (const candidate of [raw.frcProductImage, product.image_front_url, product.image_url, item.images?.[0]]) {
    const url = safeProductImageUrl(candidate);
    if (url) return { kind: "remote", url };
  }
  return null;
}
/** A list row has no photo bytes, so it carries hasUploadedPhoto from the database instead. */
type PhotoItem = { id: string; updatedAt?: Date | string; rawPayload?: unknown; hasUploadedPhoto?: boolean };
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(36);
};
/**
 * Students see these photos on the request page while they take stock, and every
 * take changes the item's updatedAt. Versioning by the photo itself keeps the URL
 * stable across stock changes so browsers and the CDN keep serving the cached copy.
 * An upload is versioned by its review time, a provider image by its URL.
 */
export function productPhotoVersion(item: Omit<PhotoItem, "id">): string | null {
  const upload = record(record(item.rawPayload).frcPhoto);
  if (item.hasUploadedPhoto === true || productPhotoSource(item.rawPayload)?.kind === "upload") {
    return typeof upload.reviewedAt === "string" && upload.reviewedAt ? `u${fnv1a(upload.reviewedAt)}` : `t${fnv1a(item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt ?? ""))}`;
  }
  const source = productPhotoSource(item.rawPayload);
  return source?.kind === "remote" ? `r${fnv1a(source.url)}` : null;
}
export function productPhotoPath(item: PhotoItem): string | null {
  const version = productPhotoVersion(item);
  return version ? `/api/public/inventory/${encodeURIComponent(item.id)}/photo?v=${version}` : null;
}

/** Staff lists use the same-origin URL; do not repeat every uploaded image's bytes. */
export function inventoryPhotoMetadata<T extends PhotoItem>(item: T) {
  const raw = record(item.rawPayload); const photo = record(raw.frcPhoto);
  const { dataUrl: _bytes, ...metadata } = photo;
  const { hasUploadedPhoto: _flag, ...row } = item;
  return { ...row, imageUrl: productPhotoPath(item), rawPayload: raw.frcPhoto ? { ...raw, frcPhoto: metadata } : item.rawPayload };
}
