import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

// Runs against a fresh local database through the real routes. No production
// database or service can be used by the shared PostgreSQL integration harness.
let t: TestDb;
let server: Server;
let base: string;

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  const express = (await import("express")).default;
  const { registerRoutes } = await import("../../server/routes");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "00000000-0000-4000-8000-00000000000d", email: "", name: "Donor Test Admin", role: "admin", studentId: null };
    next();
  });
  await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ message: String(err?.message ?? err) }));
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  if (t) {
    const { pool } = await import("../../server/pg");
    await pool.end();
    await t.drop();
  }
});

async function newDonor(name: string, status = "active", createdAt = "2026-01-01T00:00:00Z") {
  return (await t.pool.query(
    "INSERT INTO donors (name, status, created_at) VALUES ($1, $2, $3) RETURNING id, name",
    [name, status, createdAt],
  )).rows[0] as { id: string; name: string };
}

type Line = { name: string; quantity: number; weight: string; value: string };

async function donation(options: { donorId?: string; clientId?: string; name: string; type?: "IN" | "OUT"; items?: Line[] }) {
  const tx = (await t.pool.query(
    "INSERT INTO transactions (type, donor, donor_id, client_id, timestamp) VALUES ($1, $2, $3, $4, '2026-10-01T12:00:00Z') RETURNING id",
    [options.type ?? "IN", options.name, options.donorId ?? null, options.clientId ?? null],
  )).rows[0];
  const itemIds: string[] = [];
  for (const line of options.items ?? [{ name: "Test Rice", quantity: 3, weight: "0.5", value: "2.00" }]) {
    const item = (await t.pool.query("INSERT INTO inventory_items (name, quantity) VALUES ($1, 100) RETURNING id", [line.name])).rows[0];
    itemIds.push(item.id);
    await t.pool.query(
      "INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd) VALUES ($1, $2, $3, $4, $5, $6)",
      [tx.id, item.id, line.name, line.quantity, line.weight, line.value],
    );
  }
  return { id: tx.id as string, itemIds };
}

async function reports(id: string) {
  const responses = await Promise.all([
    fetch(`${base}/api/donors`),
    fetch(`${base}/api/donors/${id}`),
    fetch(`${base}/api/donors/${id}/history`),
    fetch(`${base}/api/donors/${id}/export`),
  ]);
  for (const response of responses) expect(response.status).toBe(200);
  const [list, detail, history, csv] = await Promise.all([
    responses[0].json(), responses[1].json(), responses[2].json(), responses[3].text(),
  ]);
  return { list: list.find((row: any) => row.id === id), detail, history: history as any[], csv: csv as string };
}

describe("donor reporting and persistence", () => {
  it("counts explicit donor links and excludes same-name partner donations and outbound transactions", async () => {
    const donor = await newDonor("Shared Farm");
    const partner = (await t.pool.query(
      "INSERT INTO clients (name, identifier, client_type) VALUES ($1, 'shared-farm-partner', 'partner') RETURNING id",
      [donor.name],
    )).rows[0];
    const own = await donation({ donorId: donor.id, name: "Old Farm Name" });
    await donation({ clientId: partner.id, name: donor.name });
    await donation({ donorId: donor.id, name: donor.name, type: "OUT" });

    const actual = await reports(donor.id);
    expect(actual.history.map((row) => row.id)).toEqual([own.id]);
    expect(actual.list).toMatchObject({ totalDonations: 1, totalItems: 3, totalWeightDonated: 1.5, totalValueDonated: 6 });
    expect(actual.detail).toMatchObject({ totalDonations: 1, totalItemsDonated: 3, totalWeightDonated: 1.5, totalValueDonated: 6 });
    expect(actual.csv).toContain("Total Donations,1");
    expect(actual.csv).toContain("Total Items Donated,3");
  });

  it("leaves ambiguous legacy names unallocated across reports while preserving explicit donor links", async () => {
    const inactive = await newDonor("Legacy Orchard", "inactive", "2025-01-01T00:00:00Z");
    const activeA = await newDonor(" LEGACY   orchard ", "active", "2026-01-01T00:00:00Z");
    const activeB = await newDonor("legacy orchard", "active", "2026-01-01T00:00:00Z");
    const legacy = await donation({ name: "  Legacy   ORCHARD " });
    const explicitInactive = await donation({ donorId: inactive.id, name: "Previous orchard name" });

    // Neither active status, creation date nor UUID order can establish who
    // supplied a name-only historical delivery. Every matching donor sees the
    // ambiguity, but none receives its units, weight or value.
    for (const donor of [activeA, activeB]) {
      const actual = await reports(donor.id);
      expect(actual.history).toEqual([]);
      expect(actual.list).toMatchObject({ totalDonations: 0, totalItems: 0, totalWeightDonated: 0, totalValueDonated: 0, hasAmbiguousName: true });
      expect(actual.detail).toMatchObject({ totalDonations: 0, totalItemsDonated: 0, totalWeightDonated: 0, totalValueDonated: 0 });
      expect(actual.csv).toContain("Total Donations,0");
      expect(actual.csv).toContain("Total Items Donated,0");
    }
    const historical = await reports(inactive.id);
    expect(historical.history.map((row) => row.id)).toEqual([explicitInactive.id]);
    expect(historical.list).toMatchObject({ totalDonations: 1, totalItems: 3, totalWeightDonated: 1.5, totalValueDonated: 6, hasAmbiguousName: true });
    expect(historical.detail.totalDonations).toBe(1);
    expect(historical.csv).toContain("Total Donations,1");

    for (const donor of [inactive, activeA, activeB]) {
      const response = await fetch(`${base}/api/reports/entity/donor/${donor.id}`);
      expect(response.status).toBe(200);
      const individual = await response.json();
      expect(individual.coverage.ambiguousLegacyEntries).toBe(1);
      expect(individual.incoming.entries).toBe(donor.id === inactive.id ? 1 : 0);
      expect(individual.rows.some((row: any) => row.transactionId === legacy.id)).toBe(false);
    }
    // Reporting must not rewrite evidence while presenting the gap.
    expect((await t.pool.query("SELECT donor_id, donor FROM transactions WHERE id = $1", [legacy.id])).rows[0]).toEqual({ donor_id: null, donor: "  Legacy   ORCHARD " });
  });

  it("refuses deletion of an ambiguous donor rather than crediting its legacy history to the remaining name", async () => {
    const a = await newDonor("Ambiguous Delete Farm");
    const b = await newDonor(" ambiguous   DELETE farm ", "inactive");
    const legacy = await donation({ name: "Ambiguous Delete Farm" });
    const response = await fetch(`${base}/api/donors/${a.id}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/history|legacy/i);
    expect((await t.pool.query("SELECT id FROM donors WHERE id = ANY($1::uuid[])", [[a.id,b.id]])).rows).toHaveLength(2);
    expect((await reports(a.id)).history).toEqual([]);
    expect((await reports(b.id)).history).toEqual([]);
    expect((await t.pool.query("SELECT donor_id FROM transactions WHERE id=$1",[legacy.id])).rows[0].donor_id).toBeNull();
  });

  it("refuses renames that detach or reallocate legacy name-only donations but allows explicit-ID history renames", async () => {
    const sharedA = await newDonor("Ambiguous Rename Farm");
    const sharedB = await newDonor(" ambiguous RENAME farm ");
    await donation({ name: "Ambiguous Rename Farm" });
    const sole = await newDonor("Sole Legacy Rename Farm");
    await donation({ name: sole.name });
    for (const donor of [sharedA, sole]) {
      const response = await fetch(`${base}/api/donors/${donor.id}`, { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({name: `${donor.name} renamed`}) });
      expect(response.status).toBe(409);
      expect((await t.pool.query("SELECT name FROM donors WHERE id=$1",[donor.id])).rows[0].name).toBe(donor.name);
    }
    expect((await reports(sharedB.id)).history).toEqual([]);
    const explicit = await newDonor("Explicit Rename Farm");
    const linked = await donation({ donorId: explicit.id, name: explicit.name });
    const renamed = await fetch(`${base}/api/donors/${explicit.id}`, { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({name:"Explicit Renamed Farm"}) });
    expect(renamed.status).toBe(200);
    expect((await reports(explicit.id)).history.map(row=>row.id)).toEqual([linked.id]);
  });

  it.each(["partner", "student"])("does not award a legacy cross-kind %s name to the donor", async (kind) => {
    const donor = await newDonor(`Cross Kind ${kind}`);
    await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES($1,$2,$3)", [donor.name, `cross-kind-${kind}`, kind]);
    await donation({name:donor.name});
    const linked = await donation({donorId:donor.id,name:donor.name});
    const actual = await reports(donor.id);
    expect(actual.list).toMatchObject({totalDonations:1,hasAmbiguousName:true});
    expect(actual.detail.totalDonations).toBe(1);
    expect(actual.history.map(row=>row.id)).toEqual([linked.id]);
    expect(actual.csv).toContain("Total Donations,1");
    const report = await (await fetch(`${base}/api/reports/entity/donor/${donor.id}`)).json();
    expect(report.incoming.entries).toBe(1); expect(report.coverage.ambiguousLegacyEntries).toBe(1);
  });

  it.each(["partner", "student"])("preserves cross-kind ambiguity when a %s client is renamed or deleted", async (kind) => {
    const donor = await newDonor(`Protected Cross Source ${kind}`);
    const client = (await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES($1,$2,$3) RETURNING id", [donor.name, `protected-cross-${kind}`, kind])).rows[0];
    const legacy = await donation({name:donor.name});
    const renamed = await fetch(`${base}/api/clients/${client.id}`, {method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Changed cross source"})});
    expect(renamed.status).toBe(409);
    expect((await fetch(`${base}/api/clients/${client.id}`, {method:"DELETE"})).status).toBe(409);
    expect((await t.pool.query("SELECT name FROM clients WHERE id=$1",[client.id])).rows[0].name).toBe(donor.name);
    expect((await reports(donor.id)).history).toEqual([]);
    expect((await t.pool.query("SELECT donor_id,client_id FROM transactions WHERE id=$1",[legacy.id])).rows[0]).toEqual({donor_id:null,client_id:null});
    // Non-identity corrections remain available while historical evidence is held.
    expect((await fetch(`${base}/api/clients/${client.id}`, {method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({phone:"410-555-0199"})})).status).toBe(200);
  });

  it("client mutations wait for the same source-directory lock as donor mutations", async () => {
    const { DONOR_IDENTITY_SCOPE, lockIdentityScope } = await import("../../server/identity-lock");
    const client = (await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES('Queued Client','queued-cross-source','partner') RETURNING id")).rows[0];
    const held = await t.pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await held.query("BEGIN");
      await lockIdentityScope(held,DONOR_IDENTITY_SCOPE);
      request = fetch(`${base}/api/clients/${client.id}`, {method:"DELETE"});
      await expect.poll(async () => (await t.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting")).rows[0].waiting, {timeout:3000}).toBe(true);
      await held.query("COMMIT");
      expect((await request).status).toBe(200);
    } finally {
      await held.query("ROLLBACK"); held.release(); await request;
    }
  });

  it("uses transaction snapshots after inventory edits and rounds weight totals once", async () => {
    const donor = await newDonor("Snapshot Farm");
    const tx = await donation({ donorId: donor.id, name: donor.name, items: [
      { name: "Small Packet A", quantity: 1, weight: "0.0049", value: "0.13" },
      { name: "Small Packet B", quantity: 1, weight: "0.0049", value: "0.17" },
    ] });
    for (const id of tx.itemIds) {
      await t.pool.query("UPDATE inventory_items SET name = 'Renamed Inventory', weight_per_unit_lbs = 10, value_per_unit_usd = 99 WHERE id = $1", [id]);
    }

    const actual = await reports(donor.id);
    expect(actual.history).toHaveLength(1);
    expect(actual.history[0].items.map((item: any) => item.name).sort()).toEqual(["Small Packet A", "Small Packet B"]);
    expect(actual.history[0]).toMatchObject({ totalQuantity: 2 });
    expect(actual.history[0].totalWeight).toBeCloseTo(0.0098, 6);
    expect(actual.history[0].totalValue).toBeCloseTo(0.3, 6);
    expect(Math.round(actual.history[0].totalWeight * 100) / 100).toBe(actual.list.totalWeightDonated);
    expect(actual.list).toMatchObject({ totalItems: 2, totalWeightDonated: 0.01, totalValueDonated: 0.3 });
    expect(actual.detail).toMatchObject({ totalItemsDonated: 2, totalWeightDonated: 0.01, totalValueDonated: 0.3 });
    expect(actual.csv).toContain("Total Weight,0.01 lbs");
    expect(actual.csv).not.toContain("Renamed Inventory");
  });

  it.each([true, false])("refuses to delete a donor with history (explicit link: %s)", async (linked) => {
    const donor = await newDonor(`History Protected Farm ${linked}`);
    const tx = await donation({ donorId: linked ? donor.id : undefined, name: donor.name });
    const response = await fetch(`${base}/api/donors/${donor.id}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/inactive/i);
    expect((await t.pool.query("SELECT id FROM donors WHERE id = $1", [donor.id])).rows).toHaveLength(1);
    expect((await t.pool.query("SELECT donor_id FROM transactions WHERE id = $1", [tx.id])).rows[0].donor_id).toBe(linked ? donor.id : null);
    expect((await reports(donor.id)).history.map((row) => row.id)).toEqual([tx.id]);
  });

  it("rejects a blank-name edit without changing the donor and persists explicit contact clears", async () => {
    const donor = await newDonor("Editable Farm");
    await t.pool.query("UPDATE donors SET phone = '410-555-0100' WHERE id = $1", [donor.id]);
    const invalid = await fetch(`${base}/api/donors/${donor.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "   " }),
    });
    expect(invalid.status).toBe(400);
    const cleared = await fetch(`${base}/api/donors/${donor.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ id: donor.id, name: donor.name, phone: null });
  });
});
