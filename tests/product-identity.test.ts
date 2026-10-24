import { expect, it } from 'vitest';
import { matchesProduct, productLabel } from '../shared/product-identity';

it('finds a saved brand alone or combined with name, without collapsing same-name items', () => {
  const a = { name:'Protein Pancake Mix', brand:'WonderSlim', category:'Breakfast' };
  const b = { ...a, brand:'Another Maker' };
  expect(matchesProduct(a, ' ＷＯＮＤＥＲＳＬＩＭ  pancake ')).toBe(true);
  expect(matchesProduct(b, 'WonderSlim pancake')).toBe(false);
  expect(matchesProduct(a, 'Breakfast wonderslim')).toBe(true);
});

it('keeps the brand in immutable plain-text labels without duplicating a named brand', () => {
  expect(productLabel({name:'Pancake Mix',brand:'WonderSlim'})).toBe('WonderSlim — Pancake Mix');
  expect(productLabel({name:'WonderSlim Pancake Mix',brand:'WonderSlim'})).toBe('WonderSlim Pancake Mix');
  expect(productLabel({name:'Honey Cereal',brand:'One'})).toBe('One — Honey Cereal');
  expect(productLabel({name:'Rice',brand:'   '})).toBe('Rice');
});
