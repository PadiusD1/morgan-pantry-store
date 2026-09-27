import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

// The monthly summary groups check outs by their calendar month in Baltimore,
// whatever zone the server runs in (the suite runs with TZ=UTC like Vercel).

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
  await new Promise<void>((r) => server?.close(() => r()));
  const { pool } = await import("../../server/pg");
  await pool.end();
  await t?.drop();
});

async function checkOutAt(iso: string, itemName: string, quantity: number, value: string) {
  const item = await t.pool.query(
    `INSERT INTO inventory_items (name, quantity) VALUES ($1, 100) RETURNING id`,
    [itemName],
  );
  const tx = await t.pool.query(
    `INSERT INTO transactions (type, timestamp) VALUES ('OUT', $1) RETURNING id`,
    [iso],
  );
  await t.pool.query(
    `INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [tx.rows[0].id, item.rows[0].id, itemName, quantity, value],
  );
}

function section(csv: string, heading: string): string {
  const start = csv.indexOf(`Month,${heading}`);
  if (start < 0) return "";
  const end = csv.indexOf("\nMonth,", start + 1);
  return end < 0 ? csv.slice(start) : csv.slice(start, end);
}

describe("monthly summary CSV month boundaries", () => {
  it("puts an 8.30 PM Eastern check out on September 30 in September and a 12.30 AM Eastern one on October 1 in October", async () => {
    await checkOutAt("2026-10-01T00:30:00Z", "Late Rice", 2, "3.00");
    await checkOutAt("2026-10-01T04:30:00Z", "Early Beans", 5, "1.00");
    await checkOutAt("2027-01-01T03:00:00Z", "New Year Eve Soup", 1, "4.00");

    const res = await fetch(`${base}/api/reports/monthly-csv`);
    expect(res.status).toBe(200);
    const csv = await res.text();

    const september = section(csv, "September 2026");
    const october = section(csv, "October 2026");
    const december = section(csv, "December 2026");
    expect(september).toContain("Late Rice,2,3.00,6.00");
    expect(september).not.toContain("Early Beans");
    expect(october).toContain("Early Beans,5,1.00,5.00");
    expect(october).not.toContain("Late Rice");
    expect(december).toContain("New Year Eve Soup,1,4.00,4.00");
    expect(csv).not.toContain("January 2027");

    const only2026 = await (await fetch(`${base}/api/reports/monthly-csv?year=2026`)).text();
    expect(only2026).toContain("New Year Eve Soup");
    expect(only2026).toContain("2026 GRAND TOTAL,,,,15.00");
  });
});
