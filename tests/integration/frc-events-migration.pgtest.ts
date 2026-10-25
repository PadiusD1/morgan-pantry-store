/**
 * Migration 0003 and its rollback leave every earlier transaction exactly as
 * it was, and the rollback refuses once an event has been recorded.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const forward = () => readFileSync("migrations/0003_frc_events.sql", "utf8");
const rollback = () => readFileSync("migrations/rollback/0003_frc_events_rollback.sql", "utf8");

// The same read only fingerprint the production runbook takes before and after.
const FINGERPRINT = `
  SELECT (SELECT count(*)::int FROM transactions) AS transactions,
         (SELECT md5(coalesce(string_agg(concat_ws('|', id, type, "timestamp", source, donor, client_id, client_name, donor_id,
            is_emergency, latitude, longitude, accuracy, client_classification, created_at), ',' ORDER BY id), '')) FROM transactions) AS transaction_hash,
         (SELECT count(*)::int FROM transaction_items) AS lines,
         (SELECT md5(coalesce(string_agg(concat_ws('|', id, transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd), ',' ORDER BY id), '')) FROM transaction_items) AS line_hash,
         (SELECT md5(coalesce(string_agg(concat_ws('|', id, quantity, reserved_quantity), ',' ORDER BY id), '')) FROM inventory_items) AS stock_hash`;

let t: TestDb;
let item: string;

beforeAll(async () => {
  t = await createTestDb();
  item = (await t.pool.query("INSERT INTO inventory_items (name, quantity) VALUES ('Synthetic oats', 9) RETURNING id")).rows[0].id;
  for (const type of ["IN", "OUT", "OUT"]) {
    const id = (await t.pool.query("INSERT INTO transactions (type, client_name, donor) VALUES ($1, 'Synthetic Person', 'Synthetic Donor') RETURNING id", [type])).rows[0].id;
    await t.pool.query("INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd) VALUES ($1, $2, 'Synthetic oats', 2, '0.5', '1.25')", [id, item]);
  }
});

afterAll(async () => {
  await t?.drop();
});

const fingerprint = async () => (await t.pool.query(FINGERPRINT)).rows[0];
const hasColumn = async () => (await t.pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'event_id'")).rowCount === 1;
const tables = async () => (await t.pool.query("SELECT relname FROM pg_class WHERE relname IN ('frc_events', 'frc_event_sessions', 'frc_event_audit') AND relkind = 'r' ORDER BY relname")).rows.map((row) => row.relname);

describe("migration 0003 and its rollback", () => {
  it("adds the schema without changing a single earlier transaction, line or stock count", async () => {
    const before = await fingerprint();
    await t.pool.query(forward());
    expect(await fingerprint()).toEqual(before);
    expect(await hasColumn()).toBe(true);
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
  });

  it("rolls back cleanly while no event is recorded, and can be applied again", async () => {
    const before = await fingerprint();
    await t.pool.query(rollback());
    expect(await hasColumn()).toBe(false);
    expect(await tables()).toEqual([]);
    expect(await fingerprint()).toEqual(before);
    // A second run after a finished rollback is a no op, never a parse error.
    await t.pool.query(rollback());
    expect(await fingerprint()).toEqual(before);
    await t.pool.query(forward());
    expect(await hasColumn()).toBe(true);
  });

  it("refuses to roll back once a transaction names an event", async () => {
    const event = (await t.pool.query("INSERT INTO frc_events (name) VALUES ('Synthetic Recorded Event') RETURNING id")).rows[0].id;
    await t.pool.query("INSERT INTO transactions (type, client_name, event_id) VALUES ('OUT', 'Synthetic Person', $1)", [event]);
    // One connection, so the failed transaction block is ended on the same one.
    const connection = await t.pool.connect();
    try {
      await expect(connection.query(rollback())).rejects.toThrow(/roll back the application only/);
      await connection.query("ROLLBACK");
    } finally {
      connection.release();
    }
    expect(await hasColumn()).toBe(true);
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM transactions WHERE event_id = $1", [event])).rows[0].n).toBe(1);
  });
});
