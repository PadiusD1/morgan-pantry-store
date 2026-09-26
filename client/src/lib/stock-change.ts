import { toApiInventoryBody } from "./api-types";
import type { InventoryItem } from "./repository";

/** An item save. expectedQuantity is the count an Edit was read from. */
export type ItemChange = Partial<InventoryItem> & { name: string; expectedQuantity?: number };
/** addQuantity adds the quantity to a matched item as an adjustment (CSV import). */
export type ItemChangeOptions = { addQuantity?: boolean; idempotencyKey?: string };

/**
 * What a save of an item that already exists sends (PLAN.md defect 4). A count
 * moves only as an Edit checked against the count it was read from, or as a
 * difference through the adjust route, never as a bare number.
 */
export function planItemChange(existingQuantity: number, partial: ItemChange, options?: ItemChangeOptions) {
  const { expectedQuantity, quantity: asked, ...fields } = partial;
  const setsCount = expectedQuantity !== undefined && asked !== undefined && asked !== expectedQuantity;
  const adds = !setsCount && options?.addQuantity && asked !== undefined && asked > 0 ? asked : 0;
  const body: Record<string, unknown> = toApiInventoryBody(fields);
  if (setsCount) Object.assign(body, { quantity: asked, expectedQuantity });
  const quantity = setsCount ? (asked as number) : existingQuantity + adds;
  return { fields, body, adds, quantity };
}

/** The message of a refusal, from apiRequest's "status: body" error. */
export function serverMessage(e: unknown): string | null {
  const text = e instanceof Error ? e.message : "";
  const body = text.replace(/^\d{3}: /, "");
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}
