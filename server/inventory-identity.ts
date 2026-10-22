/**
 * Serialising the creation of an inventory item that a barcode identifies.
 *
 * One trade item has several printed renderings. Reading an existing item now
 * compares all of them, but creating one did not: the unique index is on the
 * exact barcode text, so two scanners reading the same tin as UPC-A
 * 012345678905 and as EAN-13 0012345678905 both found nothing, both inserted,
 * and the pantry had one product in two rows with two separate stock counts.
 * No constraint can express "the same GTIN in any rendering", because the
 * renderings are different strings.
 *
 * So a create takes a transaction-scoped queue keyed on the canonical GTIN and
 * re-reads inside it. The queue is per code, so a scan of one product never
 * waits behind a scan of another. Every writer takes the destination barcode
 * queue before any inventory row lock, including edits of existing items.
 *
 * A code that is not a valid GTIN keeps its own queue under its exact text, so
 * a legacy identifier is serialised against itself and never merged into a GTIN.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray, sql } from "drizzle-orm";
import { barcodeLookupForms, strictGtin } from "@shared/gtin";
import { inventoryItems, type InventoryItem } from "@shared/schema";
import type { PoolClient } from "pg";
import { lockIdentityScope } from "./identity-lock";
import { pool } from "./pg";

/** A pooled client in an open transaction, which is all these helpers need. */
type Queryable = PoolClient;

export const inventoryBarcodeScope = (barcode: string): string =>
  `frc:inventory-barcode:${strictGtin(barcode) ?? barcode.trim()}`;

/**
 * Take the queue for this barcode until the transaction ends. A blank barcode
 * has no identity to collide on, so nothing is taken.
 */
export async function lockInventoryBarcode(client: Queryable, barcode: string | null | undefined): Promise<void> {
  const code = (barcode ?? "").trim();
  if (!code) return;
  await lockIdentityScope(client, inventoryBarcodeScope(code));
}

/**
 * Run `work` in one transaction that holds this barcode's queue.
 *
 * For callers outside runIdempotent, such as the scan path, which has no
 * request key of its own because a scan is not a save.
 */
export async function withInventoryBarcodeQueue<T>(
  barcode: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockInventoryBarcode(client, barcode);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The saved item this code already belongs to, under any rendering, read on the
 * caller's connection so it sees whatever the held queue has let through.
 */
export async function findItemByBarcodeForms(
  client: Queryable,
  barcode: string | null | undefined,
  excludeId?: string,
): Promise<InventoryItem | undefined> {
  const code = (barcode ?? "").trim();
  if (!code) return undefined;
  const forms = barcodeLookupForms(code);
  if (forms.length === 0) return undefined;
  const matches = await drizzle(client).select().from(inventoryItems)
    .where(inArray(sql`btrim(${inventoryItems.barcode})`, forms));
  const rows = matches.filter((row) => row.id !== excludeId);
  if (rows.length > 1) {
    throw Object.assign(new Error(
      "This barcode belongs to multiple inventory items. Open the intended item by name and have an administrator reconcile the duplicate barcodes; no item was selected or changed.",
    ), { status: 409 });
  }
  return rows[0];
}
