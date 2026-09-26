import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

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
    const id = req.get("x-test-user");
    if (id) {
      req.user = { id, email: "", name: "Test Staff One", role: "staff", studentId: null };
    }
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

function post(path: string, body: unknown, key?: string, user = USER_A) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-user": user,
  };
  if (key) headers["idempotency-key"] = key;
  return fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function newItem(name: string, quantity = 10): Promise<string> {
  const { rows } = await t.pool.query(
    `INSERT INTO inventory_items (name, quantity) VALUES ($1, $2) RETURNING id`,
    [name, quantity],
  );
  return rows[0].id;
}

function checkIn(itemId: string, quantity: number) {
  return {
    type: "IN",
    source: "Test Donor One",
    items: [
      {
        inventoryItemId: itemId,
        name: "Test Item",
        quantity,
        weightPerUnitLbs: "1",
        valuePerUnitUsd: "1",
      },
    ],
  };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await t.pool.query(sql, params);
  return Number(rows[0].n);
}

describe("Idempotency-Key on release one write routes", () => {
  it("two concurrent identical check ins make exactly one record", async () => {
    const itemId = await newItem("Test Rice One", 10);
    const body = checkIn(itemId, 3);
    const [a, b] = await Promise.all([
      post("/api/transactions", body, "key-concurrent-1"),
      post("/api/transactions", body, "key-concurrent-1"),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(ja.id).toBe(jb.id);
    expect(
      await count(
        `SELECT count(*) AS n FROM transaction_items WHERE inventory_item_id = $1`,
        [itemId],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT quantity AS n FROM inventory_items WHERE id = $1`, [itemId]),
    ).toBe(13);
  });

  it("a later repeat gets the stored answer and writes nothing", async () => {
    const itemId = await newItem("Test Beans One", 5);
    const body = { ...checkIn(itemId, 2), type: "OUT" };
    const first = await post("/api/transactions", body, "key-repeat-1");
    const again = await post("/api/transactions", body, "key-repeat-1");
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(
      await count(`SELECT quantity AS n FROM inventory_items WHERE id = $1`, [itemId]),
    ).toBe(3);
  });

  it("the same key with a different body answers 422", async () => {
    const itemId = await newItem("Test Pasta One", 10);
    const first = await post("/api/transactions", checkIn(itemId, 1), "key-diff-1");
    const second = await post("/api/transactions", checkIn(itemId, 4), "key-diff-1");
    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
    expect(
      await count(`SELECT quantity AS n FROM inventory_items WHERE id = $1`, [itemId]),
    ).toBe(11);
  });

  it("keys are scoped by user", async () => {
    const body = { name: "Test Soup One", barcode: "5550000001" };
    const a = await post("/api/inventory", body, "key-user-1", USER_A);
    const b = await post("/api/inventory", { ...body, barcode: "5550000002" }, "key-user-1", USER_B);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).id).not.toBe((await b.json()).id);
  });

  it("two concurrent identical item creates make exactly one item", async () => {
    const body = { name: "Test Cereal One", barcode: "5550000003" };
    const [a, b] = await Promise.all([
      post("/api/inventory", body, "key-item-1"),
      post("/api/inventory", body, "key-item-1"),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(
      await count(`SELECT count(*) AS n FROM inventory_items WHERE barcode = $1`, [
        "5550000003",
      ]),
    ).toBe(1);
  });

  it("a failed write leaves the key free so a retry succeeds", async () => {
    const blocker = await newItem("Test Blocker One", 0);
    await t.pool.query(`UPDATE inventory_items SET barcode = $1 WHERE id = $2`, [
      "5550000004",
      blocker,
    ]);
    const body = { name: "Test Oats One", barcode: "5550000004" };
    const failed = await post("/api/inventory", body, "key-retry-1");
    expect(failed.status).toBe(500);
    expect(
      await count(`SELECT count(*) AS n FROM idempotency_keys WHERE key = $1`, ["key-retry-1"]),
    ).toBe(0);
    await t.pool.query(`DELETE FROM inventory_items WHERE id = $1`, [blocker]);
    const retry = await post("/api/inventory", body, "key-retry-1");
    expect(retry.status).toBe(201);
  });

  it("a request without the header is still accepted", async () => {
    const itemId = await newItem("Test Flour One", 1);
    const res = await post("/api/transactions", checkIn(itemId, 1));
    expect(res.status).toBe(201);
  });
});
