import type { Express } from 'express';
import { z } from 'zod';
import { pool } from './pg';
import { storage } from './storage';
import { requireRole } from './auth';
import { measurementProposal } from '@shared/item-measurements';
import { productPhotoPath } from '@shared/product-photo';

export function registerInventoryQualityRoutes(app: Express) {
  app.get('/api/inventory/quality', requireRole('staff', 'admin'), async (_req, res) => {
    const items = (await storage.getInventoryItems()).map(item => ({ id: item.id, name: item.name, updatedAt: item.updatedAt, weightPerUnitLbs: item.weightPerUnitLbs, valuePerUnitUsd: item.valuePerUnitUsd, imageUrl: productPhotoPath(item), ...measurementProposal(item) }));
    // Completeness is a diagnostic, not a reason to hide future corrections.
    res.json({ total: items.length, missingWeight: items.filter(i => i.missingWeight).length, missingValue: items.filter(i => i.missingValue).length, missingPhoto: items.filter(i => !i.imageUrl).length, items });
  });
  app.patch('/api/inventory/:id/measurements', requireRole('staff', 'admin'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }), weightPerUnitLbs: z.number().finite().min(0.0001).max(99999).multipleOf(0.0001).optional(), valuePerUnitUsd: z.number().finite().min(0.01).max(999999).multipleOf(0.01).optional(), weightSource: z.string().trim().min(8).max(500).optional(), valueSource: z.string().trim().min(8).max(500).optional(), weightIsEstimated: z.boolean().optional(), costIsEstimated: z.boolean().optional() }).strict().safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ message: 'Enter positive measurements (up to four decimals for pounds and two for dollars), a source, and the current item version.' });
    const body = parsed.data;
    if ((body.weightPerUnitLbs === undefined && body.valuePerUnitUsd === undefined) || (body.weightPerUnitLbs !== undefined && (!body.weightSource || body.weightIsEstimated === undefined)) || (body.valuePerUnitUsd !== undefined && (!body.valueSource || body.costIsEstimated === undefined))) return res.status(400).json({ message: 'Each changed measurement needs its source and an explicit estimate flag.' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query('SELECT * FROM inventory_items WHERE id=$1 FOR UPDATE', [id.data])).rows[0];
      if (!row) { await c.query('ROLLBACK'); return res.status(404).json({ message: 'Item not found.' }); }
      if (new Date(row.updated_at).getTime() !== new Date(body.expectedUpdatedAt).getTime()) { await c.query('ROLLBACK'); return res.status(409).json({ message: 'This item changed. Refresh and review before saving. Your entries are kept.' }); }
      const audit = { at: new Date().toISOString(), by: req.user!.id, previousWeightLbs: row.weight_per_unit_lbs, previousValueUsd: row.value_per_unit_usd, changes: body };
      // Atomic merge under the row lock. Neither stock nor historical snapshots are rewritten.
      // Every successful write advances the browser-visible millisecond version.
      const { rows: [saved] } = await c.query(`UPDATE inventory_items SET weight_per_unit_lbs=COALESCE($2,weight_per_unit_lbs), unit_weight_g=CASE WHEN $2::numeric IS NULL THEN unit_weight_g ELSE ($2::numeric*453.59237)::real END, value_per_unit_usd=COALESCE($3,value_per_unit_usd), weight_is_estimated=CASE WHEN $2::numeric IS NULL THEN weight_is_estimated ELSE $4 END, cost_is_estimated=CASE WHEN $3::numeric IS NULL THEN cost_is_estimated ELSE $5 END, cost_cents=CASE WHEN $3::numeric IS NULL THEN cost_cents ELSE round($3::numeric*100)::integer END, raw_payload=COALESCE(raw_payload,'{}'::jsonb) || jsonb_build_object('frcMeasurementReview',$6::jsonb,'frcMeasurementHistory',COALESCE(raw_payload->'frcMeasurementHistory','[]'::jsonb) || jsonb_build_array($6::jsonb)), updated_at=GREATEST(clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$1 RETURNING updated_at`, [id.data, body.weightPerUnitLbs ?? null, body.valuePerUnitUsd ?? null, body.weightIsEstimated ?? false, body.costIsEstimated ?? false, JSON.stringify(audit)]);
      await c.query('COMMIT');
      res.json({ saved: true, historicalSnapshotsChanged: false, stockChanged: false, updatedAt: new Date(saved.updated_at).toISOString() });
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  });
}
