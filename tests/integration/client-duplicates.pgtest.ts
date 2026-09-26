import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

// The duplicate person rule on real Postgres, through the create and the edit
// routes, so the candidate query and the shared normalisers are proven to agree.

const STAFF = "00000000-0000-4000-8000-00000000000d";

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

function send(method: string, path: string, body: unknown) {
  return fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function count() {
  return (await t.pool.query(`SELECT count(*)::int AS n FROM clients`)).rows[0].n;
}

describe("the duplicate person rule on Postgres", () => {
  it("creates a person, then refuses a second one sharing two normalised fields", async () => {
    const first = await send("POST", "/api/clients", {
      name: "Test Student Five",
      identifier: "T0000005",
      email: "five@example.invalid",
      phone: "410-555-0105",
    });
    expect(first.status).toBeLessThan(300);
    const before = await count();

    // Same name with other spacing and case, and the same phone written with a country code.
    const byNamePhone = await send("POST", "/api/clients", {
      name: "  test   STUDENT five ",
      identifier: "T0000055",
      email: "other@example.invalid",
      phone: "+1 (410) 555 0105",
    });
    expect(byNamePhone.status).toBe(409);
    expect((await byNamePhone.json()).message).toContain("already in");

    // Same email in other case and the same student ID, different name and phone.
    const byEmailId = await send("POST", "/api/clients", {
      name: "Test Student Fifty",
      identifier: "t0000005 ",
      email: " FIVE@example.invalid",
      phone: "410 555 0199",
    });
    expect(byEmailId.status).toBe(409);
    expect(await count()).toBe(before);
  });

  it("allows a person sharing only one field", async () => {
    const res = await send("POST", "/api/clients", {
      name: "Test Student Six",
      identifier: "T0000006",
      email: "six@example.invalid",
      phone: "410-555-0105",
    });
    expect(res.status).toBeLessThan(300);
  });

  it("refuses an edit that makes two people match, and allows an edit of the person itself", async () => {
    const seven = await (
      await send("POST", "/api/clients", {
        name: "Test Student Seven",
        identifier: "T0000007",
        email: "seven@example.invalid",
        phone: "410-555-0107",
      })
    ).json();

    const clash = await send("PATCH", `/api/clients/${seven.id}`, {
      name: "Test Student Five",
      email: "five@example.invalid",
    });
    expect(clash.status).toBe(409);
    const stored = (await t.pool.query(`SELECT name, email FROM clients WHERE id = $1`, [seven.id])).rows[0];
    expect(stored).toEqual({ name: "Test Student Seven", email: "seven@example.invalid" });

    const own = await send("PATCH", `/api/clients/${seven.id}`, { email: "seven.new@example.invalid" });
    expect(own.status).toBe(200);
  });
});
