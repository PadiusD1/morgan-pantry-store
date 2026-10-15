import type { Express } from "express";
import { z } from "zod";
import { pool } from "./pg";

export function registerFrcEventRoutes(app: Express) {
  app.get("/api/frc-events", async (req, res) => {
    if (!req.user || !["admin", "staff", "volunteer"].includes(req.user.role)) return res.status(403).json({ message: "Staff access required" });
    const result = await pool.query('SELECT id, name, description, starts_at AS "startsAt", ends_at AS "endsAt", status FROM frc_events ORDER BY created_at DESC');
    res.json(result.rows);
  });
  app.post("/api/frc-events", async (req, res) => {
    if (!req.user || !["admin", "staff"].includes(req.user.role)) return res.status(403).json({ message: "Staff access required" });
    const parsed = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(2000).optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid event data" });
    const data = parsed.data;
    if (data.startsAt && data.endsAt && Date.parse(data.endsAt) < Date.parse(data.startsAt)) return res.status(400).json({ message: "End date precedes start" });
    const result = await pool.query("INSERT INTO frc_events (name, description, starts_at, ends_at) VALUES ($1,$2,$3,$4) RETURNING id, name, status", [data.name, data.description ?? null, data.startsAt ?? null, data.endsAt ?? null]);
    res.status(201).json(result.rows[0]);
  });
  app.patch("/api/frc-events/:id/status", async (req, res) => {
    if (!req.user || !["admin", "staff"].includes(req.user.role)) return res.status(403).json({ message: "Staff access required" });
    const parsed = z.object({ status: z.enum(["active", "closed"]) }).safeParse(req.body);
    if (!parsed.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid event status" });
    const result = await pool.query("UPDATE frc_events SET status=$1, updated_at=now() WHERE id=$2 RETURNING id,name,status", [parsed.data.status, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "Event not found" });
    res.json(result.rows[0]);
  });
  app.get("/api/frc-events/analytics", async (req, res) => {
    if (!req.user || !["admin", "staff"].includes(req.user.role)) return res.status(403).json({ message: "Staff access required" });
    const dateSchema = z.object({ from: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(), to: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional() });
    const parsed = dateSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid date range" });
    const result = await pool.query(`
      SELECT t.id AS "transactionId", t.event_id AS "eventId",
             e.name AS "eventName", t.type AS direction,
             CASE WHEN t.donor_id IS NOT NULL THEN 'donor:' || t.donor_id::text
                  WHEN t.type='IN' AND t.client_id IS NOT NULL THEN 'partner:' || t.client_id::text
                  ELSE NULL END AS "sourceId",
             COALESCE(d.name, p.name, t.donor) AS "sourceName",
             t.client_id AS "clientId", ti.quantity,
             ti.weight_per_unit_lbs::float AS "unitWeightLbs",
             ti.value_per_unit_usd::float AS "unitValueUsd"
      FROM transactions t
      JOIN transaction_items ti ON ti.transaction_id=t.id
      LEFT JOIN frc_events e ON e.id=t.event_id
      LEFT JOIN donors d ON d.id=t.donor_id
      LEFT JOIN clients p ON p.id=t.client_id AND t.type='IN'
      WHERE ($1::date IS NULL OR (t.timestamp AT TIME ZONE 'America/New_York')::date >= $1::date)
        AND ($2::date IS NULL OR (t.timestamp AT TIME ZONE 'America/New_York')::date <= $2::date)
      ORDER BY t.timestamp DESC
    `, [parsed.data.from ?? null, parsed.data.to ?? null]);
    res.json(result.rows);
  });

}
