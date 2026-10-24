import { describe, it, expect, vi } from 'vitest';
import { packageMassGrams, measurementProposal } from '@shared/item-measurements';
import { relationshipReport, relationshipCsv } from '@shared/relationship-report';
import { buildBoardReport, type ReportTransaction } from '@shared/reporting';
import { safeProductImageUrl, productPhotoSource, productPhotoPath } from '@shared/product-photo';
import { unregisteredDonors } from '@shared/unregistered-donors';

const line = { itemId: 'i', name: 'Synthetic rice', quantity: 3, weightPerUnitLbs: 1.5, valuePerUnitUsd: 2.35 };
const tx: ReportTransaction & { donorId?: string } = { id: 't', type: 'IN', timestamp: '2026-09-30T18:00:00Z', donor: 'Synthetic farm', items: [line] };
const range = { from: '2026-09-01', to: '2026-09-30' };
const donor = { id: 'd', name: 'Synthetic farm', createdAt: '2020-01-01', status: 'active' };
describe('measurements preserve units and provenance', () => {
  it.each([['Rice 16 oz', 453.59237], ['Beans 400g', 400], ['Flour 1 kg', 1000], ['Oats 2 lb', 907.18474]])('parses net mass %s', (name, expected) => expect(packageMassGrams(name as string)).toBeCloseTo(expected as number, 5));
  it.each(['Milk 32 fl oz', 'Oil 500ml', 'Serving 100g', '6 x 4oz', '12 pack 8oz', '1/2 lb', 'Rice 16oz (454g)', 'unknown', 'Rice 0oz'])('holds ambiguous or missing mass %s', name => expect(packageMassGrams(name)).toBeNull());
  it('suggests stored price only and never a fabricated category retail price', () => {
    const result = measurementProposal({ name: 'Rice 16oz', weightPerUnitLbs: 0, valuePerUnitUsd: 0 });
    expect(result.weightLbs).toBe(1); expect(result.valueUsd).toBeNull();
    expect(measurementProposal({ name: 'Rice 16oz', packageType: 'case', unitCount: 12, weightPerUnitLbs: 0, valuePerUnitUsd: 0 }).weightLbs).toBeNull();
  });
  it('does not propose replacing known measurements', () => {
    expect(measurementProposal({ name: 'Rice 16oz', weightPerUnitLbs: 2, valuePerUnitUsd: 3, costCents: 400 })).toMatchObject({ missingWeight: false, missingValue: false, weightLbs: null, valueUsd: null });
  });
});
describe('independent relationship reporting', () => {
  it('keeps zero-activity new additions and ignores outside-period rows', () => {
    const rows = relationshipReport('donor', [donor,{ id: 'new', name: 'New synthetic donor' }], [tx,{...tx,timestamp:'2026-10-02T18:00:00Z'}], range);
    expect(rows).toHaveLength(2); expect(rows[0].received.units).toBe(3); expect(rows[1].received.entries).toBe(0);
  });
  it('uses the complete directory for deterministic legacy matches even with a search', () => {
    const later = { ...donor, id: 'later', createdAt: '2026-01-01' };
    expect(relationshipReport('donor', [later], [tx], range, [donor,later])[0].received.entries).toBe(0);
  });
  it('separates donor and partner links, and partner IN from OUT', () => {
    expect(relationshipReport('donor', [donor], [{...tx, clientId:'d'}],range)[0].received.entries).toBe(0);
    const row = relationshipReport('partner', [donor], [{...tx, clientId:'d'}, {...tx, clientId:'d', type:'OUT'}, {...tx, clientId:'d', donorId:'x'}],range)[0];
    expect(row.received.units).toBe(3); expect(row.distributed.units).toBe(3);
  });
  it('retains missing measurement counts and CSV escapes names', () => {
    const missing = {...tx,donorId:'d',items:[{...line,weightPerUnitLbs:0,valuePerUnitUsd:0}]};
    const row = relationshipReport('donor', [donor], [missing],range)[0];
    expect(row.received).toMatchObject({unvaluedUnits:3,unweighedUnits:3,valueCents:0});
    expect(relationshipCsv('donor', [{...donor,name:'=FORMULA'}], [missing], range)).toContain("'=FORMULA");
  });
});
describe('product photo safety', () => {
  it.each(['http://images.openfoodfacts.org/a.jpg','https://images.openfoodfacts.org.evil.test/a.jpg','https://user@images.openfoodfacts.org/a.jpg','https://127.0.0.1/a.jpg','data:image/svg+xml,<svg>','javascript:alert(1)'])('rejects unsafe remote URL %s', url => expect(safeProductImageUrl(url)).toBeNull());
  it('exposes only a same-origin photo route, not provider payload', () => {
    const rawPayload = { product:{image_url:'https://images.openfoodfacts.org/images/test.jpg'}, privateNote:'not public' };
    expect(productPhotoSource(rawPayload)).toEqual({kind:'remote',url:rawPayload.product.image_url});
    expect(productPhotoPath({id:'abc',rawPayload})).toBe('/api/public/inventory/abc/photo?v=');
  });
});
describe('legacy donor review', () => {
  it('finds legacy donor names for explicit review only, not known partners or anonymous donors', () => {
    expect(unregisteredDonors([tx,{...tx,donor:'  SYNTHETIC FARM '},{...tx,donor:'anonymous'},{...tx,donor:'Partner',clientId:'p'},{...tx,donor:'Known'}],[{name:'Known'}])).toEqual([{name:'Synthetic farm',entries:2}]);
  });
});
