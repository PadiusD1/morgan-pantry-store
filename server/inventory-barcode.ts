import type { Express } from 'express';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { inventoryItems } from '@shared/schema';
import { barcodeIsSameRecord } from '@shared/gtin';
import { validSavedBarcode } from '@shared/barcode-input';
import { findItemByBarcodeForms, lockInventoryBarcode } from './inventory-identity';
import { runIdempotent } from './idempotency';

/** Attaching a scanned code must never rename a different saved identity. */
export function registerInventoryBarcodeRoutes(app: Express) {
  app.post('/api/inventory/:id/barcode', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ barcode: z.string().trim().refine(validSavedBarcode) }).strict().safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: 'Choose an item and a valid scanned code.' });
    await runIdempotent(req, res, async client => {
      const code = body.data.barcode;
      await lockInventoryBarcode(client, code);
      const other = await findItemByBarcodeForms(client, code, id.data);
      if (other) return { status: 409, body: { message: `This code already belongs to ${other.name}. Select that item instead.` } };
      const db = drizzle(client);
      const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id.data)).for('update');
      if (!item) return { status: 404, body: { message: 'Item not found.' } };
      if (item.barcode?.trim() && !barcodeIsSameRecord(item.barcode, code)) {
        return { status: 409, body: { message: 'This item already has a different barcode. Review the package in Inventory before replacing its code.' } };
      }
      const [saved] = await db.update(inventoryItems).set({ barcode: code, updatedAt: new Date() }).where(eq(inventoryItems.id, id.data)).returning();
      return { status: 200, body: saved };
    });
  });
}
