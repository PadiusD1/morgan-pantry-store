import type { Express } from "express";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { inventoryItems } from "@shared/schema";
import { catalogImage, catalogQuality, objectValue, safeCatalogImage } from "@shared/catalog";
import { toCsv } from "@shared/csv";
import { pool } from "./pg";
import { storage } from "./storage";
import { requireRole } from "./auth";

const updateSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  evidence: z.string().trim().min(5).max(1000),
  weightPerUnitLbs: z.number().finite().min(0.0001).max(999999).optional(),
  weightIsEstimated: z.boolean().optional(),
  valuePerUnitUsd: z.number().finite().min(0.01).max(999999).multipleOf(0.01).optional(),
  costIsEstimated: z.boolean().optional(),
  imageUrl: z.string().max(1200).nullable().optional(),
  imageAlt: z.string().trim().max(250).optional(),
  imageSource: z.string().trim().max(300).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.weightPerUnitLbs === undefined && data.valuePerUnitUsd === undefined && data.imageUrl === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Supply a weight, value, or photo change." });
  if (data.imageUrl && !safeCatalogImage(data.imageUrl))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a local /item-photos image or an Open Food Facts product image without tracking parameters." });
  if (data.imageUrl && !data.imageSource?.trim())
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Record the photo source." });
});

export function registerCatalogRoutes(app: Express): void {
  const staff = requireRole("admin", "staff");
  app.get("/api/catalog/quality", staff, async (_req, res) => {
    res.json(catalogQuality(await storage.getInventoryItems()));
  });
  app.get("/api/catalog/quality.csv", staff, async (_req, res) => {
    const quality = catalogQuality(await storage.getInventoryItems());
    res.type("text/csv").attachment("frc-catalog-gaps.csv").send(toCsv([
      ["Catalog completeness review", "Current inventory only; historical receipt snapshots are unchanged"],
      ["Item ID", "Item", "Barcode", "Stock units", "Unit weight lbs", "Estimated unit value USD", "Missing fields"],
      ...quality.rows.map(row => [row.id, row.name, row.barcode, row.quantity, row.weightPerUnitLbs, row.valuePerUnitUsd, row.gaps.join("; ")]),
    ]));
  });
  app.patch("/api/inventory/:id/catalog", staff, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Invalid item ID" });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const data = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [current] } = await client.query("SELECT raw_payload, updated_at FROM inventory_items WHERE id = $1 FOR UPDATE", [id.data]);
      if (!current) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Item not found" }); }
      if (new Date(current.updated_at).getTime() !== new Date(data.expectedUpdatedAt).getTime()) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "This item changed. Refresh its data and review before saving again." });
      }
      const now = new Date(Math.max(Date.now(), new Date(current.updated_at).getTime() + 1));
      const payload: Record<string, unknown> = current.raw_payload && typeof current.raw_payload === "object" && !Array.isArray(current.raw_payload)
        ? objectValue(current.raw_payload) : { upstreamPayload: current.raw_payload };
      const meta = { ...objectValue(payload.frcCatalog) };
      const provenance = { source: data.evidence, recordedAt: now.toISOString(), recordedBy: req.user!.id };
      const fields: Partial<typeof inventoryItems.$inferInsert> = { updatedAt: now };
      if (data.weightPerUnitLbs !== undefined) {
        fields.weightPerUnitLbs = data.weightPerUnitLbs.toFixed(4);
        fields.unitWeightG = Number(fields.weightPerUnitLbs) * 453.59237;
        fields.weightIsEstimated = data.weightIsEstimated ?? true;
        meta.weightEvidence = provenance;
      }
      if (data.valuePerUnitUsd !== undefined) {
        fields.valuePerUnitUsd = data.valuePerUnitUsd.toFixed(2);
        fields.costCents = Math.round(data.valuePerUnitUsd * 100);
        fields.costIsEstimated = data.costIsEstimated ?? true;
        meta.valueEvidence = provenance;
      }
      if (data.imageUrl !== undefined) {
        meta.imageUrl = data.imageUrl ? safeCatalogImage(data.imageUrl) : null;
        meta.imageAlt = data.imageAlt ?? "";
        meta.imageSource = data.imageSource ?? "";
        meta.imageEvidence = provenance;
      }
      fields.rawPayload = { ...payload, frcCatalog: meta };
      const [saved] = await drizzle(client).update(inventoryItems).set(fields).where(eq(inventoryItems.id, id.data)).returning();
      await client.query("COMMIT");
      return res.json({ ...saved, ...catalogImage(saved.rawPayload) });
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }
  });
  app.get("/api/reports/directory.csv", staff, async (req, res) => {
    const kind = req.query.kind;
    if (kind !== "donor" && kind !== "partner") return res.status(400).json({ message: "Choose donor or partner." });
    const records = kind === "donor" ? await storage.getDonors() : (await storage.getClients()).filter(c => c.clientType === "partner");
    const sorted = records.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    res.type("text/csv").attachment(`frc-${kind}-directory.csv`).send(toCsv([
      ["Systems by Design", "Morgan State Food Resource Center"],
      [`${kind} directory`, "All registered records, including no activity. Registry only; not a donation-value report."],
      ["Generated at UTC", new Date().toISOString()],
      ["Record ID", "Name", "Organization", "Status", "Registered at UTC"],
      ...sorted.map(row => [row.id, row.name, row.organization, row.status, new Date(row.createdAt).toISOString()]),
    ]));
  });
}
