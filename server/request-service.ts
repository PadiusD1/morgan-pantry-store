/**
 * Shared food-request creation flow, used by:
 *  - POST /api/requests        (staff/kiosk — identity typed by a supervisor)
 *  - POST /api/portal/requests (student — identity from the session)
 */

import { z } from "zod";
import { pool } from "./pg";
import { storage } from "./storage";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { normaliseName } from "@shared/identity";
import { requests, requestItems, requestAuditLog, notifications, settings } from "@shared/schema";

const requestItemSchema = z.object({
  inventoryItemId: z.string().uuid(),
  itemName: z.string().trim().min(1).max(200),
  itemCategory: z.string().trim().max(120).nullish(),
  requestedQuantity: z.number().int().min(1).max(999),
});

export const createRequestSchema = z.object({
  clientName: z.string().trim().min(1).max(120),
  clientIdentifier: z.string().trim().min(1).max(60),
  clientEmail: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  clientPhone: z.string().trim().max(30).nullish(),
  clientId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  reason: z.string().trim().min(1).max(2000),
  studentNote: z.string().trim().max(2000).nullish(),
  items: z.array(requestItemSchema).min(1).max(50),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export class RequestRateLimitError extends Error {
  constructor(public readonly maxPerDay: number) {
    super(`Rate limit exceeded. Maximum ${maxPerDay} requests per day.`);
  }
}

export class RequestItemUnavailableError extends Error {
  readonly status = 409;

  constructor() {
    super("One or more requested items are no longer in the inventory. Refresh the item list and choose available items before submitting again.");
  }
}

/** The local calendar day has 23 or 25 hours at daylight-saving changes. */
export async function countRequestsForBaltimoreDay(
  client: Pick<PoolClient, "query">,
  identifier: string,
  at: Date,
): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM requests
     WHERE lower(btrim(regexp_replace(client_identifier, '\\s+', ' ', 'g'))) = $1
       AND created_at >= (
         date_trunc('day', $2::timestamptz AT TIME ZONE 'America/New_York')
         AT TIME ZONE 'America/New_York'
       )
       AND created_at < (
         (date_trunc('day', $2::timestamptz AT TIME ZONE 'America/New_York') + interval '1 day')
         AT TIME ZONE 'America/New_York'
       )`,
    [normaliseName(identifier), at],
  );
  return rows[0].count;
}

/** Full request payload with items, matching the legacy response shape. */
export async function getRequestPayload(
  requestId: string,
  options: { auditLog?: boolean; clientHistory?: boolean } = {},
): Promise<any | undefined> {
  const request = await storage.getRequest(requestId);
  if (!request) return undefined;
  const payload: any = {
    ...request,
    items: await storage.getRequestItems(requestId),
  };
  if (options.auditLog) {
    payload.auditLog = await storage.getRequestAuditLog(requestId);
  }
  if (options.clientHistory) {
    payload.clientHistory = await storage.getRequestsByClientIdentifier(
      request.clientIdentifier,
    );
  }
  return payload;
}

export async function createFoodRequest(
  input: CreateRequestInput,
  actor: string | null,
): Promise<any> {
  const client = await pool.connect();
  try {
    // READ COMMITTED gives a waiter a fresh count after the preceding request
    // commits. A transaction-scoped lock also works through a transaction pooler.
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('frc:request:create'), hashtext($1))", [normaliseName(input.clientIdentifier)]);

    const db = drizzle(client);
    const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "maxRequestsPerDay"));
    const configuredLimit = Number(setting?.value);
    const maxRequestsPerDay = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 5;

    const itemIds = [...new Set(input.items.map((item) => item.inventoryItemId.toLowerCase()))];
    // Keep the referenced rows from being deleted until the request commits.
    // Stable ordering also keeps concurrent inventory lock acquisition uniform.
    const { rows: inventory } = await client.query<{ id: string; name: string; category: string | null }>(
      "SELECT id, name, category FROM inventory_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR KEY SHARE",
      [itemIds],
    );
    if (inventory.length !== itemIds.length) throw new RequestItemUnavailableError();
    const inventoryById = new Map(inventory.map((item) => [item.id, item]));

    // Read the clock after acquiring the lock. A request waiting across local
    // midnight must be counted and timestamped in the day when it is created.
    const { rows: [clock] } = await client.query<{ requestTime: Date }>('SELECT clock_timestamp() AS "requestTime"');
    if (await countRequestsForBaltimoreDay(client, input.clientIdentifier, clock.requestTime) >= maxRequestsPerDay) {
      throw new RequestRateLimitError(maxRequestsPerDay);
    }

    const [request] = await db.insert(requests).values({
      clientName: input.clientName,
      clientIdentifier: input.clientIdentifier,
      clientEmail: input.clientEmail ?? null,
      clientPhone: input.clientPhone ?? null,
      clientId: input.clientId ?? null,
      userId: input.userId ?? null,
      reason: input.reason,
      studentNote: input.studentNote ?? null,
      status: "pending",
      createdAt: clock.requestTime,
      updatedAt: clock.requestTime,
    }).returning();

    const items = await db.insert(requestItems).values(input.items.map((item) => {
      const canonicalItem = inventoryById.get(item.inventoryItemId.toLowerCase())!;
      return {
        requestId: request.id,
        inventoryItemId: canonicalItem.id,
        itemName: canonicalItem.name,
        itemCategory: canonicalItem.category,
        requestedQuantity: item.requestedQuantity,
      };
    })).returning();

    await db.insert(requestAuditLog).values({
      requestId: request.id,
      action: "created",
      actor,
      details: "Request submitted",
      previousStatus: null,
      newStatus: "pending",
      createdAt: clock.requestTime,
    });

    await db.insert(notifications).values({
      requestId: request.id,
      recipientType: "client",
      recipientId: input.clientIdentifier,
      type: "request_submitted",
      title: "Request Submitted",
      message: "Your request has been submitted and is pending review.",
      createdAt: clock.requestTime,
    });

    await client.query("COMMIT");
    // Return the rows from this transaction; a separate read after commit
    // could fail despite a complete save and invite an accidental retry.
    return { ...request, items };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release every reserved item on a request and clear the reserved flags.
 * Used by cancel / no-show / expiry flows.
 */
export async function releaseRequestReservations(
  requestId: string,
  db: { query: typeof pool.query } = pool,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT inventory_item_id, approved_quantity
     FROM request_items WHERE request_id = $1 AND reserved = true
     ORDER BY inventory_item_id, id`,
    [requestId],
  );
  for (const row of rows) {
    await db.query(
      `UPDATE inventory_items
       SET reserved_quantity = GREATEST(0, reserved_quantity - $1)
       WHERE id = $2`,
      [row.approved_quantity ?? 0, row.inventory_item_id],
    );
  }
  await db.query(
    `UPDATE request_items SET reserved = false WHERE request_id = $1`,
    [requestId],
  );
}

/**
 * Locks the request row as the first statement of the caller's transaction,
 * before any inventory row, and returns its status while it is still one of
 * `expected`. Returns null when another writer already moved it.
 */
export async function claimRequest(
  client: { query: typeof pool.query },
  requestId: string,
  expected: readonly string[],
): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT status FROM requests WHERE id = $1 AND status = ANY($2) FOR UPDATE`,
    [requestId, expected],
  );
  return rows.length ? rows[0].status : null;
}

/**
 * Sets a request to `next` only while it is still one of `expected`, taking
 * the same claim as approval. Returns the status it held, or null when another
 * writer already moved it. `reviewedBy` also stamps the review time.
 */
export async function changeRequestStatus(
  requestId: string,
  next: "denied" | "under_review" | "ready_for_pickup",
  expected: readonly string[],
  fields: { adminNote?: string; reviewedBy?: string } = {},
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await claimRequest(client, requestId, expected);
    if (!previous) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE requests SET status = $2, updated_at = now(),
         admin_note = COALESCE($3, admin_note),
         reviewed_by = COALESCE($4, reviewed_by),
         reviewed_at = CASE WHEN $4::text IS NULL THEN reviewed_at ELSE now() END
       WHERE id = $1`,
      [requestId, next, fields.adminNote ?? null, fields.reviewedBy ?? null],
    );
    await client.query("COMMIT");
    return previous;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Moves a request to `next` only while it is still in one of `expected`, as
 * the first statement of its transaction, then releases any reservation.
 * Returns the status it claimed under the lock, for the audit row, or null
 * when another request already moved it (PLAN.md defect 4).
 */
export async function moveRequestStatus(
  requestId: string,
  next: "cancelled" | "no_show" | "expired",
  expected: readonly string[],
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await claimRequest(client, requestId, expected);
    if (!previous) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE requests SET status = $2, updated_at = now(),
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
       WHERE id = $1`,
      [requestId, next],
    );
    await releaseRequestReservations(requestId, client);
    await client.query("COMMIT");
    return previous;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
