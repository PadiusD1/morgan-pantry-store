import { beforeAll, afterAll, it, expect } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestDb, type TestDb } from '../helpers/pg';
let t: TestDb, server: Server, base: string;
const A='00000000-0000-4000-8000-00000000000a', B='00000000-0000-4000-8000-00000000000b';
let owned: string, other: string, legacy: string, noteA: string, noteB: string;
beforeAll(async()=>{
  t=await createTestDb();process.env.DATABASE_URL=t.url;
  for(const id of [A,B]) await t.pool.query("INSERT INTO users(id,email,password,name,role,student_id) VALUES($1,$2,'synthetic','Synthetic Student','student','SAME-TYPED-ID')",[id,`${id}@example.test`]);
  async function request(userId: string|null) {return (await t.pool.query("INSERT INTO requests(user_id,client_name,client_identifier,reason) VALUES($1,'Synthetic Student','SAME-TYPED-ID','Synthetic request') RETURNING id",[userId])).rows[0].id;}
  owned=await request(A);other=await request(B);legacy=await request(null);
  async function notification(id: string) {return (await t.pool.query("INSERT INTO notifications(request_id,recipient_type,recipient_id,type,title,message) VALUES($1,'client','SAME-TYPED-ID','test','Synthetic title','Synthetic message') RETURNING id",[id])).rows[0].id;}
  noteA=await notification(owned);noteB=await notification(other);await notification(legacy);
  const express=(await import('express')).default;const {registerPortalRoutes}=await import('../../server/portal');
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:A,email:'synthetic@example.test',name:'Synthetic Student',role:'student',studentId:'SAME-TYPED-ID'};next();});registerPortalRoutes(app);
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({message:String(err)}));server=app.listen(0);base=`http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve())??resolve());if(t){await (await import('../../server/pg')).pool.end();await t.drop();}});
it('lists only account-owned requests even when another account or legacy record uses the same identifier',async()=>{
  const response=await fetch(`${base}/api/portal/requests`);expect(response.status).toBe(200);expect((await response.json()).map((r:any)=>r.id)).toEqual([owned]);
});
it('cannot cancel another account or unlinked legacy request by typing its student identifier',async()=>{
  for(const id of [other,legacy]) expect((await fetch(`${base}/api/portal/requests/${id}/cancel`,{method:'POST'})).status).toBe(404);
  expect((await t.pool.query('SELECT status FROM requests WHERE id=$1',[other])).rows[0].status).toBe('pending');
});
it('notifications and unread count use the persisted request account',async()=>{
  expect((await(await fetch(`${base}/api/portal/notifications`)).json()).map((n:any)=>n.id)).toEqual([noteA]);
  expect((await(await fetch(`${base}/api/portal/me/summary`)).json()).unreadNotifications).toBe(1);
});
it('read-one and read-all cannot modify another account or legacy notifications',async()=>{
  expect((await fetch(`${base}/api/portal/notifications/${noteB}/read`,{method:'POST'})).status).toBe(404);
  expect((await fetch(`${base}/api/portal/notifications/not-a-uuid/read`,{method:'POST'})).status).toBe(404);
  expect((await fetch(`${base}/api/portal/notifications/${noteA}/read`,{method:'POST'})).status).toBe(200);
  expect((await fetch(`${base}/api/portal/notifications/read-all`,{method:'POST'})).status).toBe(200);
  const rows=(await t.pool.query('SELECT id,read FROM notifications ORDER BY id')).rows;expect(rows.filter((n:any)=>n.read).map((n:any)=>n.id)).toEqual([noteA]);
});
