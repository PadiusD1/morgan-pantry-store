import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/pg';
let t: TestDb, server: Server, base: string;
beforeAll(async () => {
  t = await createTestDb(); process.env.DATABASE_URL = t.url;
  const express=(await import('express')).default;
  const { apiGuard }=await import('../../server/auth');
  const { registerInventoryQualityRoutes }=await import('../../server/inventory-quality');
  const { registerProductPhotoRoutes }=await import('../../server/product-photo');
  const { registerIntegrationRoutes }=await import('../../server/integrations');
  const { registerRoutes }=await import('../../server/routes');
  const app=express(); app.use(express.json({limit:'256kb'}));
  app.use((req,_res,next)=>{ if (req.headers['x-test-role']!=='anonymous') req.user={id:'00000000-0000-4000-8000-00000000000a',email:'synthetic-admin@example.test',name:'Synthetic Admin',role:(req.headers['x-test-role']??'admin') as any,studentId:null}; next(); });
  app.use(apiGuard()); registerInventoryQualityRoutes(app); registerProductPhotoRoutes(app); registerIntegrationRoutes(app); await registerRoutes(app);
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({message:String(err?.message??err)}));
  server=app.listen(0); base=`http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{ vi.unstubAllGlobals(); delete process.env.FRC_EMAIL_ENABLED; delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL; delete process.env.FRC_PUBLIC_URL; await new Promise<void>(resolve=>server?.close(()=>resolve())??resolve()); if(t){await (await import('../../server/pg')).pool.end();await t.drop();} });
async function item(name='Synthetic rice 16oz') { return (await t.pool.query("INSERT INTO inventory_items(name,quantity,reserved_quantity) VALUES($1,20,2) RETURNING *",[name])).rows[0]; }
async function body(path:string,data:unknown,method='PATCH',role='admin') { return fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json','x-test-role':role},body:JSON.stringify(data)}); }
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lC8AAAAASUVORK5CYII=';
describe('complete inventory safely',()=>{
  it('reports missing values with conservative package mass proposals',async()=>{ const row=await item(); const response=await fetch(`${base}/api/inventory/quality`); expect(response.status).toBe(200); const data=await response.json(); expect(data.items.find((i:any)=>i.id===row.id)).toMatchObject({missingWeight:true,missingValue:true,weightLbs:1,valueUsd:null}); });
  it('requires staff access and explicit source/estimate flags',async()=>{const row=await item(); const payload={expectedUpdatedAt:row.updated_at.toISOString(),weightPerUnitLbs:1}; expect((await body(`/api/inventory/${row.id}/measurements`,payload)).status).toBe(400); expect((await body(`/api/inventory/${row.id}/measurements`,payload,'PATCH','volunteer')).status).toBe(403);});
  it('allows exactly one concurrent versioned correction without changing quantities/history',async()=>{
    const row=await item();
    const tx=(await t.pool.query("INSERT INTO transactions(type,timestamp) VALUES('OUT',now()) RETURNING id")).rows[0];
    await t.pool.query("INSERT INTO transaction_items(transaction_id,inventory_item_id,name,quantity,weight_per_unit_lbs,value_per_unit_usd) VALUES($1,$2,'Historical synthetic rice',2,0,0)",[tx.id,row.id]);
    const payload={expectedUpdatedAt:row.updated_at.toISOString(),weightPerUnitLbs:1,valuePerUnitUsd:2.35,weightSource:'Synthetic package label 16oz',valueSource:'Synthetic unit price fixture',weightIsEstimated:false,costIsEstimated:true};
    const statuses=await Promise.all([body(`/api/inventory/${row.id}/measurements`,payload),body(`/api/inventory/${row.id}/measurements`,payload)]);
    expect(statuses.map(r=>r.status).sort()).toEqual([200,409]);
    const saved=(await t.pool.query('SELECT * FROM inventory_items WHERE id=$1',[row.id])).rows[0]; expect(saved.quantity).toBe(20);expect(saved.reserved_quantity).toBe(2);expect(Number(saved.value_per_unit_usd)).toBe(2.35);expect(saved.raw_payload.frcMeasurementHistory).toHaveLength(1);
    const historical=(await t.pool.query('SELECT * FROM transaction_items WHERE transaction_id=$1',[tx.id])).rows[0];expect(Number(historical.value_per_unit_usd)).toBe(0);
  });
  it('serves a staff uploaded raster photo publicly without exposing raw provider metadata',async()=>{
    const row=await item(); expect((await body(`/api/inventory/${row.id}/photo`,{dataUrl:png,description:'Synthetic test pixel'},'PUT')).status).toBe(200);
    const image=await fetch(`${base}/api/public/inventory/${row.id}/photo`,{headers:{'x-test-role':'anonymous'}});expect(image.status).toBe(200);expect(image.headers.get('content-type')).toBe('image/png');
    const inventory=await fetch(`${base}/api/public/inventory`,{headers:{'x-test-role':'anonymous'}}); const data=await inventory.json(); const actual=(Array.isArray(data)?data:data.items).find((i:any)=>i.id===row.id);expect(actual.imageUrl).toContain(`/api/public/inventory/${row.id}/photo`);expect(actual.rawPayload).toBeUndefined();
    expect((await body(`/api/inventory/${row.id}/photo`,{dataUrl:png,description:'x'},'PUT','student')).status).toBe(403);
    expect((await body(`/api/inventory/${row.id}/photo`,{dataUrl:'data:image/svg+xml;base64,PHN2Zz4=',description:'x'},'PUT')).status).toBe(400);
  });
  it('fulfillment returns saved transaction weights and values for actual fulfilled quantities',async()=>{
    const row=await item();await t.pool.query('UPDATE inventory_items SET weight_per_unit_lbs=1.5,value_per_unit_usd=2.35 WHERE id=$1',[row.id]);
    const req=(await t.pool.query("INSERT INTO requests(client_name,client_identifier,reason,status) VALUES('Synthetic recipient','SYNTH123','Synthetic request','approved') RETURNING id")).rows[0];
    await t.pool.query("INSERT INTO request_items(request_id,inventory_item_id,item_name,requested_quantity,approved_quantity,reserved) VALUES($1,$2,'Synthetic rice',2,2,true)",[req.id,row.id]);
    const res=await body(`/api/requests/${req.id}/fulfill`,{},'POST');expect(res.status,await res.clone().text()).toBe(200);const saved=await res.json();expect(saved.transaction.items).toHaveLength(1);expect(Number(saved.transaction.items[0].weightPerUnitLbs)).toBe(1.5);expect(Number(saved.transaction.items[0].valuePerUnitUsd)).toBe(2.35);expect(saved.transaction.items[0].quantity).toBe(2);
  });
});
describe('durable optional email ledger',()=>{
  it('reports that the ledger needs migration before optional email is enabled',async()=>{const response=await fetch(`${base}/api/integrations/status`);expect(response.status).toBe(200);const actual=await response.json();expect(actual.resend.ledgerReady).toBe(false);expect(actual.turnstile.configured).toBe(false);expect(actual.posthog.configured).toBe(false);expect((await fetch(`${base}/api/integrations/status`,{headers:{'x-test-role':'staff'}})).status).toBe(403);});
  it('deduplicates concurrent sends and holds ambiguous results before provider key expiry',async()=>{
    await t.pool.query(readFileSync('migrations/0002_email_delivery.sql','utf8'));await t.pool.query(readFileSync('migrations/0002_email_delivery.sql','utf8'));
    const request=(await t.pool.query("INSERT INTO requests(client_name,client_identifier,reason) VALUES('Synthetic mail recipient','SYNMAIL','Synthetic test') RETURNING id")).rows[0];
    const notification=(await t.pool.query("INSERT INTO notifications(request_id,recipient_type,recipient_id,type,title,message) VALUES($1,'client','SYNMAIL','test','Test','Test') RETURNING id",[request.id])).rows[0];
    await t.pool.query('INSERT INTO frc_email_delivery(notification_id,request_id,payload) VALUES($1,$2,$3)',[notification.id,request.id,JSON.stringify({from:'test@example.test',to:['synthetic@example.test'],subject:'Synthetic email',text:'Test only'})]);
    process.env.FRC_EMAIL_ENABLED='true';process.env.RESEND_API_KEY='synthetic-key';process.env.RESEND_FROM_EMAIL='test@example.test';process.env.FRC_PUBLIC_URL='https://synthetic.example.test';
    const outbound=vi.fn().mockResolvedValue(new Response('{"id":"synthetic-provider-id"}'));vi.stubGlobal('fetch',outbound);
    const { deliverNotification }=await import('../../server/email-delivery');
    const results=await Promise.all([deliverNotification(notification.id),deliverNotification(notification.id)]);expect(results).toContain('accepted');expect(outbound).toHaveBeenCalledTimes(1);
    await t.pool.query("UPDATE frc_email_delivery SET status='uncertain',first_attempt_at=now()-interval '25 hours',last_attempt_at=now()-interval '2 hours' WHERE notification_id=$1",[notification.id]);
    await deliverNotification(notification.id);expect(outbound).toHaveBeenCalledTimes(1);expect((await t.pool.query('SELECT status FROM frc_email_delivery WHERE notification_id=$1',[notification.id])).rows[0].status).toBe('held');
    vi.unstubAllGlobals();delete process.env.FRC_EMAIL_ENABLED;delete process.env.RESEND_API_KEY;delete process.env.RESEND_FROM_EMAIL;delete process.env.FRC_PUBLIC_URL;
  });
});
