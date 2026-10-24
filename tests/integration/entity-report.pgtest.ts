import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";
let t: TestDb, server: Server, base: string;
let client: string, donor: string, otherDonor: string;
beforeAll(async () => {
  t = await createTestDb(); process.env.DATABASE_URL = t.url;
  const express = (await import("express")).default;
  const { registerEntityReportRoutes } = await import("../../server/entity-report");
  const app = express();
  app.use((req, _res, next) => { const role = req.headers['x-test-role'] ?? 'staff'; if (role !== 'anonymous') req.user = { id: '00000000-0000-4000-8000-00000000000a', email: '', name: 'Synthetic Staff', role: role as any, studentId: null }; next(); });
  registerEntityReportRoutes(app);
  app.use((_err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: 'Unable to read report' }));
  server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
  client = (await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES('Synthetic Partner','REPORT-PARTNER','partner') RETURNING id")).rows[0].id;
  const donors = (await t.pool.query("INSERT INTO donors(name) VALUES('Shared Name'),('Shared Name') RETURNING id")).rows;
  donor = donors[0].id; otherDonor = donors[1].id;
  const item = (await t.pool.query("INSERT INTO inventory_items(name,quantity) VALUES('Synthetic Rice',1000) RETURNING id")).rows[0].id;
  for (let i = 0; i < 61; i++) {
    const row = (await t.pool.query("INSERT INTO transactions(type,client_id,timestamp) VALUES('OUT',$1,'2026-10-01T00:30:00Z') RETURNING id", [client])).rows[0];
    await t.pool.query("INSERT INTO transaction_items(transaction_id,inventory_item_id,name,quantity,weight_per_unit_lbs,value_per_unit_usd) VALUES($1,$2,'Synthetic Rice',2,0.5,1.25),($1,$2,'Unknown mass',3,0,0)", [row.id,item]);
  }
  await t.pool.query("INSERT INTO transactions(type,client_id,timestamp) VALUES('IN',$1,'2026-10-01T03:59:59Z'),('IN',$1,'2026-10-01T04:00:00Z')", [client]);
  await t.pool.query("INSERT INTO transactions(type,donor,timestamp) VALUES('IN','Shared Name','2026-09-30T15:00:00Z')");
  await t.pool.query("INSERT INTO transactions(type,donor_id,timestamp) VALUES('IN',$1,'2026-09-30T15:00:00Z')", [donor]);
});
afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); if(t) { await (await import('../../server/pg')).pool.end(); await t.drop(); } });
const url = (kind = 'partner', id = client, suffix = '') => `${base}/api/reports/entity/${kind}/${id}${suffix}?from=2026-09-30&to=2026-09-30`;
describe('authoritative entity report and export', () => {
  it('reads every transaction with historical line totals, inclusive Eastern dates and a snapshot timestamp', async () => {
    const response = await fetch(url()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const report = await response.json(); expect(report.outgoing).toMatchObject({entries:61, units:305, weightLbs:61, valueCents:15250, unweighedUnits:183});
    expect(report.incoming.entries).toBe(1); expect(report.rows).toHaveLength(62); expect(report.reportingTimeZone).toBe('America/New_York'); expect(Number.isFinite(Date.parse(report.generatedAt))).toBe(true);
    const csvResponse = await fetch(url('partner', client, '/export')); expect(csvResponse.status).toBe(200); expect(csvResponse.headers.get('content-type')).toContain('text/csv');
    const csv = await csvResponse.text(); expect(csv).toContain('Rows in this file,62'); expect(csv.match(/Synthetic Rice/g)).toHaveLength(61);
  });
  it('keeps ambiguous donor names out of both donor totals but discloses coverage', async () => {
    const first = await (await fetch(url('donor', donor))).json(); const second = await (await fetch(url('donor', otherDonor))).json();
    expect(first.incoming.entries).toBe(1); expect(second.incoming.entries).toBe(0);
    expect(first.coverage.ambiguousLegacyEntries).toBe(1); expect(second.coverage.ambiguousLegacyEntries).toBe(1);
  });
  it('includes unique legacy partner contributions and discloses cross-kind source ambiguity', async () => {
    const partner = (await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES('Legacy Cross Source','LEGACY-PARTNER','partner') RETURNING id")).rows[0];
    const legacy = (await t.pool.query("INSERT INTO transactions(type,donor,timestamp) VALUES('IN','legacy   cross source','2026-09-30T15:00:00Z') RETURNING id")).rows[0];
    const unique = await (await fetch(url('partner', partner.id))).json();
    expect(unique.incoming.entries).toBe(1); expect(unique.rows[0].transactionId).toBe(legacy.id); expect(unique.coverage.nameMatchedEntries).toBe(1);
    const sameNameDonor = (await t.pool.query("INSERT INTO donors(name) VALUES('Legacy Cross Source') RETURNING id")).rows[0];
    for (const [kind, id] of [['partner',partner.id],['donor',sameNameDonor.id]]) {
      const ambiguous = await (await fetch(url(kind,id))).json();
      expect(ambiguous.incoming.entries).toBe(0); expect(ambiguous.coverage.ambiguousLegacyEntries).toBe(1);
      const csv = await (await fetch(url(kind,id,'/export'))).text();
      expect(csv).toContain('Incoming entries left unallocated because the source name is shared,1');
    }
    await t.pool.query("INSERT INTO transactions(type,client_id,donor,timestamp) VALUES('IN',$1,'Legacy Cross Source','2026-09-30T15:00:00Z')",[partner.id]);
    const explicit = await (await fetch(url('partner',partner.id))).json();
    expect(explicit.incoming.entries).toBe(1); expect(explicit.coverage.ambiguousLegacyEntries).toBe(1);
  });
  it('denies sensitive exports to volunteers and all individual reports to students or anonymous users', async () => {
    expect((await fetch(url(), {headers:{'x-test-role':'volunteer'}})).status).toBe(200);
    for(const role of ['volunteer','student','anonymous']) expect((await fetch(url('partner',client,'/export'), {headers:{'x-test-role':role}})).status).toBe(role === 'anonymous' ? 401 : 403);
    for(const role of ['student','anonymous']) expect((await fetch(url(), {headers:{'x-test-role':role}})).status).toBe(role === 'anonymous' ? 401 : 403);
  });
  it('rejects invalid dates, malformed ids and mismatched directory kinds', async () => {
    expect((await fetch(url('student',client))).status).toBe(404);
    expect((await fetch(url('partner','invalid'))).status).toBe(400);
    expect((await fetch(url()+'&from=2026-10-01')).status).toBe(400);
    expect((await fetch(url().replace('from=2026-09-30','from=2026-02-30'))).status).toBe(400);
  });
  it('propagates database failures instead of returning an empty successful report', async () => {
    await t.pool.query('ALTER TABLE transaction_items RENAME TO hidden_report_items');
    try { const response = await fetch(url()); expect(response.status).toBe(500); expect(await response.text()).not.toContain('"entries":0'); }
    finally { await t.pool.query('ALTER TABLE hidden_report_items RENAME TO transaction_items'); }
  });
});

