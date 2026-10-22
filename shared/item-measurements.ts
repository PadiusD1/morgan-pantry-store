/**
 * Parse one unambiguous net MASS, not a serving size, fluid volume or multi-pack.
 *
 * A number is only read when it is a whole token. "2,5 kg" is two and a half
 * kilograms where a comma is the decimal separator, and matching the "5 kg" out
 * of the middle of it recorded five kilograms, double the truth. Rather than
 * guess which convention a label follows, a digit sitting next to a comma makes
 * the whole text unreadable and the mass stays unknown.
 */
export function packageMassGrams(text: string): number | null {
  if (/\b(?:ml|liters?|litres?|fluid|fl\.?\s*oz|servings?|packs?|cases?)\b|\d\s*[x×/]\s*\d/i.test(text)) return null;
  // A grouped or comma-decimal number, in either convention, is not readable.
  if (/\d\s*,\s*\d/.test(text)) return null;
  const matches = [...text.matchAll(/(?:^|[^\w.,])(\d+(?:\.\d+)?)\s*-?\s*(kilograms?|kg|grams?|g|pounds?|lbs?|ounces?|oz)\b/gi)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0][1]); const unit = matches[0][2].toLowerCase();
  const factor = /^(kg|kilogram)/.test(unit) ? 1000 : /^(g|gram)/.test(unit) ? 1 : /^(lb|pound)/.test(unit) ? 453.59237 : 28.349523125;
  const grams = value * factor;
  return Number.isFinite(grams) && grams > 0 && grams <= 100_000 ? grams : null;
}
export type MeasurementItem = { name: string; packageType?: string | null; unitCount?: number | null; weightPerUnitLbs: unknown; valuePerUnitUsd: unknown; costCents?: number | null; costIsEstimated?: boolean | null; weightIsEstimated?: boolean | null };
export function measurementProposal(item: MeasurementItem) {
  const missingWeight = !(Number(item.weightPerUnitLbs) > 0); const missingValue = !(Number(item.valuePerUnitUsd) > 0);
  const grams = (!item.packageType || item.packageType === 'single') && (!item.unitCount || item.unitCount === 1) ? packageMassGrams(item.name) : null;
  return { missingWeight, missingValue,
    weightLbs: missingWeight && grams ? Number((grams / 453.59237).toFixed(4)) : null,
    weightSource: grams ? 'Net mass printed in saved item name; verify that one inventory unit is this package.' : null,
    valueUsd: missingValue && item.costCents && item.costCents > 0 ? item.costCents / 100 : null,
    valueSource: item.costCents && item.costCents > 0 ? (item.costIsEstimated ? 'Previously stored estimated unit cost; not a current retail quote.' : 'Previously stored unit cost; verify that one inventory unit is this package.') : null,
  };
}
