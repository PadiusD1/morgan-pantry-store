import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

// Writes inside runIdempotent must use the transaction client it hands over.
// A donor written through the global pool survives a rollback, and a read that
// borrows a second pool connection starves when every connection holds a claim.

const STAFF = "00000000-0000-4000-8000-00000000000e";

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

async function post(path: string, body: unknown, key: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await t.pool.query(sql, params);
  return Number(rows[0].n);
}

describe("idempotent writes stay on the transaction client", () => {
  it("rolls the donor back when storing the response fails, then a retry creates one donor", async () => {
    await t.pool.query(`
      CREATE FUNCTION tx_test_fail_response() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.key = 'tx-donor-1' THEN RAISE EXCEPTION 'Synthetic response storage failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER tx_test_fail_response BEFORE UPDATE ON idempotency_keys
        FOR EACH ROW EXECUTE FUNCTION tx_test_fail_response();`);
    const donor = { name: "Test Donor Rollback", status: "active" };
    let first;
    try {
      first = await post("/api/donors", donor, "tx-donor-1");
    } finally {
      await t.pool.query(`DROP TRIGGER tx_test_fail_response ON idempotency_keys`);
      await t.pool.query(`DROP FUNCTION tx_test_fail_response()`);
    }
    expect(first.status).toBe(500);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE key = 'tx-donor-1'`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM donors WHERE name = $1`, [donor.name])).toBe(0);

    const retry = await post("/api/donors", donor, "tx-donor-1");
    expect(retry.status).toBe(201);
    expect(retry.body.name).toBe(donor.name);
    expect(await count(`SELECT count(*) AS n FROM donors WHERE name = $1`, [donor.name])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM idempotency_keys WHERE key = 'tx-donor-1'`)).toBe(1);
  });

  it("saves four overlapping client creates that hold every pool connection at once", async () => {
    // Each create waits at its key claim until all four hold a connection.
    await t.pool.query(`
      CREATE FUNCTION tx_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.key LIKE 'tx-pool-%' THEN PERFORM pg_advisory_xact_lock_shared(424242); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER tx_test_barrier BEFORE INSERT ON idempotency_keys
        FOR EACH ROW EXECUTE FUNCTION tx_test_barrier();`);
    const control = await t.pool.connect();
    let results: { status: number; body: any }[] = [];
    let blocked = 0;
    try {
      await control.query(`SELECT pg_advisory_lock(424242)`);
      const work = Promise.all(
        [1, 2, 3, 4].map((i) =>
          post(
            "/api/clients",
            {
              name: `Test Pool Student ${i}`,
              identifier: `TXPOOL${i}`,
              email: `txpool${i}@example.invalid`,
              phone: `555010000${i}`,
              clientType: "student",
            },
            `tx-pool-${i}`,
          ),
        ),
      );
      for (let i = 0; i < 200 && blocked < 4; i++) {
        blocked = Number(
          (
            await control.query(
              `SELECT count(*) AS n FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'
                  AND query LIKE 'INSERT INTO idempotency_keys%'`,
            )
          ).rows[0].n,
        );
        if (blocked < 4) await new Promise((r) => setTimeout(r, 20));
      }
      await control.query(`SELECT pg_advisory_unlock(424242)`);
      results = await work;
    } finally {
      await control.query(`SELECT pg_advisory_unlock_all()`).catch(() => undefined);
      control.release();
      await t.pool.query(`DROP TRIGGER tx_test_barrier ON idempotency_keys`);
      await t.pool.query(`DROP FUNCTION tx_test_barrier()`);
    }
    expect(blocked).toBe(4);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(await count(`SELECT count(*) AS n FROM clients WHERE identifier LIKE 'TXPOOL%'`)).toBe(4);
  });
});
