import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/pg';
let db: TestDb, server: Server, base: string;
const realFetch = globalThis.fetch;
const emailKeys = ['FRC_EMAIL_ENABLED', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'FRC_PUBLIC_URL'] as const;

beforeAll(async () => {
  db = await createTestDb(); process.env.DATABASE_URL = db.url;
  await db.pool.query(readFileSync('migrations/0002_email_delivery.sql', 'utf8'));
  const express = (await import('express')).default;
  const { registerRoutes } = await import('../../server/routes');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-00000000000a', email: 'synthetic-staff@example.test', name: 'Synthetic Staff', role: 'staff', studentId: null }; next(); });
  await registerRoutes(app);
  app.use((err: Error, _req: unknown, res: any, _next: unknown) => res.status(500).json({ message: err.message }));
  server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterEach(() => { vi.unstubAllGlobals(); for (const key of emailKeys) delete process.env[key]; });
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (db) { await (await import('../../server/pg')).pool.end(); await db.drop(); }
});
async function seed(accountLinked: boolean) {
  const suffix = randomUUID(); const email = `synthetic-${suffix}@example.test`;
  const userId = accountLinked ? (await db.pool.query("INSERT INTO users(email,password,name,role) VALUES($1,'not-a-real-password','Synthetic Account','student') RETURNING id", [email])).rows[0].id : null;
  const item = (await db.pool.query("INSERT INTO inventory_items(name,quantity,reserved_quantity,weight_per_unit_lbs,value_per_unit_usd) VALUES('Synthetic pickup item',7,2,1,2) RETURNING id")).rows[0];
  const request = (await db.pool.query("INSERT INTO requests(client_name,client_identifier,reason,status,user_id) VALUES('Synthetic Recipient',$1,'Synthetic ledger regression','approved',$2) RETURNING id", [`SYN-${suffix}`, userId])).rows[0];
  await db.pool.query("INSERT INTO request_items(request_id,inventory_item_id,item_name,requested_quantity,approved_quantity,reserved) VALUES($1,$2,'Synthetic pickup item',2,2,true)", [request.id, item.id]);
  return { requestId: request.id, itemId: item.id, email };
}
function enableMock() {
  process.env.FRC_EMAIL_ENABLED = 'true'; process.env.RESEND_API_KEY = 'synthetic-key';
  process.env.RESEND_FROM_EMAIL = 'synthetic-sender@example.test'; process.env.FRC_PUBLIC_URL = 'https://synthetic.example.test';
}
function complete(id: string) { return realFetch(`${base}/api/requests/${id}/fulfill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }

it('sends an account-linked fulfillment update once, only after the stock transaction commits', async () => {
  const record = await seed(true); enableMock();
  const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe('https://api.resend.com/emails');
    const saved = (await db.pool.query('SELECT status,transaction_id FROM requests WHERE id=$1', [record.requestId])).rows[0];
    expect(saved.status).toBe('completed'); expect(saved.transaction_id).toEqual(expect.any(String));
    const body = JSON.parse(String(init?.body)); expect(body.to).toEqual([record.email]);
    expect(body.text).not.toContain('Synthetic Recipient'); expect(body.text).not.toContain('Synthetic pickup item');
    return new Response('{"id":"synthetic-accepted-completion"}', { status: 200 });
  });
  vi.stubGlobal('fetch', provider);
  const result = await complete(record.requestId); expect(result.status, await result.clone().text()).toBe(200);
  expect(provider).toHaveBeenCalledTimes(1);
  const entries = (await db.pool.query("SELECT d.status,n.type FROM frc_email_delivery d JOIN notifications n ON n.id=d.notification_id WHERE d.request_id=$1", [record.requestId])).rows;
  expect(entries).toEqual([{ status: 'accepted', type: 'request_fulfilled' }]);
  expect((await complete(record.requestId)).status).toBe(400); expect(provider).toHaveBeenCalledTimes(1);
  expect((await db.pool.query('SELECT quantity,reserved_quantity FROM inventory_items WHERE id=$1', [record.itemId])).rows[0]).toEqual({ quantity: 5, reserved_quantity: 0 });
});
it('a provider failure leaves fulfillment saved and records an uncertain delivery for review', async () => {
  const record = await seed(true); enableMock();
  const provider = vi.fn().mockResolvedValue(new Response('{"message":"Synthetic unavailable provider"}', { status: 503 }));
  vi.stubGlobal('fetch', provider);
  const result = await complete(record.requestId); expect(result.status).toBe(200);
  expect((await result.json()).status).toBe('completed'); expect(provider).toHaveBeenCalledTimes(1);
  expect((await db.pool.query('SELECT status FROM frc_email_delivery WHERE request_id=$1', [record.requestId])).rows).toEqual([{ status: 'uncertain' }]);
});
it('typed kiosk identity is not used as an email target without a persisted account link', async () => {
  const record = await seed(false); enableMock();
  const provider = vi.fn(); vi.stubGlobal('fetch', provider);
  expect((await complete(record.requestId)).status).toBe(200); expect(provider).not.toHaveBeenCalled();
  expect((await db.pool.query('SELECT notification_id FROM frc_email_delivery WHERE request_id=$1', [record.requestId])).rows).toEqual([]);
});
