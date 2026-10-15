import { productPhotoSource } from './product-photo';
const esc = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const providers: Record<string, { name: string; origin: string }> = {
  'images.openfoodfacts.org': { name: 'Open Food Facts', origin: 'https://world.openfoodfacts.org' },
  'images.openbeautyfacts.org': { name: 'Open Beauty Facts', origin: 'https://world.openbeautyfacts.org' },
  'images.openpetfoodfacts.org': { name: 'Open Pet Food Facts', origin: 'https://world.openpetfoodfacts.org' },
};
/** Public credits only. Never render uploader IDs, staff evidence or raw payloads. */
export function photoAttributionHtml(payload: unknown): string | null {
  const photo = productPhotoSource(payload);
  if (!photo) return null;
  let detail: string;
  if (photo.kind === 'upload') {
    detail = '<p>Staff-supplied product photograph for the Morgan State Food Resource Center.</p><p>No Creative Commons license is asserted for this upload. Do not reuse it without permission from its rights holder. The catalogue upload form resizes photographs and removes camera metadata before upload.</p>';
  } else {
    const url = new URL(photo.url);
    const provider = providers[url.hostname];
    if (!provider) return null;
    const barcode = url.pathname.replace(/^\/images\/products\//, '').split('/').slice(0, -1).join('');
    const source = /^\d{8,14}$/.test(barcode) ? `${provider.origin}/product/${barcode}` : provider.origin;
    detail = `<p>Photo credit: ${esc(provider.name)} contributors.</p><p><a href="${esc(source)}" rel="noreferrer">Source product and contributor details</a> · <a href="${esc(photo.url)}" rel="noreferrer">Original image source</a></p><p>License: <a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="license noreferrer">Creative Commons Attribution-ShareAlike 3.0</a> (CC BY-SA 3.0).</p><p>This application relays the source image without changing its bytes and fits it within the catalogue card. Source imagery may contain packaging artwork with separate rights. Attribution does not imply endorsement by the contributors or provider.</p>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Product photo source and license | Morgan FRC</title><style>body{font:1rem/1.6 system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:2rem 1rem}a{overflow-wrap:anywhere}h1{font-size:1.75rem}</style></head><body><main><p>Morgan State University · Food Resource Center</p><h1>Product photo source and license</h1>${detail}</main></body></html>`;
}
