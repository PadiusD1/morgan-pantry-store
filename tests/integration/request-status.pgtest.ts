import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const STAFF = "00000000-0000-4000-8000-00000000000c";
const STUDENT = "00000000-0000-4000-8000-00000000000d";

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
    req.user = req.headers["x-test-student"]
      ? { id: STUDENT, email: "", name: "Test Student One", role: "student", studentId: "T0000001" }
      : { id: STAFF, email: "", name: "Test Staff One", role: "staff", studentId: null };
    next();
  });
  await registerRoutes(app);
  const { registerPortalRoutes } = await import("../../server/portal");
  registerPortalRoutes(app);
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

/** A pending request for 2 units of an item of 10 with nothing reserved. */
async function pendingRequest() {
  const item = (
    await t.pool.query(
      `INSERT INTO inventory_items (name, quantity) VALUES ('Test Beans One', 10) RETURNING id`,
    )
  ).rows[0].id;
  const request = (
    await t.pool.query(
      `INSERT INTO requests (client_name, client_identifier, reason, status)
       VALUES ('Test Student One', 'T0000001', 'Test reason', 'pending') RETURNING id`,
    )
  ).rows[0].id;
  await t.pool.query(
    `INSERT INTO request_items (request_id, inventory_item_id, item_name, requested_quantity)
     VALUES ($1, $2, 'Test Beans One', 2)`,
    [request, item],
  );
  return { item, request };
}

/** Holds a row lock in an open transaction until the returned function commits it. */
async function hold(sql: string, id: string) {
  const c = await t.pool.connect();
  await c.query("BEGIN");
  await c.query(sql, [id]);
  return async () => {
    await c.query("COMMIT");
    c.release();
  };
}

/** Waits up to 3 seconds for n backends of this database to wait on a lock. */
async function lockWaiters(n: number) {
  for (let i = 0; i < 150; i++) {
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= n) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

async function approvals(request: string) {
  const { rows } = await t.pool.query(
    `SELECT count(*)::int AS n FROM request_audit_log WHERE request_id = $1 AND action = 'approved'`,
    [request],
  );
  return rows[0].n;
}

async function statusOf(request: string) {
  const { rows } = await t.pool.query(`SELECT status FROM requests WHERE id = $1`, [request]);
  return rows[0].status;
}

describe("approval claims the request inside its transaction", () => {
  it("two overlapping approvals of one pending request, one wins and stock is reserved once", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const a = post(`/api/requests/${request}/approve`);
    const b = post(`/api/requests/${request}/approve`);
    const bothWaited = await lockWaiters(2);
    await release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(bothWaited).toBe(true);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect((await loser.json()).message).toBe("This request was already changed");
    expect(await statusOf(request)).toBe("approved");
    expect(await stock(item)).toEqual([10, 2]);
    expect(await approvals(request)).toBe(1);
  });

  it("approval first then a staff cancel ends cancelled with nothing reserved", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const approve = post(`/api/requests/${request}/approve`);
    await lockWaiters(1);
    const cancel = post(`/api/requests/${request}/cancel`);
    await lockWaiters(2);
    await release();
    const [ra, rc] = await Promise.all([approve, cancel]);
    expect(rc.status).toBe(200);
    expect([200, 409]).toContain(ra.status);
    expect(await statusOf(request)).toBe("cancelled");
    expect(await stock(item)).toEqual([10, 0]);
    expect(await approvals(request)).toBe(ra.status === 200 ? 1 : 0);
  });

  it("a staff cancel landing after an approval audits the approved status it claimed", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const approve = post(`/api/requests/${request}/approve`);
    await lockWaiters(1);
    const cancel = post(`/api/requests/${request}/cancel`);
    const bothWaited = await lockWaiters(2);
    await release();
    const [ra, rc] = await Promise.all([approve, cancel]);
    expect(bothWaited).toBe(true);
    expect(ra.status).toBe(200);
    expect(rc.status).toBe(200);
    const { rows } = await t.pool.query(
      `SELECT previous_status FROM request_audit_log WHERE request_id = $1 AND action = 'cancelled'`,
      [request],
    );
    expect(rows.map((r) => r.previous_status)).toEqual(["approved"]);
  });

  it("a staff cancel first then an approval, the approval gets 409 and reserves nothing", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM requests WHERE id = $1 FOR UPDATE`, request);
    const cancel = post(`/api/requests/${request}/cancel`);
    await lockWaiters(1);
    const approve = post(`/api/requests/${request}/approve`);
    const bothWaited = await lockWaiters(2);
    await release();
    const [rc, ra] = await Promise.all([cancel, approve]);
    expect(bothWaited).toBe(true);
    expect(rc.status).toBe(200);
    expect(ra.status).toBe(409);
    expect((await ra.json()).message).toBe("This request was already changed");
    expect(await statusOf(request)).toBe("cancelled");
    expect(await stock(item)).toEqual([10, 0]);
    expect(await approvals(request)).toBe(0);
  });
});

describe("deny, review, ready and the student cancel take the same claim", () => {
  function studentPost(path: string) {
    return fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-student": "1" },
      body: "{}",
    });
  }

  it("a student cancel racing an approval never leaves a cancelled request holding stock", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const approve = post(`/api/requests/${request}/approve`);
    await lockWaiters(1);
    const cancel = studentPost(`/api/portal/requests/${request}/cancel`);
    const bothWaited = await lockWaiters(2);
    await release();
    const [ra, rc] = await Promise.all([approve, cancel]);
    expect(bothWaited).toBe(true);
    expect(ra.status).toBe(200);
    expect(rc.status).toBe(409);
    expect(await statusOf(request)).toBe("approved");
    expect(await stock(item)).toEqual([10, 2]);
  });

  it("a deny racing an approval loses with 409 and leaves the approval intact", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const approve = post(`/api/requests/${request}/approve`);
    await lockWaiters(1);
    const deny = post(`/api/requests/${request}/deny`, { adminNote: "Test note" });
    const bothWaited = await lockWaiters(2);
    await release();
    const [ra, rd] = await Promise.all([approve, deny]);
    expect(bothWaited).toBe(true);
    expect(ra.status).toBe(200);
    expect(rd.status).toBe(409);
    expect(await statusOf(request)).toBe("approved");
    expect(await stock(item)).toEqual([10, 2]);
  });

  it("a review racing an approval loses with 409", async () => {
    const { item, request } = await pendingRequest();
    const release = await hold(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, item);
    const approve = post(`/api/requests/${request}/approve`);
    await lockWaiters(1);
    const review = post(`/api/requests/${request}/review`);
    await lockWaiters(2);
    await release();
    const [ra, rr] = await Promise.all([approve, review]);
    expect(ra.status).toBe(200);
    expect(rr.status).toBe(409);
    expect(await statusOf(request)).toBe("approved");
  });

  it("ready after a staff cancel answers 409 and keeps the request cancelled", async () => {
    const { item, request } = await approvedRequest();
    const release = await hold(`SELECT id FROM requests WHERE id = $1 FOR UPDATE`, request);
    const cancel = post(`/api/requests/${request}/cancel`);
    await lockWaiters(1);
    const ready = post(`/api/requests/${request}/ready`);
    const bothWaited = await lockWaiters(2);
    await release();
    const [rc, rr] = await Promise.all([cancel, ready]);
    expect(bothWaited).toBe(true);
    expect(rc.status).toBe(200);
    expect(rr.status).toBe(409);
    expect(await statusOf(request)).toBe("cancelled");
    expect(await stock(item)).toEqual([10, 0]);
  });
});
