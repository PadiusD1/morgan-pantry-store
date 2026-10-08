import type { PoolClient } from "pg";

type StockLine = { inventoryItemId: string; quantity: number };
export type StockReconciliation = {
  inventoryItemId: string;
  name: string;
  addedUnits: number;
};

export class TransactionInventoryError extends Error {
  readonly status = 409;
}

/**
 * Apply the stock movement inside the caller's transaction. Lock distinct
 * inventory IDs in a consistent order, including carts with repeated lines.
 * Existing pantry policy allows checkout when recorded stock is too low.
 * Record that count correction explicitly and preserve request reservations;
 * it is an adjustment, never an invented incoming donation.
 */
export async function applyTransactionStock(
  client: Pick<PoolClient, "query">,
  type: "IN" | "OUT",
  lines: StockLine[],
  context: { transactionId: string; userId: string | null },
): Promise<StockReconciliation[]> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    // PostgreSQL returns lowercase UUIDs even when a caller sent uppercase.
    const id = line.inventoryItemId.toLowerCase();
    totals.set(id, (totals.get(id) ?? 0) + line.quantity);
  }
  const ids = [...totals.keys()].sort();
  const { rows } = await client.query(
    `SELECT id, name, quantity, reserved_quantity FROM inventory_items
     WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  if (rows.length !== ids.length) {
    throw new TransactionInventoryError("An inventory item is no longer available. Refresh inventory and try again.");
  }

  const reconciliations: StockReconciliation[] = [];
  for (const item of rows) {
    const units = totals.get(item.id)!;
    let quantity = Number(item.quantity);
    if (type === "OUT") {
      const reserved = Math.max(0, Number(item.reserved_quantity));
      const correction = Math.max(0, units + reserved - quantity);
      if (correction > 0) {
        await client.query(
          `INSERT INTO stock_adjustments
             (inventory_item_id, delta, quantity_before, quantity_after, reason, user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.id, correction, quantity, quantity + correction,
            `checkout reconciliation for transaction ${context.transactionId}`, context.userId],
        );
        quantity += correction;
        reconciliations.push({ inventoryItemId: item.id, name: item.name, addedUnits: correction });
      }
    }
    await client.query(
      `UPDATE inventory_items SET quantity = $1, updated_at = now() WHERE id = $2`,
      [type === "IN" ? quantity + units : quantity - units, item.id],
    );
  }
  return reconciliations;
}
