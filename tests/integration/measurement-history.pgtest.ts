import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";
import { applyTransactionStock } from "../../server/transaction-stock";

let db: TestDb, server: Server, base: string;
const actor = "00000000-0000-4000-8000-00000000000e";
beforeAll(async () => {
  db = await createTestDb(); process.env.DATABASE_URL = db.url;
  const express = (await import("express")).default;
  const { registerInventoryQualityRoutes } = await import("../../server/inventory-quality");
  const { registerEntityReportRoutes } = await import("../../server/entity-report");
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get("x-role") !== "none") req.user = { id: actor, name: "Synthetic staff", email: "", role: (req.get("x-role") || "staff") as any, studentId: null };
    next();
  });
  registerInventoryQualityRoutes(app); registerEntityReportRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await (await import("../../server/pg")).pool.end(); await db?.drop();
});
async function seedItem() {
  return (await db.pool.query("INSERT INTO inventory_items(name,quantity,reserved_quantity,weight_per_unit_lbs,value_per_unit_usd) VALUES($1,12,2,0,0) RETURNING *", ["Synthetic corrections " + randomUUID()])).rows[0];
}
async function seedLine(itemId: string, weight: number, value: number, quantity = 1, type = "OUT", timestamp = "2026-10-10T12:00:00Z", clientId: string | null = null, donorId: string | null = null) {
  const tx = (await db.pool.query("INSERT INTO transactions(type,timestamp,client_id,donor_id) VALUES($1,$2,$3,$4) RETURNING id", [type, timestamp, clientId, donorId])).rows[0].id;
  const line = (await db.pool.query("INSERT INTO transaction_items(transaction_id,inventory_item_id,name,quantity,weight_per_unit_lbs,value_per_unit_usd) VALUES($1,$2,'Synthetic historical item',$3,$4,$5) RETURNING *", [tx,itemId,quantity,weight,value])).rows[0];
  return { tx, line };
}
const bodyFor = (item: any, over: any = {}) => ({ expectedUpdatedAt: new Date(item.updated_at).toISOString(),
  weightPerUnitLbs: 2, weightSource: "Synthetic package scale and date", weightIsEstimated: false,
  valuePerUnitUsd: 5, valueSource: "Synthetic dated package price", costIsEstimated: true,
  history: { mode: "missing_only", reason: "Fill historical missing package measurements" }, ...over });
const request = (method: string, path: string, body: unknown, role = "staff") => fetch(base+path, { method, headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body) });
async function preview(item: any, body: any) {
  const response = await request("POST", `/api/inventory/${item.id}/measurements/preview`, body);
  expect(response.status).toBe(200); return response.json();
}
function confirmed(body: any, result: any) { return { ...body, history: { ...body.history, confirmedSamePackage: true, confirmedReplace: body.history.mode === "replace_incorrect", expectedFingerprint: result.historyFingerprint } }; }
const save = (item: any, body: any, result: any) => request("PATCH", `/api/inventory/${item.id}/measurements`, confirmed(body,result));
const savedItem = async (id: string) => (await db.pool.query("SELECT * FROM inventory_items WHERE id=$1", [id])).rows[0];

it("fills missing fields independently across IN/OUT and updates linked entity reports atomically", async () => {
  const item = await seedItem();
  const student = (await db.pool.query("INSERT INTO clients(name,identifier) VALUES('Synthetic Student',$1) RETURNING id", [randomUUID()])).rows[0].id;
  const donor = (await db.pool.query("INSERT INTO donors(name) VALUES('Synthetic Donor') RETURNING id")).rows[0].id;
  const incoming = await seedLine(item.id,0,0,2,"IN",undefined,null,donor);
  const known = await seedLine(item.id,1,3,3,"OUT",undefined,student);
  const partial = await seedLine(item.id,0,4,1,"OUT",undefined,student);
  const body = bodyFor(item); const p = await preview(item,body);
  expect(p.counts).toEqual({ rows: 2, transactions: 2, weightRows: 2, weightTransactions: 2, valueRows: 1, valueTransactions: 1 });
  expect(p.totals).toEqual({ beforeWeightLbs: 0, afterWeightLbs: 6, beforeValueUsd: 4, afterValueUsd: 14 });
  const response = await save(item,body,p); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ historicalSnapshotsChanged: true, stockChanged: false, counts: p.counts });
  const current = await savedItem(item.id);
  expect(current.quantity).toBe(12); expect(current.reserved_quantity).toBe(2);
  expect(Number(current.weight_per_unit_lbs)).toBe(2); expect(Number(current.value_per_unit_usd)).toBe(5);
  const lines = (await db.pool.query("SELECT * FROM transaction_items WHERE inventory_item_id=$1 ORDER BY id", [item.id])).rows;
  expect(lines.find(l=>l.id===known.line.id)).toEqual(known.line);
  expect(Number(lines.find(l=>l.id===partial.line.id).value_per_unit_usd)).toBe(4);
  expect(Number(lines.find(l=>l.id===incoming.line.id).value_per_unit_usd)).toBe(5);
  const audit = current.raw_payload.frcMeasurementHistory;
  expect(audit).toHaveLength(1); expect(audit[0].by).toBe(actor);
  expect(audit[0].history.beforeAfter).toHaveLength(2);
  expect(audit[0].history.beforeAfter.find((l:any)=>l.lineId===incoming.line.id)).toMatchObject({ beforeWeightLbs: "0.0000", afterWeightLbs: "2", beforeValueUsd: "0.00", afterValueUsd: "5", quantity: 2 });
  const studentReport = await (await fetch(`${base}/api/reports/entity/student/${student}`)).json();
  const donorReport = await (await fetch(`${base}/api/reports/entity/donor/${donor}`)).json();
  expect(JSON.stringify(studentReport)).toContain('Synthetic Student');
  expect(studentReport.outgoing).toMatchObject({ weightLbs: 5, valueCents: 1300 });
  expect(donorReport.incoming).toMatchObject({ weightLbs: 4, valueCents: 1000 });
  const tx = (await db.pool.query("SELECT client_id,donor_id FROM transactions WHERE id=$1", [partial.tx])).rows[0];
  expect(tx.client_id).toBe(student); expect(tx.donor_id).toBeNull();
  const quality = await (await fetch(`${base}/api/inventory/quality`)).json();
  const row = quality.items.find((x:any)=>x.id===item.id);
  expect(row).toMatchObject({ quantity:12, reservedQuantity:2 });
  expect(row.measurementHistory[0].history.counts.rows).toBe(2);
  expect(JSON.stringify(row.measurementHistory)).not.toContain(actor);
});

it("replaces only selected fields and inclusive Eastern dates with explicit confirmation", async () => {
  const item = await seedItem();
  const before = await seedLine(item.id,1,3,1,"OUT","2026-10-01T03:59:59Z");
  const inside = await seedLine(item.id,1,4,1,"OUT","2026-10-01T04:00:00Z");
  const after = await seedLine(item.id,1,5,1,"OUT","2026-10-02T04:00:00Z");
  const body = bodyFor(item,{ valuePerUnitUsd: undefined, valueSource: undefined, costIsEstimated: undefined,
    history:{mode:"replace_incorrect",from:"2026-10-01",to:"2026-10-01",reason:"Correct wrongly recorded package weight for this date"} });
  const p=await preview(item,body); expect(p.counts.rows).toBe(1); expect(p.counts.valueRows).toBe(0);
  const unconfirmed=confirmed(body,p); unconfirmed.history.confirmedReplace=false;
  expect((await request("PATCH",`/api/inventory/${item.id}/measurements`,unconfirmed)).status).toBe(400);
  expect((await save(item,body,p)).status).toBe(200);
  const lines=(await db.pool.query("SELECT * FROM transaction_items WHERE inventory_item_id=$1",[item.id])).rows;
  expect(lines.find(l=>l.id===before.line.id)).toEqual(before.line);
  expect(lines.find(l=>l.id===after.line.id)).toEqual(after.line);
  expect(lines.find(l=>l.id===inside.line.id)).toMatchObject({weight_per_unit_lbs:"2.0000",value_per_unit_usd:"4.00"});
});

it("refuses a stale preview after a concurrent historical line insert even without an inventory version change", async () => {
  const item=await seedItem(); await seedLine(item.id,0,0);
  const body=bodyFor(item), p=await preview(item,body);
  await seedLine(item.id,0,0);
  expect((await save(item,body,p)).status).toBe(409);
  expect((await savedItem(item.id)).raw_payload).toBeNull();
  expect((await db.pool.query("SELECT count(*)::int AS n FROM transaction_items WHERE inventory_item_id=$1 AND weight_per_unit_lbs=0",[item.id])).rows[0].n).toBe(2);
});

it("refuses changed line values, changed inputs and stale item versions", async () => {
  const item=await seedItem(); const entry=await seedLine(item.id,0,0);
  const body=bodyFor(item), p=await preview(item,body);
  const changed=confirmed({...body,weightPerUnitLbs:3},p);
  expect((await request("PATCH",`/api/inventory/${item.id}/measurements`,changed)).status).toBe(409);
  await db.pool.query("UPDATE transaction_items SET value_per_unit_usd=4 WHERE id=$1",[entry.line.id]);
  expect((await save(item,body,p)).status).toBe(409);
  await db.pool.query("UPDATE inventory_items SET updated_at=updated_at+interval '1 second' WHERE id=$1",[item.id]);
  expect((await request("POST",`/api/inventory/${item.id}/measurements/preview`,body)).status).toBe(409);
});

it("serializes duplicate save attempts into one correction and one audit event", async () => {
  const item=await seedItem();await seedLine(item.id,0,0);
  const body=bodyFor(item),p=await preview(item,body);
  const results=await Promise.all([save(item,body,p),save(item,body,p)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await savedItem(item.id)).raw_payload.frcMeasurementHistory).toHaveLength(1);
});

it("refuses more than1000 affected lines without a partial update", async () => {
  const item=await seedItem(); const entry=await seedLine(item.id,0,0);
  await db.pool.query("INSERT INTO transaction_items(transaction_id,inventory_item_id,name,quantity,weight_per_unit_lbs,value_per_unit_usd) SELECT $1,$2,'Synthetic bulk',1,0,0 FROM generate_series(1,1000)",[entry.tx,item.id]);
  const body=bodyFor(item),p=await preview(item,body);
  expect(p.counts.rows).toBe(1001);expect(p.canApply).toBe(false);expect(p.historyFingerprint).toBe('');
  expect((await save(item,body,{...p,historyFingerprint:'a'.repeat(64)})).status).toBe(413);
  expect((await savedItem(item.id)).raw_payload).toBeNull();
});

it("rolls every line and inventory audit back if a database write fails", async () => {
  const item=await seedItem();await seedLine(item.id,0,0);
  const body=bodyFor(item,{valuePerUnitUsd:9}),p=await preview(item,body);
  await db.pool.query(`ALTER TABLE transaction_items ADD CONSTRAINT synthetic_correction_failure CHECK(inventory_item_id <> '${item.id}'::uuid OR value_per_unit_usd < 8)`);
  try {
    expect((await save(item,body,p)).status).toBe(500);
    const current=await savedItem(item.id);expect(current.raw_payload).toBeNull();expect(Number(current.weight_per_unit_lbs)).toBe(0);
    expect((await db.pool.query("SELECT value_per_unit_usd FROM transaction_items WHERE inventory_item_id=$1",[item.id])).rows[0].value_per_unit_usd).toBe('0.00');
  } finally { await db.pool.query("ALTER TABLE transaction_items DROP CONSTRAINT synthetic_correction_failure"); }
});

it("keeps old future-only calls compatible and rejects unauthorized roles", async () => {
  const item=await seedItem();const entry=await seedLine(item.id,0,0);const body=bodyFor(item,{history:undefined});
  for(const [role,status] of [['none',401],['student',403],['volunteer',403]] as const) {
    expect((await request('PATCH',`/api/inventory/${item.id}/measurements`,body,role)).status).toBe(status);
    expect((await request('POST',`/api/inventory/${item.id}/measurements/preview`,bodyFor(item),role)).status).toBe(status);
  }
  const response=await request('PATCH',`/api/inventory/${item.id}/measurements`,body);
  expect(response.status).toBe(200);expect((await response.json()).historicalSnapshotsChanged).toBe(false);
  expect((await db.pool.query('SELECT * FROM transaction_items WHERE id=$1',[entry.line.id])).rows[0]).toEqual(entry.line);
});

it("keeps stock-write versions monotonic even after a correction advanced the item clock", async () => {
  const item=await seedItem(); const c=await db.pool.connect();
  try {
    await c.query('BEGIN');
    await db.pool.query("UPDATE inventory_items SET updated_at='2099-01-01T00:00:00Z' WHERE id=$1",[item.id]);
    await applyTransactionStock(c,'IN',[{inventoryItemId:item.id,quantity:1}],{transactionId:randomUUID(),userId:null});
    await c.query('COMMIT');
    const current=await savedItem(item.id);expect(current.quantity).toBe(13);
    expect(new Date(current.updated_at).getTime()).toBeGreaterThan(new Date('2099-01-01T00:00:00Z').getTime());
  } finally { await c.query('ROLLBACK');c.release(); }
});

