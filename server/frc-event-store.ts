/**
 * The small, dependency free half of FRC events, shared by the transaction
 * routes, the event routes and sign out. It imports only the pool, so the
 * auth module can use it without an import cycle.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "./pg";

export type Queryable = Pick<Pool | PoolClient, "query">;

export class EventAttributionError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

const NOT_READY_RECHECK_MS = 15_000;
let readiness: { ready: boolean; at: number } | null = null;

/**
 * True once migrations/0003_frc_events.sql is in place. A positive answer is
 * kept for the life of the process. A negative one is rechecked after a short
 * wait, so applying the migration takes effect without a redeploy.
 */
export async function eventSchemaReady(db: Queryable = pool): Promise<boolean> {
  if (readiness?.ready) return true;
  if (readiness && Date.now() - readiness.at < NOT_READY_RECHECK_MS) return false;
  const { rows } = await db.query(
    `SELECT to_regclass('public.frc_events') IS NOT NULL
        AND to_regclass('public.frc_event_sessions') IS NOT NULL
        AND to_regclass('public.frc_event_audit') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'event_id') AS ready`,
  );
  const ready = rows[0]?.ready === true;
  readiness = { ready, at: Date.now() };
  return ready;
}

/** For tests that apply the migration after the app started. */
export function resetEventSchemaReadiness(): void {
  readiness = null;
}

/**
 * Inside the caller's transaction, before any stock moves. Holds a share lock,
 * so the event cannot be ended or deleted until this transaction commits, and
 * a saved visit never names an event that ended while its cart was open.
 */
export async function lockAttributableEvent(client: Pick<PoolClient, "query">, eventId: string): Promise<{ id: string; name: string }> {
  if (!(await eventSchemaReady(client))) {
    throw new EventAttributionError(409, "Event tracking is not set up yet. Clear the event and save again.", "event_tracking_unavailable");
  }
  const { rows } = await client.query("SELECT id, name, status FROM frc_events WHERE id = $1 FOR SHARE", [eventId]);
  const event = rows[0];
  if (!event) {
    throw new EventAttributionError(409, "The selected event no longer exists. Choose another event or clear it, then save again.", "event_missing");
  }
  if (event.status !== "active") {
    throw new EventAttributionError(409, `${event.name} has ended. Choose another event or clear it, then save again.`, "event_closed");
  }
  return { id: event.id, name: event.name };
}

/** Removes the event selection of a session that signs out. Never throws. */
export async function forgetSessionSelection(sessionKey: string | undefined): Promise<void> {
  if (!sessionKey) return;
  try {
    if (!(await eventSchemaReady())) return;
    await pool.query("DELETE FROM frc_event_sessions WHERE session_key = $1", [sessionKey]);
  } catch {
    // Signing out must not fail on this. The row expires with the session.
  }
}
