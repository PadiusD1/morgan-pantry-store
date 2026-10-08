import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

describe("report API regression cases", () => {
  it("rejects invalid year queries before generating an export", async () => {
    for (const query of ["year=hello", "year=2026&year=2025", "year=2026%0D%0Aextra"]) {
      const response = await fetch(`${base}/api/reports/monthly-csv?${query}`);
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain("reporting year");
    }
  });

  it("counts a multi-item emergency once and weights historical unit values", async () => {
    const rice = (await t.pool.query("INSERT INTO inventory_items (name, category, quantity) VALUES ('Weighted Rice', 'Grains', 100) RETURNING id")).rows[0].id;
    const beans = (await t.pool.query("INSERT INTO inventory_items (name, category, quantity) VALUES ('Emergency Beans', 'Grains', 100) RETURNING id")).rows[0].id;
    const emergency = (await t.pool.query("INSERT INTO transactions (type, timestamp, is_emergency) VALUES ('OUT', '2028-05-03T18:00:00Z', true) RETURNING id")).rows[0].id;
    const regular = (await t.pool.query("INSERT INTO transactions (type, timestamp) VALUES ('OUT', '2028-05-04T18:00:00Z') RETURNING id")).rows[0].id;
    await t.pool.query(`INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
      VALUES ($1, $3, 'Weighted Rice', 2, 1, 1), ($1, $4, 'Emergency Beans', 1, 1, 5), ($2, $3, 'Weighted Rice', 4, 1, 2.5)`, [emergency, regular, rice, beans]);
    const response = await fetch(`${base}/api/reports/monthly-csv?year=2028`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain("Grains,Weighted Rice,6,2.00,12.00");
    expect(csv).toContain("Emergency Shop Appointments,1\r\n");
    expect(csv).toContain("2028 Emergency Shop Appointments,,,,1");
    expect(csv).toContain("2028 GRAND TOTAL,,,,17.00");
    const onlyEmergency = await (await fetch(`${base}/api/reports/monthly-csv?year=2028&emergency=1`)).text();
    expect(onlyEmergency).toContain("Grains,Weighted Rice,2,1.00,2.00");
    expect(onlyEmergency).toContain("2028 GRAND TOTAL,,,,7.00");
  });

  it("returns a retryable error instead of fabricated zero emergency statistics", async () => {
    const { pool } = await import("../../server/pg");
    const query = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("Simulated report query failure") as never);
    try {
      const response = await fetch(`${base}/api/reports/emergencies`);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.message).toContain("retry");
      expect(body).not.toHaveProperty("totalEmergencies");
    } finally { query.mockRestore(); }
  });
});
