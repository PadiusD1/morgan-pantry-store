import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, migration0001, type TestDb } from "../helpers/pg";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t?.drop();
});

async function columns(table: string) {
  const { rows } = await t.pool.query(
    `SELECT column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') AS d
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY column_name`,
    [table],
  );
  return rows;
}

describe("migration 0001_release_one", () => {
  it("runs a second time cleanly", async () => {
    await t.pool.query(migration0001());
    await t.pool.query(migration0001());
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('idx_idempotency_keys_created_at', 'idx_stock_adjustments_inventory_item_id')`,
    );
    expect(rows[0].n).toBe(2);
  });

  it("creates idempotency_keys with the planned types and key", async () => {
    const cols = await columns("idempotency_keys");
    expect(cols.map((c) => [c.column_name, c.udt_name, c.is_nullable])).toEqual([
      ["created_at", "timestamptz", "NO"],
      ["key", "text", "NO"],
      ["request_hash", "text", "NO"],
      ["response_body", "jsonb", "YES"],
      ["response_status", "int4", "YES"],
      ["user_id", "uuid", "NO"],
    ]);
    expect(cols.find((c) => c.column_name === "created_at").d).toBe("now()");
    const { rows } = await t.pool.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'`,
    );
    expect(rows[0].d).toBe("PRIMARY KEY (user_id, key)");
    const users = await columns("users");
    expect(users.find((c) => c.column_name === "id").udt_name).toBe("uuid");
  });

  it("creates stock_adjustments tied to inventory_items", async () => {
    const cols = await columns("stock_adjustments");
    expect(cols.map((c) => [c.column_name, c.udt_name])).toEqual([
      ["created_at", "timestamptz"],
      ["delta", "int4"],
      ["id", "uuid"],
      ["inventory_item_id", "uuid"],
      ["quantity_after", "int4"],
      ["quantity_before", "int4"],
      ["reason", "text"],
      ["user_id", "uuid"],
    ]);
    const { rows } = await t.pool.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'stock_adjustments'::regclass AND contype = 'f'`,
    );
    expect(rows.map((r) => r.d)).toEqual([
      "FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)",
    ]);
  });

  it("adds the two nullable classification columns", async () => {
    const c = (await columns("clients")).find((x) => x.column_name === "classification");
    const tx = (await columns("transactions")).find(
      (x) => x.column_name === "client_classification",
    );
    expect([c?.udt_name, c?.is_nullable]).toEqual(["text", "YES"]);
    expect([tx?.udt_name, tx?.is_nullable]).toEqual(["text", "YES"]);
  });

  it("leaves row level security off and grants nothing to PUBLIC", async () => {
    const { rows } = await t.pool.query(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('idempotency_keys', 'stock_adjustments') ORDER BY relname`,
    );
    expect(rows.map((r) => r.relrowsecurity)).toEqual([false, false]);
    const grants = await t.pool.query(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_name IN ('idempotency_keys', 'stock_adjustments') AND grantee = 'PUBLIC'`,
    );
    expect(grants.rows[0].n).toBe(0);
  });

  it("leaves the 169 existing columns unchanged", async () => {
    const expected: Record<string, string>[] = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "..", "fixtures", "local-0000-columns.json"),
        "utf8",
      ),
    );
    expect(expected).toHaveLength(169);
    const tables = Array.from(new Set(expected.map((c) => c.table_name)));
    const { rows } = await t.pool.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable,
              coalesce(column_default, '') AS d
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
          AND NOT (table_name = 'clients' AND column_name = 'classification')
          AND NOT (table_name = 'transactions' AND column_name = 'client_classification')`,
      [tables],
    );
    const key = (c: Record<string, string>) => `${c.table_name}.${c.column_name}`;
    const norm = (c: Record<string, string>) => ({
      table_name: c.table_name,
      column_name: c.column_name,
      data_type: c.data_type,
      udt_name: c.udt_name,
      is_nullable: c.is_nullable,
      d: c.d,
    });
    const sort = (a: Record<string, string>, b: Record<string, string>) =>
      key(a).localeCompare(key(b));
    expect(rows.map(norm).sort(sort)).toEqual(expected.map(norm).sort(sort));
  });
});
