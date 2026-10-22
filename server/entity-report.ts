import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { pool } from "./pg";
import { requireRole } from "./auth";
import { CSV_BOM } from "../shared/csv";
import { entityReport, entityReportCsv, type EntityKind, type EntityReport, type EntityTransaction } from "../shared/entity-report";
import { REPORT_TIME_ZONE, reportRangeError, type ReportRange } from "../shared/reporting";

export type EntityReportSnapshot = EntityReport & { generatedAt: string; reportingTimeZone: string };

/** Read directory identity, transactions and historical lines from one database snapshot. */
export async function loadEntityReport(db: Pool, kind: EntityKind, id: string, range: ReportRange): Promise<EntityReportSnapshot | null> {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const directory = (await connection.query("SELECT id, name FROM donors")).rows;
    const clients = (await connection.query('SELECT id, name, client_type AS "clientType" FROM clients')).rows;
    const record = kind === "donor"
      ? (await connection.query("SELECT id, name, organization FROM donors WHERE id = $1", [id])).rows[0]
      : (await connection.query("SELECT id, name, identifier, organization, client_type FROM clients WHERE id = $1", [id])).rows[0];
    if (!record || (kind !== "donor" && (record.client_type || "student") !== kind)) {
      await connection.query("COMMIT");
      return null;
    }
    // Include name-only legacy IN rows for attribution/ambiguity checks. Explicit
    // ids remain authoritative; the shared classifier excludes unrelated names.
    const predicate = kind === "donor"
      ? "t.type = 'IN' AND (t.donor_id = $1 OR (t.donor_id IS NULL AND t.client_id IS NULL))"
      : "t.client_id = $1 OR (t.type = 'IN' AND t.donor_id IS NULL AND t.client_id IS NULL)";
    const raw = (await connection.query(`
      SELECT t.id, t.type, t.timestamp, t.client_id, t.donor_id, t.donor, t.source, t.is_emergency,
        COALESCE(json_agg(json_build_object(
          'itemId', ti.inventory_item_id, 'name', ti.name, 'quantity', ti.quantity,
          'weightPerUnitLbs', ti.weight_per_unit_lbs, 'valuePerUnitUsd', ti.value_per_unit_usd
        ) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]') AS items
      FROM transactions t LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
      WHERE (${predicate})
        AND ($2::date IS NULL OR (t.timestamp AT TIME ZONE $4)::date >= $2::date)
        AND ($3::date IS NULL OR (t.timestamp AT TIME ZONE $4)::date <= $3::date)
      GROUP BY t.id ORDER BY t.timestamp DESC, t.id
    `, [id, range.from || null, range.to || null, REPORT_TIME_ZONE])).rows;
    const generatedAt = (await connection.query("SELECT transaction_timestamp() AS generated_at")).rows[0].generated_at.toISOString();
    const transactions: EntityTransaction[] = raw.map(row => ({
      id: row.id, type: row.type, timestamp: row.timestamp.toISOString(),
      clientId: row.client_id ?? undefined, donorId: row.donor_id, donor: row.donor ?? undefined,
      source: row.source ?? undefined, isEmergency: row.is_emergency,
      items: row.items.map((line: any) => ({ ...line, quantity: Number(line.quantity), weightPerUnitLbs: Number(line.weightPerUnitLbs), valuePerUnitUsd: Number(line.valuePerUnitUsd) })),
    }));
    const report = entityReport({ kind, id, name: record.name, identifier: record.identifier, organization: record.organization }, transactions, range, directory, clients);
    await connection.query("COMMIT");
    return { ...report, generatedAt, reportingTimeZone: REPORT_TIME_ZONE };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export function registerEntityReportRoutes(app: Express) {
  async function respond(req: Request, res: Response, csv: boolean) {
    const kind = req.params.kind;
    const id = req.params.id;
    if (typeof kind !== "string" || typeof id !== "string" || !["donor", "partner", "student"].includes(kind) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ message: "Choose a valid donor, partner or student record." });
    }
    if ((req.query.from !== undefined && typeof req.query.from !== "string") || (req.query.to !== undefined && typeof req.query.to !== "string")) {
      return res.status(400).json({ message: "Enter one start date and one end date." });
    }
    const range = { from: (req.query.from as string) || "", to: (req.query.to as string) || "" };
    const problem = reportRangeError(range);
    if (problem) return res.status(400).json({ message: problem });
    const report = await loadEntityReport(pool, kind as EntityKind, id, range);
    if (!report) return res.status(404).json({ message: "Record not found. Refresh the directory and choose another record." });
    res.setHeader("Cache-Control", "no-store");
    if (!csv) return res.json(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="frc-${kind}-${id}.csv"`);
    return res.send(CSV_BOM + entityReportCsv(report, new Date(report.generatedAt)));
  }
  app.get("/api/reports/entity/:kind/:id", requireRole("admin", "staff", "volunteer"), (req, res) => respond(req, res, false));
  app.get("/api/reports/entity/:kind/:id/export", requireRole("admin", "staff"), (req, res) => respond(req, res, true));
}

