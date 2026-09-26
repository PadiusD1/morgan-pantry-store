/**
 * The most units one line of a check in or check out may carry. A barcode
 * typed into a quantity field by a slow scanner is far above it.
 */
export const MAX_LINE_QUANTITY = 10000;

export const LINE_QUANTITY_LIMIT_MESSAGE = `A single line can hold at most ${MAX_LINE_QUANTITY} units.`;

export function isOverLineLimit(quantity: number): boolean {
  return quantity > MAX_LINE_QUANTITY;
}

/** The first line whose quantity is above the limit, if any. */
export function findOverLimitLine<T extends { quantity: number }>(lines: readonly T[]): T | undefined {
  return lines.find((line) => isOverLineLimit(line.quantity));
}
