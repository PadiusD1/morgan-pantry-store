import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/pg';
let db: TestDb, server: Server, base: string;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOor68HAAL+AX66JXAlAAAAAElFTkSuQmCC';
beforeAll(async () => {
  db = await createTestDb(); process.env.DATABASE_URL = db.url;
  const express = (await import('express')).default;
  const { registerInventoryQualityRoutes } = await import('../../server/inventory-quality');
  const { registerProductPhotoRoutes } = await import('../../server/product-photo');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-00000000000a', email: 'synthetic@example.test', name: 'Synthetic staff', role: 'staff', studentId: null }; next(); });
  registerInventoryQualityRoutes(app); registerProductPhotoRoutes(app);
  server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (db) { await (await import('../../server/pg')).pool.end(); await db.drop(); }
});
async function patch(id: string, data: unknown) { return fetch(`${base}/api/inventory/${id}/measurements`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); }

it('keeps complete items available and advances versions while synchronizing grams', async () => {
  const { rows: [item] } = await db.pool.query("INSERT INTO inventory_items(name,quantity,reserved_quantity,weight_per_unit_lbs,unit_weight_g,value_per_unit_usd,raw_payload,updated_at) VALUES('Complete synthetic rice',7,2,1,1,2,$1,'2099-01-01T00:00:00.000Z') RETURNING *", [JSON.stringify({ frcPhoto: { dataUrl: png, reviewedBy: 'PRIVATE STAFF' } })]);
  const quality = await (await fetch(`${base}/api/inventory/quality`)).json();
  expect(quality.items.find((row: any) => row.id === item.id)).toMatchObject({ missingWeight: false, missingValue: false });
  const response = await patch(item.id, { expectedUpdatedAt: item.updated_at.toISOString(), weightPerUnitLbs: 1.5, weightSource: 'Synthetic measured package', weightIsEstimated: false });
  expect(response.status).toBe(200); const saved = await response.json();
  expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(item.updated_at.getTime());
  const { rows: [current] } = await db.pool.query('SELECT * FROM inventory_items WHERE id=$1', [item.id]);
  expect(current.quantity).toBe(7); expect(current.reserved_quantity).toBe(2);
  expect(Number(current.weight_per_unit_lbs)).toBe(1.5); expect(Number(current.unit_weight_g)).toBeCloseTo(680.388555, 3);
  expect(current.raw_payload.frcMeasurementHistory).toHaveLength(1);
  expect((await patch(item.id, { expectedUpdatedAt: item.updated_at.toISOString(), valuePerUnitUsd: 4, valueSource: 'Synthetic stale price', costIsEstimated: true })).status).toBe(409);
});
it('rejects unsupported money and weight precision rather than silently rounding evidence', async () => {
  const { rows: [item] } = await db.pool.query("INSERT INTO inventory_items(name,quantity) VALUES('Precision synthetic item',4) RETURNING *");
  expect((await patch(item.id, { expectedUpdatedAt: item.updated_at.toISOString(), valuePerUnitUsd: 2.345, valueSource: 'Synthetic precision test', costIsEstimated: true })).status).toBe(400);
  expect((await patch(item.id, { expectedUpdatedAt: item.updated_at.toISOString(), weightPerUnitLbs: 1.00001, weightSource: 'Synthetic precision test', weightIsEstimated: true })).status).toBe(400);
  expect((await db.pool.query('SELECT quantity,raw_payload FROM inventory_items WHERE id=$1', [item.id])).rows[0]).toEqual({ quantity: 4, raw_payload: null });
});
it('serves source attribution without fetching an image or leaking private metadata', async () => {
  const { rows: [item] } = await db.pool.query("INSERT INTO inventory_items(name,raw_payload) VALUES('Synthetic source photo',$1) RETURNING id", [JSON.stringify({ product: { image_front_url: 'https://images.openfoodfacts.org/images/products/123/456/789/0123/front_en.1.400.jpg' }, staffNotes: 'PRIVATE SOURCE' })]);
  const response = await fetch(`${base}/api/public/inventory/${item.id}/photo?attribution=1`);
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/html');
  const page = await response.text(); expect(page).toContain('Open Food Facts contributors'); expect(page).toContain('CC BY-SA 3.0'); expect(page).not.toContain('PRIVATE SOURCE');
});
