import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTestDb,type TestDb} from '../helpers/pg';
let db:TestDb,server:Server,base:string;
beforeAll(async()=>{
  db=await createTestDb();process.env.DATABASE_URL=db.url;
  const express=(await import('express')).default;
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:'00000000-0000-4000-8000-00000000000a',email:'test@example.test',name:'Synthetic staff',role:'staff',studentId:null};next();});
  await (await import('../../server/routes')).registerRoutes(app);
  (await import('../../server/inventory-quality')).registerInventoryQualityRoutes(app);
  server=app.listen(0);base=`http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve()));if(db){await(await import('../../server/pg')).pool.end();await db.drop();}});
async function seed(weightOnly=false){
  const item=(await db.pool.query("INSERT INTO inventory_items(name,quantity) VALUES('Synthetic reviewed package',20) RETURNING *")).rows[0];
  const body={expectedUpdatedAt:item.updated_at.toISOString(),weightPerUnitLbs:2,weightSource:'Synthetic package label reviewed now',weightIsEstimated:false,...(!weightOnly?{valuePerUnitUsd:5,valueSource:'Synthetic dated current package price',costIsEstimated:true}:{})};
  const response=await fetch(`${base}/api/inventory/${item.id}/measurements`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  expect(response.status,await response.text()).toBe(200);return item;
}
async function write(item:any,fields:Record<string,unknown>={}){
  const response=await fetch(`${base}/api/transactions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'OUT',...fields,items:[{inventoryItemId:item.id,name:item.name,quantity:1,weightPerUnitLbs:'0',valuePerUnitUsd:'3'}]})});
  expect(response.status).toBe(201);return response.json();
}
it('new current transactions from stale tabs use reviewed current values',async()=>{
  const item=await seed();const tx=await write(item);
  expect(Number(tx.items[0].weightPerUnitLbs)).toBe(2);expect(Number(tx.items[0].valuePerUnitUsd)).toBe(5);
  const stored=(await db.pool.query('SELECT * FROM transaction_items WHERE transaction_id=$1',[tx.id])).rows[0];
  expect(Number(stored.weight_per_unit_lbs)).toBe(2);expect(Number(stored.value_per_unit_usd)).toBe(5);
});
it('only reviewed fields override stale snapshots',async()=>{
  const tx=await write(await seed(true));expect(Number(tx.items[0].weightPerUnitLbs)).toBe(2);expect(Number(tx.items[0].valuePerUnitUsd)).toBe(3);
});
it('explicitly backdated transaction measurements remain historical evidence',async()=>{
  const tx=await write(await seed(),{timestamp:'2020-01-02T18:00:00Z'});
  expect(Number(tx.items[0].weightPerUnitLbs)).toBe(0);expect(Number(tx.items[0].valuePerUnitUsd)).toBe(3);
});
