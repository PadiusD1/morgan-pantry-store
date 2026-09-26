import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const USER_A = "00000000-0000-4000-8000-00000000000a";

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

function send(method: string, path: string, body: unknown, key?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-user": USER_A,
  };
  if (key) headers["idempotency-key"] = key;
  return fetch(base + path, { method, headers, body: JSON.stringify(body) });
}

async function newItem(name: string, quantity = 10): Promise<string> {
  const { rows } = await t.pool.query(
    `INSERT INTO inventory_items (name, quantity) VALUES ($1, $2) RETURNING id`,
    [name, quantity],
  );
  return rows[0].id;
}

async function stock(itemId: string): Promise<number> {
  const { rows } = await t.pool.query(`SELECT quantity FROM inventory_items WHERE id = $1`, [itemId]);
  return rows[0].quantity;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await t.pool.query(sql, params);
  return Number(rows[0].n);
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

describe("stock changes travel as a difference", () => {
  it("a check in of 80 then a plus one from a stale page leaves the stock 81 above the start", async () => {
    const id = await newItem("Test Rice One", 5);
    const inRes = await send("POST", "/api/transactions", checkIn(id, 80), "stock-in-1");
    expect(inRes.status).toBeLessThan(300);
    // The stale page still shows 5 and sends only its plus one.
    const adj = await send("POST", `/api/inventory/${id}/adjust`, { delta: 1 }, "stock-adj-1");
    expect(adj.status).toBe(200);
    expect((await adj.json()).quantity).toBe(86);
    expect(await stock(id)).toBe(86);
    const { rows } = await t.pool.query(
      `SELECT delta, quantity_before, quantity_after, user_id FROM stock_adjustments WHERE inventory_item_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ delta: 1, quantity_before: 85, quantity_after: 86, user_id: USER_A }]);
    expect(
      await count(
        `SELECT count(*) AS n FROM transaction_items WHERE inventory_item_id = $1`,
        [id],
      ),
    ).toBe(1);
  });

  it("two concurrent adjusts both apply", async () => {
    const id = await newItem("Test Beans One", 10);
    const [a, b] = await Promise.all([
      send("POST", `/api/inventory/${id}/adjust`, { delta: 1 }, "stock-par-a"),
      send("POST", `/api/inventory/${id}/adjust`, { delta: -3 }, "stock-par-b"),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await stock(id)).toBe(8);
    expect(
      await count(`SELECT count(*) AS n FROM stock_adjustments WHERE inventory_item_id = $1`, [id]),
    ).toBe(2);
  });

  it("the same key twice applies the adjust once", async () => {
    const id = await newItem("Test Pasta One", 10);
    const first = await send("POST", `/api/inventory/${id}/adjust`, { delta: 2 }, "stock-twice");
    const again = await send("POST", `/api/inventory/${id}/adjust`, { delta: 2 }, "stock-twice");
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await stock(id)).toBe(12);
  });

  it("an adjust below zero answers 409 and leaves the stock unchanged", async () => {
    const id = await newItem("Test Soup One", 2);
    const res = await send("POST", `/api/inventory/${id}/adjust`, { delta: -3 }, "stock-neg");
    expect(res.status).toBe(409);
    expect(await stock(id)).toBe(2);
    expect(
      await count(`SELECT count(*) AS n FROM stock_adjustments WHERE inventory_item_id = $1`, [id]),
    ).toBe(0);
  });

  it("a PATCH with a bare quantity is refused", async () => {
    const id = await newItem("Test Corn One", 7);
    const res = await send("PATCH", `/api/inventory/${id}`, { quantity: 1 });
    expect(res.status).toBe(400);
    expect(await stock(id)).toBe(7);
    const named = await send("PATCH", `/api/inventory/${id}`, { name: "Test Corn Two" });
    expect(named.status).toBe(200);
    expect(await stock(id)).toBe(7);
  });

  it("an Edit with a stale expectedQuantity answers 409, a current one sets the count and records it", async () => {
    const id = await newItem("Test Oats One", 7);
    await send("POST", `/api/inventory/${id}/adjust`, { delta: 3 }, "stock-edit-adj");
    const stale = await send("PATCH", `/api/inventory/${id}`, { quantity: 4, expectedQuantity: 7 });
    expect(stale.status).toBe(409);
    expect(await stock(id)).toBe(10);
    const ok = await send("PATCH", `/api/inventory/${id}`, { quantity: 4, expectedQuantity: 10 });
    expect(ok.status).toBe(200);
    expect(await stock(id)).toBe(4);
    const { rows } = await t.pool.query(
      `SELECT delta, quantity_before, quantity_after, reason FROM stock_adjustments
        WHERE inventory_item_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(rows[rows.length - 1]).toEqual({ delta: -6, quantity_before: 10, quantity_after: 4, reason: "edit" });
    expect(
      await count(`SELECT count(*) AS n FROM transaction_items WHERE inventory_item_id = $1`, [id]),
    ).toBe(0);
  });
});

describe("a line above the quantity limit is refused", () => {
  it("answers 400 for 10001 units and for a scanner code, writes nothing, and takes 10000", async () => {
    const id = await newItem("Test Oats One", 12);
    for (const [quantity, key] of [
      [10001, "limit-over-1"],
      [52000000200029, "limit-over-2"],
    ] as const) {
      const res = await send("POST", "/api/transactions", checkIn(id, quantity), key);
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain("10000");
    }
    expect(await stock(id)).toBe(12);
    expect(
      await count(`SELECT count(*) AS n FROM transaction_items WHERE inventory_item_id = $1`, [id]),
    ).toBe(0);
    const ok = await send("POST", "/api/transactions", checkIn(id, 10000), "limit-at-1");
    expect(ok.status).toBeLessThan(300);
    expect(await stock(id)).toBe(10012);
  });
});
