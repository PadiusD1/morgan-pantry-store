import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";
import type { CreateRequestInput } from "../../server/request-service";

let t: TestDb;
let service: typeof import("../../server/request-service");

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  service = await import("../../server/request-service");
});

afterAll(async () => {
  if (t) {
    const { pool } = await import("../../server/pg");
    await pool.end();
    await t.drop();
  }
});

async function newItem() {
  return (await t.pool.query("INSERT INTO inventory_items (name, quantity) VALUES ('Atomic Request Rice', 20) RETURNING id")).rows[0].id as string;
}

function input(identifier: string, itemId: string): CreateRequestInput {
  return {
    clientName: "Atomic Test Student", clientIdentifier: identifier, clientEmail: "atomic@example.test",
    reason: "Synthetic request for transaction testing", studentNote: "Keep this note",
    items: [{ inventoryItemId: itemId, itemName: "Atomic Request Rice", requestedQuantity: 2, itemCategory: "Dry Goods" }],
  };
}

async function setLimit(value: number) {
  await t.pool.query("INSERT INTO settings (key, value) VALUES ('maxRequestsPerDay', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [String(value)]);
}

async function totals() {
  return (await t.pool.query(`SELECT
    (SELECT count(*)::int FROM requests) AS requests,
    (SELECT count(*)::int FROM request_items) AS items,
    (SELECT count(*)::int FROM request_audit_log) AS audit,
    (SELECT count(*)::int FROM notifications) AS notifications`)).rows[0];
}

describe("atomic request creation", () => {
  it("rejects a removed inventory item with an actionable conflict and no partial request or quota consumed", async () => {
    await setLimit(1);
    const body = input("ATOMIC-ITEM-ROLLBACK", await newItem());
    const before = await totals();
    const failed = service.createFoodRequest({
      ...body,
      items: [...body.items, { inventoryItemId: randomUUID(), itemName: "Removed inventory item", requestedQuantity: 1 }],
    }, "Local Test Admin");
    await expect(failed).rejects.toBeInstanceOf(service.RequestItemUnavailableError);
    await expect(failed).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Refresh the item list") });
    expect(await totals()).toEqual(before);

    const saved = await service.createFoodRequest(body, "Local Test Admin");
    expect(saved).toMatchObject({ clientName: body.clientName, clientIdentifier: body.clientIdentifier, studentNote: body.studentNote, status: "pending" });
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ requestId: saved.id, inventoryItemId: body.items[0].inventoryItemId, requestedQuantity: 2 });
    expect(await totals()).toEqual({ requests: before.requests + 1, items: before.items + 1, audit: before.audit + 1, notifications: before.notifications + 1 });
  });

  it("stores canonical inventory names and categories instead of trusting stale cart labels", async () => {
    await setLimit(5);
    const itemId = await newItem();
    await t.pool.query("UPDATE inventory_items SET name = 'Canonical Rice', category = 'Shelf Stable' WHERE id = $1", [itemId]);
    const body = input("ATOMIC-CANONICAL-ITEM", itemId);
    body.items = [{ inventoryItemId: itemId.toUpperCase(), itemName: "Old cart name", itemCategory: "Old cart category", requestedQuantity: 2 }];
    const saved = await service.createFoodRequest(body, "Local Test Admin");
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ inventoryItemId: itemId, itemName: "Canonical Rice", itemCategory: "Shelf Stable", requestedQuantity: 2 });
  });

  it("rolls back request, items and audit if writing the final notification fails", async () => {
    await setLimit(5);
    const body = input("ATOMIC-NOTIFICATION-ROLLBACK", await newItem());
    const before = await totals();
    await t.pool.query(`CREATE FUNCTION fail_atomic_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.recipient_id = 'ATOMIC-NOTIFICATION-ROLLBACK' THEN
          RAISE EXCEPTION 'Synthetic notification failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_atomic_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION fail_atomic_notification();`);
    try {
      await expect(service.createFoodRequest(body, "Local Test Admin")).rejects.toThrow();
      expect(await totals()).toEqual(before);
    } finally {
      await t.pool.query("DROP TRIGGER fail_atomic_notification ON notifications; DROP FUNCTION fail_atomic_notification();");
    }
    const saved = await service.createFoodRequest(body, null);
    const audit = (await t.pool.query("SELECT actor, action, new_status FROM request_audit_log WHERE request_id = $1", [saved.id])).rows;
    const notification = (await t.pool.query("SELECT recipient_id, type FROM notifications WHERE request_id = $1", [saved.id])).rows;
    expect(audit).toEqual([{ actor: null, action: "created", new_status: "pending" }]);
    expect(notification).toEqual([{ recipient_id: body.clientIdentifier, type: "request_submitted" }]);
  });

  it("allows only one concurrent request for the final daily slot, including identifier case variants", async () => {
    await setLimit(1);
    const itemId = await newItem();
    const first = input("ATOMIC-CONCURRENT-ID", itemId);
    const second = input("atomic-concurrent-id", itemId);
    // Hold writes at the table boundary until both submissions overlap. A
    // pre-transaction count lets both see zero and both write after release;
    // the per-identifier lock lets only the first count before that commit.
    const gate = await t.pool.connect();
    await gate.query("BEGIN");
    await gate.query("LOCK TABLE requests IN SHARE MODE");
    const attempts = Promise.allSettled([
      service.createFoodRequest(first, "Admin One"),
      service.createFoodRequest(second, "Admin Two"),
    ]);
    try {
      await expect.poll(async () => (await t.pool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      )).rows[0].count, { timeout: 5_000 }).toBe(2);
    } finally {
      await gate.query("COMMIT");
      gate.release();
      await attempts;
    }
    const outcomes = await attempts;
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(service.RequestRateLimitError);
    const saved = (await t.pool.query("SELECT id FROM requests WHERE lower(client_identifier) = 'atomic-concurrent-id'")).rows;
    expect(saved).toHaveLength(1);
    const counts = (await t.pool.query(`SELECT
      (SELECT count(*)::int FROM request_items WHERE request_id = $1) AS items,
      (SELECT count(*)::int FROM request_audit_log WHERE request_id = $1) AS audit,
      (SELECT count(*)::int FROM notifications WHERE request_id = $1) AS notifications`, [saved[0].id])).rows[0];
    expect(counts).toEqual({ items: 1, audit: 1, notifications: 1 });
  });

  it("keeps a validated inventory row from being deleted before the request commits", async () => {
    await setLimit(5);
    const itemId = await newItem();
    const gate = await t.pool.connect();
    await gate.query("BEGIN");
    await gate.query("LOCK TABLE requests IN SHARE MODE");
    const creating = service.createFoodRequest(input("ATOMIC-DELETE-RACE", itemId), "Local Test Admin");
    let attempts: Promise<PromiseSettledResult<any>[]> | undefined;
    try {
      await expect.poll(async () => (await t.pool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      )).rows[0].count, { timeout: 5_000 }).toBe(1);
      attempts = Promise.allSettled([creating, t.pool.query("DELETE FROM inventory_items WHERE id = $1", [itemId])]);
      await expect.poll(async () => (await t.pool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      )).rows[0].count, { timeout: 5_000 }).toBe(2);
    } finally {
      await gate.query("COMMIT");
      gate.release();
      if (attempts) await attempts;
      else await creating.catch(() => undefined);
    }
    const [saved, removed] = await attempts!;
    expect(saved.status).toBe("fulfilled");
    expect(removed.status).toBe("rejected");
    if (removed.status === "rejected") expect(removed.reason).toMatchObject({ code: "23503" });
    expect((await t.pool.query("SELECT id FROM inventory_items WHERE id = $1", [itemId])).rows).toHaveLength(1);
  });

  it("counts Baltimore's calendar day when the server is in UTC and respects DST day boundaries", async () => {
    for (const boundary of [
      { id: "ATOMIC-EASTERN-DAY", at: "2026-10-01T01:00:00Z", start: "2026-09-30T04:00:00Z", end: "2026-10-01T04:00:00Z" },
      { id: "ATOMIC-SPRING-DAY", at: "2026-03-08T16:00:00Z", start: "2026-03-08T05:00:00Z", end: "2026-03-09T04:00:00Z" },
      { id: "ATOMIC-AUTUMN-DAY", at: "2026-11-01T16:00:00Z", start: "2026-11-01T04:00:00Z", end: "2026-11-02T05:00:00Z" },
    ]) {
      const times = [new Date(new Date(boundary.start).getTime() - 1), new Date(boundary.start), new Date(boundary.at), new Date(boundary.end)];
      for (const time of times) {
        await t.pool.query("INSERT INTO requests (client_name, client_identifier, reason, created_at) VALUES ('Day Test', $1, 'Synthetic day test', $2)", [boundary.id.toLowerCase(), time]);
      }
      expect(await service.countRequestsForBaltimoreDay(t.pool, boundary.id, new Date(boundary.at)), boundary.id).toBe(2);
    }
  });
});
