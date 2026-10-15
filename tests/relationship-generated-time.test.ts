import { expect, it } from 'vitest';
import { relationshipCsv } from '../shared/relationship-report';

it.each(['donor', 'partner'] as const)('timestamps a %s export in Baltimore and UTC without changing its period', (kind) => {
  const records = [{ id: 'synthetic-directory-row', name: 'Synthetic zero-activity record', status: 'active' }];
  const csv = relationshipCsv(kind, records, [], { from: '2026-06-01', to: '2026-09-30' }, records, new Date('2026-10-01T00:30:00.000Z'));
  expect(csv).toContain('Generated at (Baltimore)');
  expect(csv).toContain('Sep 30, 2026');
  expect(csv).toContain('8:30:00 PM EDT');
  expect(csv).toContain('Generated at (UTC),2026-10-01T00:30:00.000Z');
  expect(csv).toContain('Period,2026-06-01 to 2026-09-30');
  expect(csv).toContain('Synthetic zero-activity record');
});

it('rejects an invalid generation timestamp instead of exporting an unverifiable snapshot', () => {
  expect(() => relationshipCsv('donor', [], [], { from: '', to: '' }, [], new Date('invalid'))).toThrow('generation time');
});
