/**
 * Events end to end through the real middleware: sign in, the session cookie,
 * the access guard, the event routes and the transaction routes, against
 * PostgreSQL 17 with migrations 0000 to 0003. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

const PASSWORD = "synthetic-password-1";
const ACCOUNTS = {
  admin: "admin@frc-events.invalid",
  staff: "staff@frc-events.invalid",
  staffTwo: "staff.two@frc-events.invalid",
  volunteer: "volunteer@frc-events.invalid",
  student: "student.events@example.edu",
} as const;
type Account = keyof typeof ACCOUNTS;
const migration0003 = () => readFileSync("migrations/0003_frc_events.sql", "utf8");

let t: TestDb;
let server: Server;
let base: string;
let rice: string;
let beans: string;
let studentClient: string;
let partnerClient: string;
let historical: string;
let resetReadiness: () => void;

// Sign in is rate limited per address, so each account signs in once and a
// test that needs a second session asks for a fresh one explicitly.
const sessions = new Map<Account, string>();
async function login(account: Account): Promise<string> {
  const known = sessions.get(account);
  if (known) return known;
  const cookie = await freshLogin(account);
  sessions.set(account, cookie);
  return cookie;
}

async function freshLogin(account: Account): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ACCOUNTS[account], password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /frc_session=([^;]+)/.exec(cookie)?.[1];
  expect(token).toBeTruthy();
  return `frc_session=${token}`;
}

async function api(method: string, path: string, cookie: string | null, body?: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers["idempotency-key"] = key;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

function checkout(itemId: string, quantity: number, extra: Record<string, unknown> = {}) {
  return {
    type: "OUT", clientId: studentClient, clientName: "Synthetic Student One",
    items: [{ inventoryItemId: itemId, name: "Synthetic line", quantity, weightPerUnitLbs: "1.5000", valuePerUnitUsd: "2.25" }],
    ...extra,
  };
}

async function stock(id: string): Promise<number> {
  return (await t.pool.query("SELECT quantity FROM inventory_items WHERE id = $1", [id])).rows[0].quantity;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await t.pool.query(sql, params)).rows[0].n);
}
async function createEvent(cookie: string, name: string, startsAt = new Date().toISOString()) {
  const res = await api("POST", "/api/frc-events", cookie, { name, startsAt }, randomUUID());
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string };
}

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.COOKIE_SECURE = "false";
  const hash = await bcrypt.hash(PASSWORD, 4);
  for (const [account, email] of Object.entries(ACCOUNTS)) {
    const role = account === "staffTwo" ? "staff" : account;
    await t.pool.query("INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)", [email, hash, `Synthetic ${account}`, role]);
  }
  const item = async (name: string, quantity: number, weight: string, value: string) =>
    (await t.pool.query("INSERT INTO inventory_items (name, quantity, weight_per_unit_lbs, value_per_unit_usd) VALUES ($1, $2, $3, $4) RETURNING id", [name, quantity, weight, value])).rows[0].id;
  rice = await item("Synthetic rice", 200, "1.5", "2.25");
  beans = await item("Synthetic beans", 200, "0", "1.10");
  studentClient = (await t.pool.query("INSERT INTO clients (name, identifier, client_type) VALUES ('Synthetic Student One', 'SYN0001', 'student') RETURNING id")).rows[0].id;
  partnerClient = (await t.pool.query("INSERT INTO clients (name, identifier, client_type, organization) VALUES ('Synthetic Partner Org', 'PARTNER-SYN', 'partner', 'Synthetic Partner Org') RETURNING id")).rows[0].id;
  // A checkout saved before events existed. It must stay unassigned.
  historical = (await t.pool.query("INSERT INTO transactions (type, client_id, client_name) VALUES ('OUT', $1, 'Synthetic Student One') RETURNING id", [studentClient])).rows[0].id;
  await t.pool.query("INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd) VALUES ($1, $2, 'Synthetic rice', 3, '1.5', '2.25')", [historical, rice]);

  const { createApp } = await import("../../server/app");
  resetReadiness = (await import("../../server/frc-event-store")).resetEventSchemaReadiness;
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (t) {
    await (await import("../../server/pg")).pool.end();
    await t.drop();
  }
});

describe("before migration 0003", () => {
  it("keeps recording checkouts and refuses an event it cannot store", async () => {
    const staff = await login("staff");
    expect((await api("GET", "/api/frc-events/session", staff)).body).toEqual({ ready: false, selection: null, ended: null });
    expect((await api("GET", "/api/frc-events", staff)).status).toBe(409);

    const plain = await api("POST", "/api/transactions", staff, checkout(rice, 2), randomUUID());
    expect(plain.status).toBe(201);
    expect(plain.body.eventId).toBeNull();

    const before = await stock(rice);
    const refused = await api("POST", "/api/transactions", staff, checkout(rice, 2, { eventId: randomUUID() }), randomUUID());
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("event_tracking_unavailable");
    expect(await stock(rice)).toBe(before);
  });
});

describe("migration 0003", () => {
  it("is additive, idempotent and leaves history unassigned", async () => {
    const transactionsBefore = await count("SELECT count(*) AS n FROM transactions");
    await t.pool.query(migration0003());
    await t.pool.query(migration0003());
    resetReadiness();
    expect(await count("SELECT count(*) AS n FROM transactions")).toBe(transactionsBefore);
    expect(await count("SELECT count(*) AS n FROM transactions WHERE event_id IS NOT NULL")).toBe(0);
    expect((await t.pool.query("SELECT event_id FROM transactions WHERE id = $1", [historical])).rows[0].event_id).toBeNull();

    const column = (await t.pool.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'event_id'`)).rows[0];
    expect(column).toEqual({ is_nullable: "YES", column_default: null });
    const key = (await t.pool.query(`SELECT convalidated, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'transactions_event_id_frc_events_id_fk'`)).rows[0];
    expect(key.convalidated).toBe(true);
    expect(key.d).toBe("FOREIGN KEY (event_id) REFERENCES frc_events(id) ON DELETE RESTRICT");
    const rls = (await t.pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('frc_events', 'frc_event_sessions', 'frc_event_audit') ORDER BY relname`)).rows;
    expect(rls.map((row) => row.relrowsecurity)).toEqual([true, true, true]);
    const indexes = (await t.pool.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_transactions_event_id_timestamp', 'idx_frc_events_status_starts_at', 'idx_frc_event_sessions_expires_at') ORDER BY indexname`)).rows.map((row) => row.indexname);
    expect(indexes).toEqual(["idx_frc_event_sessions_expires_at", "idx_frc_events_status_starts_at", "idx_transactions_event_id_timestamp"]);
  });

  it("rejects malformed events at the database too", async () => {
    await expect(t.pool.query("INSERT INTO frc_events (name, starts_at) VALUES ('   ', now())")).rejects.toThrow(/frc_events_name_length/);
    await expect(t.pool.query("INSERT INTO frc_events (name, starts_at, ends_at) VALUES ('Synthetic', now(), now() - interval '1 hour')")).rejects.toThrow(/frc_events_window/);
    await expect(t.pool.query("INSERT INTO frc_events (name, status) VALUES ('Synthetic', 'planned')")).rejects.toThrow(/frc_events_status/);
  });
});

describe("events and permissions", () => {
  it("lets staff create, edit, end and reopen, and gives each event a stable UUID", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Saturday Market", "2026-10-24T14:00:00.000Z");
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    const edited = await api("PATCH", `/api/frc-events/${event.id}`, staff, { description: "Synthetic description", endsAt: "2026-10-24T18:00:00.000Z" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: event.id, description: "Synthetic description", endsAt: "2026-10-24T18:00:00.000Z" });
    expect((await api("PATCH", `/api/frc-events/${event.id}`, staff, { endsAt: "2026-10-24T10:00:00.000Z" })).status).toBe(400);
    expect((await api("POST", `/api/frc-events/${event.id}/close`, staff, undefined, randomUUID())).body.status).toBe("closed");
    expect((await api("POST", `/api/frc-events/${event.id}/reopen`, staff, undefined, randomUUID())).body.status).toBe("active");
    const history = await api("GET", `/api/frc-events/${event.id}/history`, staff);
    expect(history.body.map((entry: any) => entry.action).sort()).toEqual(["closed", "created", "reopened", "updated"]);
    expect(history.body.every((entry: any) => entry.actor === "Synthetic staff")).toBe(true);
  });

  it("returns one event for a retried create and refuses a same day twin", async () => {
    const staff = await login("staff");
    const key = randomUUID();
    const body = { name: "Synthetic Food Drive", startsAt: "2026-11-02T15:00:00.000Z" };
    const first = await api("POST", "/api/frc-events", staff, body, key);
    const retry = await api("POST", "/api/frc-events", staff, body, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    const twin = await api("POST", "/api/frc-events", staff, { name: "  synthetic food drive ", startsAt: "2026-11-02T20:00:00.000Z" }, randomUUID());
    expect(twin.status).toBe(409);
    expect(twin.body.code).toBe("event_duplicate");
    expect(twin.body.event.id).toBe(first.body.id);
    expect(await count("SELECT count(*) AS n FROM frc_events WHERE lower(name) = 'synthetic food drive'")).toBe(1);
  });

  it("keeps creation with staff, deletion with admins, and students out entirely", async () => {
    const volunteer = await login("volunteer");
    const student = await login("student");
    const admin = await login("admin");
    const staff = await login("staff");
    expect((await api("GET", "/api/frc-events", volunteer)).status).toBe(200);
    expect((await api("POST", "/api/frc-events", volunteer, { name: "Synthetic", startsAt: new Date().toISOString() })).status).toBe(403);
    expect((await api("GET", "/api/frc-events", student)).status).toBe(403);
    expect((await api("GET", "/api/frc-events/session", student)).status).toBe(403);
    expect((await api("GET", "/api/frc-events", null)).status).toBe(401);

    const unused = await createEvent(staff, "Synthetic Unused Event");
    expect((await api("POST", `/api/frc-events/${unused.id}/close`, volunteer)).status).toBe(403);
    expect((await api("DELETE", `/api/frc-events/${unused.id}`, staff)).status).toBe(403);
    expect((await api("DELETE", `/api/frc-events/${unused.id}`, admin, undefined, randomUUID())).status).toBe(200);
    // The audit record of a deleted event survives it.
    expect(await count("SELECT count(*) AS n FROM frc_event_audit WHERE event_id = $1 AND action = 'deleted'", [unused.id])).toBe(1);

    const used = await createEvent(staff, "Synthetic Used Event");
    expect((await api("POST", "/api/transactions", staff, checkout(rice, 1, { eventId: used.id }), randomUUID())).status).toBe(201);
    const refused = await api("DELETE", `/api/frc-events/${used.id}`, admin, undefined, randomUUID());
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("event_in_use");
  });
});

describe("the session's active event", () => {
  it("belongs to one signed in session and is never visible to another user or session", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Session Event");
    const selected = await api("PUT", "/api/frc-events/session", staff, { eventId: event.id });
    expect(selected.status).toBe(200);
    expect(selected.body.selection.event.id).toBe(event.id);
    // The same session reads it back, as after a reload or another page.
    expect((await api("GET", "/api/frc-events/session", staff)).body.selection.event.id).toBe(event.id);

    for (const other of [await login("staffTwo"), await login("volunteer"), await freshLogin("staff")]) {
      expect((await api("GET", "/api/frc-events/session", other)).body.selection).toBeNull();
    }
    const stored = (await t.pool.query("SELECT session_key FROM frc_event_sessions")).rows;
    expect(stored.every((row) => /^[0-9a-f]{64}$/.test(row.session_key))).toBe(true);
    expect(stored.some((row) => staff.includes(row.session_key))).toBe(false);
  });

  it("switches, tags check ins, clears, and is forgotten at sign out", async () => {
    const staff = await freshLogin("staff");
    const first = await createEvent(staff, "Synthetic First Event");
    const second = await createEvent(staff, "Synthetic Second Event");
    await api("PUT", "/api/frc-events/session", staff, { eventId: first.id });
    const switched = await api("PUT", "/api/frc-events/session", staff, { eventId: second.id, tagInbound: true });
    expect(switched.body.selection).toMatchObject({ event: { id: second.id }, tagInbound: true });
    const cleared = await api("PUT", "/api/frc-events/session", staff, { eventId: null });
    expect(cleared.body.selection).toBeNull();
    await api("PUT", "/api/frc-events/session", staff, { eventId: first.id });
    expect((await api("POST", "/api/auth/logout", staff)).status).toBe(200);
    // The stateless cookie would still verify if replayed, but its selection is gone.
    expect((await api("GET", "/api/frc-events/session", staff)).body.selection).toBeNull();
    const actions = (await t.pool.query("SELECT action FROM frc_event_audit WHERE event_id IN ($1, $2) AND action IN ('selected', 'cleared') ORDER BY created_at, id", [first.id, second.id])).rows.map((row) => row.action);
    expect(actions).toEqual(["selected", "selected", "cleared", "selected"]);
  });

  it("drops an ended event from the session and refuses to select one", async () => {
    const staff = await login("staff");
    const volunteer = await login("volunteer");
    const event = await createEvent(staff, "Synthetic Ending Event");
    expect((await api("PUT", "/api/frc-events/session", volunteer, { eventId: event.id })).status).toBe(200);
    await api("POST", `/api/frc-events/${event.id}/close`, staff, undefined, randomUUID());
    const after = await api("GET", "/api/frc-events/session", volunteer);
    expect(after.body).toMatchObject({ selection: null, ended: { id: event.id, name: "Synthetic Ending Event" } });
    const refused = await api("PUT", "/api/frc-events/session", volunteer, { eventId: event.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("event_closed");
  });
});

describe("attribution on saved transactions", () => {
  it("saves the event with the stock movement for several checkouts and a tagged check in", async () => {
    const volunteer = await login("volunteer");
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Attribution Event");
    const riceBefore = await stock(rice);
    for (let i = 0; i < 3; i++) {
      const saved = await api("POST", "/api/transactions", volunteer, checkout(rice, 2, { eventId: event.id }), randomUUID());
      expect(saved.status).toBe(201);
      expect(saved.body).toMatchObject({ type: "OUT", eventId: event.id, eventName: "Synthetic Attribution Event" });
    }
    expect(await stock(rice)).toBe(riceBefore - 6);
    const inbound = await api("POST", "/api/transactions", staff, {
      type: "IN", source: "Partner Donation", donor: "Synthetic Partner Org", clientId: partnerClient, clientName: "Synthetic Partner Org", eventId: event.id,
      items: [{ inventoryItemId: beans, name: "Synthetic beans", quantity: 10, weightPerUnitLbs: "0", valuePerUnitUsd: "1.10" }],
    }, randomUUID());
    expect(inbound.status).toBe(201);
    expect(inbound.body.eventId).toBe(event.id);
    const rows = (await t.pool.query("SELECT type, count(*)::int AS n FROM transactions WHERE event_id = $1 GROUP BY type ORDER BY type", [event.id])).rows;
    expect(rows).toEqual([{ type: "IN", n: 1 }, { type: "OUT", n: 3 }]);
    const listed = await api("GET", "/api/transactions", staff);
    expect(listed.body.filter((tx: any) => tx.eventId === event.id)).toHaveLength(4);
    expect(listed.body.find((tx: any) => tx.id === historical).eventId).toBeNull();
    const events = await api("GET", "/api/frc-events", staff);
    expect(events.body.find((row: any) => row.id === event.id)).toMatchObject({ outboundTransactions: 3, inboundTransactions: 1 });
  });

  it("replays a retried checkout once and refuses the same key for a different event", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Retry Event");
    const other = await createEvent(staff, "Synthetic Other Event");
    const key = randomUUID();
    const before = await stock(rice);
    const first = await api("POST", "/api/transactions", staff, checkout(rice, 4, { eventId: event.id }), key);
    const retry = await api("POST", "/api/transactions", staff, checkout(rice, 4, { eventId: event.id }), key);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(await stock(rice)).toBe(before - 4);
    const changed = await api("POST", "/api/transactions", staff, checkout(rice, 4, { eventId: other.id }), key);
    expect(changed.status).toBe(422);
    expect(await count("SELECT count(*) AS n FROM transactions WHERE event_id IN ($1, $2)", [event.id, other.id])).toBe(1);
  });

  it("records nothing for an ended or unknown event and frees the key", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Closed Event");
    await api("POST", `/api/frc-events/${event.id}/close`, staff, undefined, randomUUID());
    const key = randomUUID();
    const before = await stock(rice);
    const transactionsBefore = await count("SELECT count(*) AS n FROM transactions");
    for (const eventId of [event.id, randomUUID()]) {
      const refused = await api("POST", "/api/transactions", staff, checkout(rice, 5, { eventId }), key);
      expect(refused.status).toBe(409);
      expect(["event_closed", "event_missing"]).toContain(refused.body.code);
    }
    expect(await stock(rice)).toBe(before);
    expect(await count("SELECT count(*) AS n FROM transactions")).toBe(transactionsBefore);
    // The refusal rolled back, so the same key now saves the cart without the event.
    const saved = await api("POST", "/api/transactions", staff, checkout(rice, 5), key);
    expect(saved.status).toBe(201);
    expect(saved.body.eventId).toBeNull();
  });

  it("rolls back the event, stock and key together when a later write fails", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Rollback Event");
    // Fails the item insert that follows the event attributed transaction
    // row, after the event lock and the stock movement in the same save.
    await t.pool.query(`CREATE OR REPLACE FUNCTION synthetic_fail_line() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM transactions WHERE id = NEW.transaction_id AND event_id = '${event.id}'::uuid) THEN
          RAISE EXCEPTION 'synthetic write failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await t.pool.query("CREATE TRIGGER synthetic_fail_line BEFORE INSERT ON transaction_items FOR EACH ROW EXECUTE FUNCTION synthetic_fail_line()");
    try {
      const key = randomUUID();
      const before = await stock(rice);
      const failed = await api("POST", "/api/transactions", staff, checkout(rice, 3, { eventId: event.id }), key);
      expect(failed.status).toBe(500);
      expect(await stock(rice)).toBe(before);
      expect(await count("SELECT count(*) AS n FROM transactions WHERE event_id = $1", [event.id])).toBe(0);
      expect(await count("SELECT count(*) AS n FROM idempotency_keys WHERE key = $1", [key])).toBe(0);
    } finally {
      await t.pool.query("DROP TRIGGER IF EXISTS synthetic_fail_line ON transaction_items");
    }
  });

  it("holds an ending until a checkout that already locked the event commits", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Lock Event");
    const { lockAttributableEvent } = await import("../../server/frc-event-store");
    const checkoutTx = await t.pool.connect();
    const closer = await t.pool.connect();
    try {
      await checkoutTx.query("BEGIN");
      await lockAttributableEvent(checkoutTx, event.id);
      await closer.query("BEGIN");
      await closer.query("SET LOCAL lock_timeout = '300ms'");
      await expect(closer.query("UPDATE frc_events SET status = 'closed' WHERE id = $1", [event.id])).rejects.toThrow(/lock timeout/);
      await closer.query("ROLLBACK");
      await checkoutTx.query("COMMIT");
      await closer.query("UPDATE frc_events SET status = 'closed' WHERE id = $1", [event.id]);
      expect((await t.pool.query("SELECT status FROM frc_events WHERE id = $1", [event.id])).rows[0].status).toBe("closed");
    } finally {
      checkoutTx.release();
      closer.release();
    }
  });

  it("carries the event on a request pickup and refuses an ended one without completing it", async () => {
    const staff = await login("staff");
    const event = await createEvent(staff, "Synthetic Pickup Event");
    const request = async () => {
      const id = (await t.pool.query("INSERT INTO requests (client_id, client_name, client_identifier, reason, status) VALUES ($1, 'Synthetic Student One', 'SYN0001', 'Synthetic', 'approved') RETURNING id", [studentClient])).rows[0].id;
      await t.pool.query("INSERT INTO request_items (request_id, inventory_item_id, item_name, requested_quantity, approved_quantity, reserved) VALUES ($1, $2, 'Synthetic rice', 2, 2, true)", [id, rice]);
      await t.pool.query("UPDATE inventory_items SET reserved_quantity = reserved_quantity + 2 WHERE id = $1", [rice]);
      return id;
    };
    const fulfilled = await api("POST", `/api/requests/${await request()}/fulfill`, staff, { eventId: event.id });
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.transaction).toMatchObject({ eventId: event.id, eventName: "Synthetic Pickup Event" });

    await api("POST", `/api/frc-events/${event.id}/close`, staff, undefined, randomUUID());
    const pending = await request();
    const refused = await api("POST", `/api/requests/${pending}/fulfill`, staff, { eventId: event.id });
    expect(refused.status).toBe(409);
    expect((await t.pool.query("SELECT status FROM requests WHERE id = $1", [pending])).rows[0].status).toBe("approved");
  });
});
