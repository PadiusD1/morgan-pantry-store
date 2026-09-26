/**
 * Shared food-request creation flow, used by:
 *  - POST /api/requests        (staff/kiosk — identity typed by a supervisor)
 *  - POST /api/portal/requests (student — identity from the session)
 */

import { z } from "zod";
import { pool } from "./pg";
import { storage } from "./storage";

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
  // Per-identifier daily rate limit (configurable via settings)
  let maxRequestsPerDay = 5;
  try {
    const setting = await storage.getSetting("maxRequestsPerDay");
    if (setting) maxRequestsPerDay = parseInt(setting) || 5;
  } catch {
    // default stands
  }

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayCount = await storage.getRequestCountSince(
    input.clientIdentifier,
    todayMidnight.toISOString(),
  );
  if (todayCount >= maxRequestsPerDay) {
    throw new RequestRateLimitError(maxRequestsPerDay);
  }

  const request = await storage.createRequest({
    clientName: input.clientName,
    clientIdentifier: input.clientIdentifier,
    clientEmail: input.clientEmail ?? null,
    clientPhone: input.clientPhone ?? null,
    clientId: input.clientId ?? null,
    userId: input.userId ?? null,
    reason: input.reason,
    studentNote: input.studentNote ?? null,
    status: "pending",
  });

  for (const item of input.items) {
    await storage.createRequestItem({
      requestId: request.id,
      inventoryItemId: item.inventoryItemId,
      itemName: item.itemName,
      itemCategory: item.itemCategory ?? null,
      requestedQuantity: item.requestedQuantity,
    });
  }

  await storage.createAuditLogEntry({
    requestId: request.id,
    action: "created",
    actor,
    details: "Request submitted",
    previousStatus: null,
    newStatus: "pending",
  });

  await storage.createNotification({
    requestId: request.id,
    recipientType: "client",
    recipientId: input.clientIdentifier,
    type: "request_submitted",
    title: "Request Submitted",
    message: "Your request has been submitted and is pending review.",
  });

  return getRequestPayload(request.id);
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
     FROM request_items WHERE request_id = $1 AND reserved = true`,
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
 * Moves a request to `next` only while it is still in one of `expected`, as
 * the first statement of its transaction, then releases any reservation.
 * Returns false when another request already moved it (PLAN.md defect 4).
 */
export async function moveRequestStatus(
  requestId: string,
  next: "cancelled" | "no_show" | "expired",
  expected: readonly string[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await client.query(
      `UPDATE requests SET status = $2, updated_at = now(),
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
       WHERE id = $1 AND status = ANY($3) RETURNING id`,
      [requestId, next, expected],
    );
    if (moved.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await releaseRequestReservations(requestId, client);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
