import { expect, it } from 'vitest';
import { nextReviewId, qualityMatches } from '../client/src/lib/quality-queue';
const a = { id: 'a', name: 'Protein pancake waffle mix', missingWeight: true, missingValue: true, imageUrl: null };
const b = { ...a, id: 'b', name: 'Next package' };
it('advances only after the current filter is resolved', () => {
  expect(nextReviewId([a, b], [{ ...a, missingWeight: false }, b], 'a', 'incomplete', '')).toBe('a');
  expect(nextReviewId([a, b], [{ ...a, missingWeight: false, missingValue: false }, b], 'a', 'incomplete', '')).toBe('b');
  expect(nextReviewId([a, b], [{ ...a, imageUrl: '/photo' }, b], 'a', 'photo', '')).toBe('b');
});
it('matches each word and never advances outside the active search', () => {
  expect(qualityMatches(a, 'incomplete', 'waffle protein')).toBe(true);
  expect(nextReviewId([a, b], [{ ...a, missingWeight: false, missingValue: false }, b], 'a', 'incomplete', 'protein')).toBe('a');
});
