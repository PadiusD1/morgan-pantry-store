import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const STAFF = "00000000-0000-4000-8000-00000000000c";

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
    req.user = { id: STAFF, email: "", name: "Test Staff One", role: "staff", studentId: null };
    next();
  });
  await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ message: String(err?.message ?? err) });
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const { pool } = await import("../../server/pg");
  await pool.end();
  await t?.drop();
});

function post(path: string, body: unknown = {}) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** An approved request holding a reservation of 2 on an item of 10. */
async function approvedRequest(deadline: string | null = null) {
  const item = (
    await t.pool.query(
      `INSERT INTO inventory_items (name, quantity, reserved_quantity)
       VALUES ('Test Rice One', 10, 2) RETURNING id`,
    )
  ).rows[0].id;
  const request = (
    await t.pool.query(
      `INSERT INTO requests (client_name, client_identifier, reason, status, pickup_deadline)
       VALUES ('Test Student One', 'T0000001', 'Test reason', 'approved', $1) RETURNING id`,
      [deadline],
    )
  ).rows[0].id;
  await t.pool.query(
    `INSERT INTO request_items
       (request_id, inventory_item_id, item_name, requested_quantity, approved_quantity, reserved)
     VALUES ($1, $2, 'Test Rice One', 2, 2, true)`,
    [request, item],
  );
  return { item, request };
}

async function stock(item: string) {
  const { rows } = await t.pool.query(
    `SELECT quantity, reserved_quantity FROM inventory_items WHERE id = $1`,
    [item],
  );
  return [rows[0].quantity, rows[0].reserved_quantity];
}

/** One 200. The loser lost the conditional update (409) or read the final status in the existing check (400). */
function expectOneWinner(a: number, b: number) {
  expect([a, b].filter((s) => s === 200)).toHaveLength(1);
  expect([400, 409]).toContain(a === 200 ? b : a);
}

describe("request status changes are conditional updates", () => {
  it("two concurrent fulfils of one request, exactly one wins", async () => {
    const { item, request } = await approvedRequest();
    const [a, b] = await Promise.all([
      post(`/api/requests/${request}/fulfill`),
      post(`/api/requests/${request}/fulfill`),
    ]);
    expectOneWinner(a.status, b.status);
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM transaction_items WHERE inventory_item_id = $1`,
      [item],
    );
    expect(rows[0].n).toBe(1);
    expect(await stock(item)).toEqual([8, 0]);
  });

  it("a fulfil racing a cancel leaves one consistent outcome", async () => {
    const { item, request } = await approvedRequest();
    const [f, c] = await Promise.all([
      post(`/api/requests/${request}/fulfill`),
      post(`/api/requests/${request}/cancel`),
    ]);
    const statuses = [f.status, c.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    // The loser either lost the conditional update (409) or already read the
    // final status in the existing check (400).
    expect([400, 409]).toContain(statuses.find((s) => s !== 200));
    const { rows } = await t.pool.query(`SELECT status FROM requests WHERE id = $1`, [request]);
    if (f.status === 200) {
      expect(rows[0].status).toBe("completed");
      expect(await stock(item)).toEqual([8, 0]);
    } else {
      expect(rows[0].status).toBe("cancelled");
      expect(await stock(item)).toEqual([10, 0]);
    }
  });

  it("two concurrent no shows release the reservation once", async () => {
    const { item, request } = await approvedRequest();
    await t.pool.query(`UPDATE inventory_items SET reserved_quantity = 5 WHERE id = $1`, [item]);
    const [a, b] = await Promise.all([
      post(`/api/requests/${request}/no-show`),
      post(`/api/requests/${request}/no-show`),
    ]);
    expectOneWinner(a.status, b.status);
    expect(await stock(item)).toEqual([10, 3]);
  });

  it("two concurrent cancels release the reservation once", async () => {
    const { item, request } = await approvedRequest();
    await t.pool.query(`UPDATE inventory_items SET reserved_quantity = 5 WHERE id = $1`, [item]);
    const [a, b] = await Promise.all([
      post(`/api/requests/${request}/cancel`),
      post(`/api/requests/${request}/cancel`),
    ]);
    expectOneWinner(a.status, b.status);
    expect(await stock(item)).toEqual([10, 3]);
  });

  it("the auto expiry in the list skips a row already moved and keeps serving", async () => {
    const { item, request } = await approvedRequest("2020-01-01T00:00:00.000Z");
    await t.pool.query(`UPDATE inventory_items SET reserved_quantity = 5 WHERE id = $1`, [item]);
    const [a, b] = await Promise.all([
      fetch(`${base}/api/requests`),
      fetch(`${base}/api/requests`),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const { rows } = await t.pool.query(`SELECT status FROM requests WHERE id = $1`, [request]);
    expect(rows[0].status).toBe("expired");
    expect(await stock(item)).toEqual([10, 3]);
  });
});

describe("a fulfilled request copies the student's classification", () => {
  async function fulfilledClassification(request: string) {
    const res = await post(`/api/requests/${request}/fulfill`);
    expect(res.status).toBe(200);
    const { rows } = await t.pool.query(
      `SELECT t.client_classification FROM requests r JOIN transactions t ON t.id = r.transaction_id
       WHERE r.id = $1`,
      [request],
    );
    return rows[0].client_classification;
  }

  it("writes the classification of the request's client onto the check out", async () => {
    const client = (
      await t.pool.query(
        `INSERT INTO clients (name, identifier, classification)
         VALUES ('Test Student Two', 'T0000002', 'Junior') RETURNING id`,
      )
    ).rows[0].id;
    const { request } = await approvedRequest();
    await t.pool.query(`UPDATE requests SET client_id = $1 WHERE id = $2`, [client, request]);
    expect(await fulfilledClassification(request)).toBe("Junior");
  });

  it("leaves it empty when the request has no client or the value is not on the list", async () => {
    const { request } = await approvedRequest();
    expect(await fulfilledClassification(request)).toBeNull();

    const client = (
      await t.pool.query(
        `INSERT INTO clients (name, identifier, classification)
         VALUES ('Test Student Three', 'T0000003', 'Test value not listed') RETURNING id`,
      )
    ).rows[0].id;
    const other = await approvedRequest();
    await t.pool.query(`UPDATE requests SET client_id = $1 WHERE id = $2`, [client, other.request]);
    expect(await fulfilledClassification(other.request)).toBeNull();
  });
});
