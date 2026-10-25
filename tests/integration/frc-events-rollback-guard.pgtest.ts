/**
 * The 0003 rollback deletes no event data nobody approved. It write locks every
 * table it reads or drops before checking anything, and it drops the three event
 * tables only while they are empty or hold exactly the content whose digest was
 * approved, computed by migrations/rollback/0003_frc_events_rollback_digest.sql.
 * Synthetic data only.
 */
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const forward = () => readFileSync("migrations/0003_frc_events.sql", "utf8");
const rollback = () => readFileSync("migrations/rollback/0003_frc_events_rollback.sql", "utf8");
const digestSql = () => readFileSync("migrations/rollback/0003_frc_events_rollback_digest.sql", "utf8");

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await t.pool.query(forward());
});

afterAll(async () => {
  await t?.drop();
});

const tables = async () =>
  (await t.pool.query("SELECT relname FROM pg_class WHERE relname IN ('frc_events', 'frc_event_sessions', 'frc_event_audit') AND relkind = 'r' ORDER BY relname")).rows.map((row) => row.relname);

/** The approved export, digest and content from one read only statement. */
async function approvedExport(): Promise<{ digest: string; frc_events: string }> {
  const results = await t.pool.query(digestSql());
  const select = (Array.isArray(results) ? results : [results]).find((r) => r.command === "SELECT");
  return select!.rows[0];
}

/** Runs the rollback on one connection, with an approved digest when given. */
async function runRollback(digest?: string): Promise<void> {
  const c: PoolClient = await t.pool.connect();
  try {
    if (digest) await c.query(`SET frc.rollback_approved_digest = '${digest.replace(/[^0-9a-f]/g, "")}'`);
    try {
      await c.query(rollback());
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    }
  } finally {
    await c.query("RESET frc.rollback_approved_digest");
    c.release();
  }
}

async function addEvent(name: string): Promise<string> {
  const id = (await t.pool.query("INSERT INTO frc_events (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
  await t.pool.query("INSERT INTO frc_event_audit (event_id, action) VALUES ($1, 'created')", [id]);
  return id;
}

describe("the 0003 rollback guard", () => {
  it("drops empty event tables with no approval needed, and passes again as a no op", async () => {
    await runRollback();
    expect(await tables()).toEqual([]);
    await runRollback();
    await t.pool.query(forward());
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
  });

  it("refuses to drop event tables that hold content nobody approved", async () => {
    await addEvent("Synthetic Unapproved Event");
    await expect(runRollback()).rejects.toThrow(/not the approved export/);
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
  });

  it("refuses when the content changed after its export was approved", async () => {
    const approved = await approvedExport();
    expect(approved.frc_events).toContain("Synthetic Unapproved Event");
    await addEvent("Synthetic Later Event");
    await expect(runRollback(approved.digest)).rejects.toThrow(/not the approved export/);
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
  });

  it("stops at its first lock while a writer is still open, before any check runs", async () => {
    const writer = await t.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("INSERT INTO transactions (type, client_name) VALUES ('OUT', 'Synthetic Person')");
      const error = await runRollback().then(() => null, (e) => e);
      expect(error?.message).toMatch(/lock timeout/);
      expect(String(error?.where)).toMatch(/LOCK TABLE public\.transactions/);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
    expect(await tables()).toEqual(["frc_event_audit", "frc_event_sessions", "frc_events"]);
  });

  it("drops the event tables when the approved digest matches their content", async () => {
    const approved = await approvedExport();
    expect(approved.frc_events).toContain("Synthetic Later Event");
    await runRollback(approved.digest);
    expect(await tables()).toEqual([]);
  });
});
