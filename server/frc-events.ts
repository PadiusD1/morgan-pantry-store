/**
 * FRC events, the staff session's active event, and event attribution.
 *
 * An event is a dated distribution or collection (a pop up market, a food
 * drive) with a stable UUID. A checkout names the event the staff member had
 * selected, and the server checks that event inside the same database
 * transaction that moves the stock, so a saved visit can never point at an
 * event that was ended or removed while the cart was open.
 *
 * The selection belongs to one signed in session. It is keyed by a SHA-256 of
 * that session's cookie and checked against the user, so it survives a reload,
 * other pages and other tabs of that session, and is never visible to another
 * user, a later session on the same device, or a student. Signing out removes it.
 *
 * The tables come from migrations/0003_frc_events.sql, applied deliberately.
 * Until then every route here answers that event tracking is not set up, and
 * checkouts without an event keep working exactly as before.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "./pg";
import { requireRole } from "./auth";
import { runIdempotent, type IdempotentResult } from "./idempotency";
import { EventAttributionError, eventSchemaReady, lockAttributableEvent, type Queryable } from "./frc-event-store";

export { EventAttributionError, eventSchemaReady, lockAttributableEvent, forgetSessionSelection, resetEventSchemaReadiness } from "./frc-event-store";

export const EVENT_STATUSES = ["active", "closed"] as const;
export type EventStatus = typeof EVENT_STATUSES[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_FALLBACK_MS = 12 * 60 * 60 * 1000;
const NOT_SET_UP = "Event tracking is not set up yet. Checkouts are still recorded without an event.";

export type EventRecord = {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Saved OUT transactions that name this event. */
  outboundTransactions: number;
  /** Saved IN transactions that name this event. */
  inboundTransactions: number;
};

export type EventSelection = { event: EventRecord; tagInbound: boolean; selectedAt: string };

// ─── Records ────────────────────────────────────────────────────────────────

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function eventRecord(row: Record<string, unknown>): EventRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    startsAt: iso(row.starts_at)!,
    endsAt: iso(row.ends_at),
    status: row.status === "closed" ? "closed" : "active",
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    closedAt: iso(row.closed_at),
    outboundTransactions: Number(row.outbound ?? 0),
    inboundTransactions: Number(row.inbound ?? 0),
  };
}

const EVENT_COLUMNS = `e.id, e.name, e.description, e.starts_at, e.ends_at, e.status, e.created_at, e.updated_at, e.closed_at,
  (SELECT count(*) FROM transactions t WHERE t.event_id = e.id AND t.type = 'OUT')::int AS outbound,
  (SELECT count(*) FROM transactions t WHERE t.event_id = e.id AND t.type = 'IN')::int AS inbound`;

async function loadEvent(db: Queryable, id: string): Promise<EventRecord | null> {
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM frc_events e WHERE e.id = $1`, [id]);
  return rows[0] ? eventRecord(rows[0]) : null;
}

async function audit(db: Queryable, eventId: string | null, action: string, actor: string | null, details: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    `INSERT INTO frc_event_audit (event_id, action, actor_user_id, details) VALUES ($1, $2, $3, $4::jsonb)`,
    [eventId, action, actor, JSON.stringify(details)],
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

const instant = z.string().datetime({ offset: true });
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => (value ? value : null));

export const createEventSchema = z.object({
  name: z.string().trim().min(1, "Enter an event name.").max(200, "Keep the event name under 200 characters."),
  description: optionalText(2000),
  startsAt: instant,
  endsAt: instant.nullish().transform((value) => value ?? null),
});

export const updateEventSchema = z.object({
  name: z.string().trim().min(1, "Enter an event name.").max(200, "Keep the event name under 200 characters.").optional(),
  description: optionalText(2000).optional(),
  startsAt: instant.optional(),
  endsAt: instant.nullish(),
}).refine((value) => Object.values(value).some((field) => field !== undefined), "Change at least one field.");

const selectionSchema = z.object({
  eventId: z.string().regex(UUID, "Choose a valid event.").nullable(),
  tagInbound: z.boolean().optional(),
});

function windowProblem(startsAt: string, endsAt: string | null): string | null {
  return endsAt && Date.parse(endsAt) < Date.parse(startsAt) ? "The end must be at or after the start." : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the event details.";
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const operate = requireRole("admin", "staff", "volunteer");
const manage = requireRole("admin", "staff");
const administer = requireRole("admin");

async function needsSchema(res: Response): Promise<boolean> {
  if (await eventSchemaReady()) return false;
  res.status(409).json({ message: NOT_SET_UP, code: "event_tracking_unavailable" });
  return true;
}

function sessionScope(req: Request): { key: string; userId: string; expiresAt: Date } | null {
  if (!req.user || !req.sessionKey) return null;
  return {
    key: req.sessionKey,
    userId: req.user.id,
    expiresAt: new Date(req.sessionExpiresAt ?? Date.now() + SESSION_FALLBACK_MS),
  };
}

async function readSelection(db: Queryable, scope: { key: string; userId: string }): Promise<{ selection: EventSelection | null; ended: { id: string; name: string } | null }> {
  const { rows } = await db.query(
    `SELECT s.tag_inbound, s.selected_at, ${EVENT_COLUMNS}
       FROM frc_event_sessions s JOIN frc_events e ON e.id = s.event_id
      WHERE s.session_key = $1 AND s.user_id = $2 AND s.expires_at > now()`,
    [scope.key, scope.userId],
  );
  const row = rows[0];
  if (!row) return { selection: null, ended: null };
  if (row.status !== "active") {
    // Someone ended the event. The selection goes, and the next checkout is
    // recorded without an event unless staff choose another.
    await db.query("DELETE FROM frc_event_sessions WHERE session_key = $1 AND user_id = $2", [scope.key, scope.userId]);
    return { selection: null, ended: { id: String(row.id), name: String(row.name) } };
  }
  return { selection: { event: eventRecord(row), tagInbound: row.tag_inbound === true, selectedAt: iso(row.selected_at)! }, ended: null };
}

export function registerFrcEventRoutes(app: Express): void {
  app.get("/api/frc-events", operate, async (req, res) => {
    if (await needsSchema(res)) return;
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!["all", ...EVENT_STATUSES].includes(status)) return res.status(400).json({ message: "Choose active, closed or all events." });
    const { rows } = await pool.query(
      `SELECT ${EVENT_COLUMNS} FROM frc_events e
        WHERE ($1::text IS NULL OR e.status = $1)
        ORDER BY (e.status = 'active') DESC, e.starts_at DESC, lower(e.name), e.id`,
      [status === "all" ? null : status],
    );
    res.json(rows.map(eventRecord));
  });

  app.get("/api/frc-events/session", operate, async (req, res) => {
    if (!(await eventSchemaReady())) return res.json({ ready: false, selection: null, ended: null });
    const scope = sessionScope(req);
    if (!scope) return res.json({ ready: true, selection: null, ended: null });
    res.json({ ready: true, ...(await readSelection(pool, scope)) });
  });

  // Clearing goes through PUT with a null event, because every DELETE under
  // /api is reserved for staff and volunteers run checkouts too.
  app.put("/api/frc-events/session", operate, async (req, res) => {
    if (await needsSchema(res)) return;
    const scope = sessionScope(req);
    if (!scope) return res.status(401).json({ message: "Sign in again to choose an event." });
    const parsed = selectionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const { eventId, tagInbound } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM frc_event_sessions WHERE expires_at < now() - interval '1 day'");
      const previous = (await client.query(
        "SELECT event_id, tag_inbound FROM frc_event_sessions WHERE session_key = $1 AND user_id = $2 FOR UPDATE",
        [scope.key, scope.userId],
      )).rows[0];
      if (eventId === null) {
        await client.query("DELETE FROM frc_event_sessions WHERE session_key = $1 AND user_id = $2", [scope.key, scope.userId]);
        if (previous) await audit(client, previous.event_id, "cleared", scope.userId);
        await client.query("COMMIT");
        return res.json({ ready: true, selection: null, ended: null });
      }
      let event: { id: string; name: string };
      try {
        event = await lockAttributableEvent(client, eventId);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof EventAttributionError) return res.status(error.status).json({ message: error.message, code: error.code });
        throw error;
      }
      const tag = tagInbound ?? (previous && previous.event_id === event.id ? previous.tag_inbound === true : false);
      await client.query(
        `INSERT INTO frc_event_sessions (session_key, user_id, event_id, tag_inbound, selected_at, expires_at)
         VALUES ($1, $2, $3, $4, now(), $5)
         ON CONFLICT (session_key) DO UPDATE
           SET event_id = EXCLUDED.event_id, tag_inbound = EXCLUDED.tag_inbound,
               selected_at = CASE WHEN frc_event_sessions.event_id = EXCLUDED.event_id THEN frc_event_sessions.selected_at ELSE now() END,
               expires_at = EXCLUDED.expires_at
         WHERE frc_event_sessions.user_id = EXCLUDED.user_id`,
        [scope.key, scope.userId, event.id, tag, scope.expiresAt],
      );
      if (!previous || previous.event_id !== event.id) await audit(client, event.id, "selected", scope.userId, { tagInbound: tag });
      const result = await readSelection(client, scope);
      await client.query("COMMIT");
      res.json({ ready: true, ...result });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/frc-events", manage, async (req, res) => {
    if (await needsSchema(res)) return;
    const parsed = createEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const data = parsed.data;
    const problem = windowProblem(data.startsAt, data.endsAt);
    if (problem) return res.status(400).json({ message: problem });
    await runIdempotent(req, res, async (client): Promise<IdempotentResult> => {
      // Two devices naming the same event on the same Baltimore day get one
      // record, so a single event's activity is never split across two ids.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('frc_event:' || lower(btrim($1::text)) || ':' || (($2::timestamptz AT TIME ZONE 'America/New_York')::date)::text))`,
        [data.name, data.startsAt],
      );
      const twin = (await client.query(
        `SELECT ${EVENT_COLUMNS} FROM frc_events e
          WHERE e.status = 'active' AND lower(btrim(e.name)) = lower(btrim($1::text))
            AND (e.starts_at AT TIME ZONE 'America/New_York')::date = ($2::timestamptz AT TIME ZONE 'America/New_York')::date
          LIMIT 1`,
        [data.name, data.startsAt],
      )).rows[0];
      if (twin) {
        return { status: 409, body: { message: `${twin.name} already exists for that day. Select it instead of creating another.`, code: "event_duplicate", event: eventRecord(twin) } };
      }
      const { rows } = await client.query(
        `INSERT INTO frc_events (name, description, starts_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [data.name, data.description, data.startsAt, data.endsAt, req.user!.id],
      );
      const id = rows[0].id as string;
      await audit(client, id, "created", req.user!.id, { name: data.name, startsAt: data.startsAt, endsAt: data.endsAt });
      return { status: 201, body: await loadEvent(client, id) };
    });
  });

  app.patch("/api/frc-events/:id", manage, async (req, res) => {
    if (await needsSchema(res)) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ message: "Choose a valid event." });
    const parsed = updateEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    await runIdempotent(req, res, async (client): Promise<IdempotentResult> => {
      const current = (await client.query("SELECT * FROM frc_events WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!current) return { status: 404, body: { message: "Event not found. Refresh the event list." } };
      const before = eventRecord(current);
      const next = {
        name: parsed.data.name ?? before.name,
        description: parsed.data.description === undefined ? before.description : parsed.data.description,
        startsAt: parsed.data.startsAt ?? before.startsAt,
        endsAt: parsed.data.endsAt === undefined ? before.endsAt : parsed.data.endsAt,
      };
      const problem = windowProblem(next.startsAt, next.endsAt);
      if (problem) return { status: 400, body: { message: problem } };
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of ["name", "description", "startsAt", "endsAt"] as const) {
        const from = before[field];
        const to = field === "startsAt" || field === "endsAt" ? iso(next[field]) : next[field];
        if (from !== to) changes[field] = { from, to };
      }
      if (Object.keys(changes).length) {
        await client.query(
          `UPDATE frc_events SET name = $2, description = $3, starts_at = $4, ends_at = $5, updated_at = now() WHERE id = $1`,
          [id, next.name, next.description, next.startsAt, next.endsAt],
        );
        await audit(client, id, "updated", req.user!.id, { changes });
      }
      return { status: 200, body: await loadEvent(client, id) };
    });
  });

  for (const [action, status] of [["close", "closed"], ["reopen", "active"]] as const) {
    app.post(`/api/frc-events/:id/${action}`, manage, async (req, res) => {
      if (await needsSchema(res)) return;
      const id = String(req.params.id);
      if (!UUID.test(id)) return res.status(400).json({ message: "Choose a valid event." });
      await runIdempotent(req, res, async (client): Promise<IdempotentResult> => {
        const current = (await client.query("SELECT status FROM frc_events WHERE id = $1 FOR UPDATE", [id])).rows[0];
        if (!current) return { status: 404, body: { message: "Event not found. Refresh the event list." } };
        if (current.status !== status) {
          await client.query(
            `UPDATE frc_events SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
            [id, status],
          );
          await audit(client, id, status === "closed" ? "closed" : "reopened", req.user!.id);
        }
        return { status: 200, body: await loadEvent(client, id) };
      });
    });
  }

  app.delete("/api/frc-events/:id", administer, async (req, res) => {
    if (await needsSchema(res)) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ message: "Choose a valid event." });
    await runIdempotent(req, res, async (client): Promise<IdempotentResult> => {
      const current = (await client.query("SELECT id, name FROM frc_events WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!current) return { status: 404, body: { message: "Event not found. Refresh the event list." } };
      const used = (await client.query("SELECT 1 FROM transactions WHERE event_id = $1 LIMIT 1", [id])).rowCount;
      if (used) {
        return { status: 409, body: { message: `${current.name} has recorded activity. End it instead, so that history stays attributed.`, code: "event_in_use" } };
      }
      await client.query("DELETE FROM frc_events WHERE id = $1", [id]);
      await audit(client, id, "deleted", req.user!.id, { name: current.name });
      return { status: 200, body: { id, deleted: true } };
    });
  });

  app.get("/api/frc-events/:id/history", manage, async (req, res) => {
    if (await needsSchema(res)) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ message: "Choose a valid event." });
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.details, a.created_at, u.name AS actor_name
         FROM frc_event_audit a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.event_id = $1 ORDER BY a.created_at DESC, a.id LIMIT 200`,
      [id],
    );
    res.json(rows.map((row) => ({ id: row.id, action: row.action, details: row.details ?? {}, at: iso(row.created_at), actor: row.actor_name ?? null })));
  });
}
