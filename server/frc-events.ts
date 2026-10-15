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
}
