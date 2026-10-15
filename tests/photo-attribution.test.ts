import { describe, expect, it } from 'vitest';
import { photoAttributionHtml } from '../shared/photo-attribution';

describe('public photo credits', () => {
  it('credits the actual allowlisted source and links its license and product page', () => {
    const page = photoAttributionHtml({ product: { image_front_url: 'https://images.openfoodfacts.org/images/products/123/456/789/0123/front_en.1.400.jpg' }, staffNote: 'PRIVATE EVIDENCE' });
    expect(page).toContain('Open Food Facts contributors');
    expect(page).toContain('https://world.openfoodfacts.org/product/1234567890123');
    expect(page).toContain('https://creativecommons.org/licenses/by-sa/3.0/');
    expect(page).toContain('Original image source');
    expect(page).not.toContain('PRIVATE EVIDENCE');
  });
  it('distinguishes staff photos without exposing identities or assigning them an external license', () => {
    const page = photoAttributionHtml({ frcPhoto: { dataUrl: 'data:image/png;base64,aGVsbG8=', reviewedBy: 'PRIVATE STAFF ID', description: 'PRIVATE DRAFT' } });
    expect(page).toContain('Staff-supplied');
    expect(page).not.toContain('PRIVATE');
    expect(page).not.toContain('aGVsbG8=');
    expect(page).not.toContain('rel="license');
  });
  it('does not render source pages for missing or non-allowlisted sources', () => {
    expect(photoAttributionHtml(null)).toBeNull();
    expect(photoAttributionHtml({ product: { image_url: 'https://evil.example/image.jpg' } })).toBeNull();
  });
  it('escapes attribute delimiters in an allowed source URL', () => {
    const page = photoAttributionHtml({ product: { image_url: 'https://images.openfoodfacts.org/images/products/123/front.jpg?a=1&b=2' } });
    expect(page).toContain('a=1&amp;b=2');
    expect(page).not.toContain('<script');
  });
  it('names the source project correctly for the other allowed product datasets', () => {
    expect(photoAttributionHtml({ product: { image_url: 'https://images.openbeautyfacts.org/images/products/12345678/front.jpg' } })).toContain('Open Beauty Facts contributors');
    expect(photoAttributionHtml({ product: { image_url: 'https://images.openpetfoodfacts.org/images/products/12345678/front.jpg' } })).toContain('Open Pet Food Facts contributors');
  });
});
