import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";
import { receiptFromFulfilled, receiptTotals } from "../../client/src/lib/receipt";

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
    req.user = { id: "00000000-0000-4000-8000-00000000000c", email: "", name: "Test Staff", role: "staff", studentId: null };
    next();
  });
  await registerRoutes(app);
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const { pool } = await import("../../server/pg");
  await pool.end();
  await t?.drop();
});

it("a partial fulfilment returns committed quantities and immutable receipt measurements", async () => {
  const { rows: [item] } = await t.pool.query(
    "INSERT INTO inventory_items (name, quantity, reserved_quantity, weight_per_unit_lbs, value_per_unit_usd) VALUES ('Receipt Rice', 10, 2, 1.5, 2) RETURNING id",
  );
  const { rows: [request] } = await t.pool.query(
    "INSERT INTO requests (client_name, client_identifier, reason, status) VALUES ('Receipt Student', 'TEST-RECEIPT', 'Synthetic receipt test', 'approved') RETURNING id",
  );
  const { rows: [line] } = await t.pool.query(
    "INSERT INTO request_items (request_id, inventory_item_id, item_name, requested_quantity, approved_quantity, reserved) VALUES ($1, $2, 'Receipt Rice', 2, 2, true) RETURNING id",
    [request.id, item.id],
  );
  const response = await fetch(`${base}/api/requests/${request.id}/fulfill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ id: line.id, fulfilledQuantity: 1 }] }),
  });
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.status).toBe("completed");
  expect(payload.transaction).toMatchObject({ id: payload.transactionId, type: "OUT" });
  expect(payload.transaction.items).toHaveLength(1);
  expect(payload.transaction.items[0]).toMatchObject({ inventoryItemId: item.id, quantity: 1 });
  expect(Number(payload.transaction.items[0].weightPerUnitLbs)).toBe(1.5);
  expect(Number(payload.transaction.items[0].valuePerUnitUsd)).toBe(2);
  const receipt = receiptFromFulfilled(payload, "2000-01-01T00:00:00.000Z");
  expect(receipt).not.toBeNull();
  expect(receiptTotals(receipt!)).toEqual({ units: 1, weightLbs: 1.5, valueCents: 200, unweighedUnits: 0, unvaluedUnits: 0 });
  await t.pool.query("UPDATE inventory_items SET weight_per_unit_lbs = 99, value_per_unit_usd = 99 WHERE id = $1", [item.id]);
  const { rows: saved } = await t.pool.query(
    "SELECT quantity, weight_per_unit_lbs, value_per_unit_usd FROM transaction_items WHERE transaction_id = $1",
    [payload.transactionId],
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].quantity).toBe(1);
  expect(Number(saved[0].weight_per_unit_lbs)).toBe(1.5);
  expect(Number(saved[0].value_per_unit_usd)).toBe(2);
  const { rows: [stock] } = await t.pool.query("SELECT quantity, reserved_quantity FROM inventory_items WHERE id = $1", [item.id]);
  expect(stock).toEqual({ quantity: 9, reserved_quantity: 0 });
});
