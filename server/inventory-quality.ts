import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from './pg';
import { storage } from './storage';
import { requireRole } from './auth';
import { measurementProposal } from '@shared/item-measurements';
import { productPhotoPath } from '@shared/product-photo';
import { reportRangeError } from '@shared/reporting';
import { applyMeasurementHistory, historyFingerprint, MAX_HISTORY_ROWS, MAX_MEASUREMENT_AUDIT_BYTES, readMeasurementHistory, type HistorySnapshot } from './measurement-history';

const measurementSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  weightPerUnitLbs: z.number().finite().min(0.0001).max(99999).multipleOf(0.0001).optional(),
  valuePerUnitUsd: z.number().finite().min(0.01).max(999999).multipleOf(0.01).optional(),
  weightSource: z.string().trim().min(8).max(500).optional(), valueSource: z.string().trim().min(8).max(500).optional(),
  weightIsEstimated: z.boolean().optional(), costIsEstimated: z.boolean().optional(),
  history: z.object({ mode: z.enum(['missing_only', 'replace_incorrect']), from: z.string().optional(), to: z.string().optional(),
    reason: z.string().trim().min(8).max(500), confirmedSamePackage: z.boolean().optional(), confirmedReplace: z.boolean().optional(),
    expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }).strict().optional(),
}).strict();

export function registerInventoryQualityRoutes(app: Express) {
  app.get('/api/inventory/quality', requireRole('staff', 'admin'), async (_req, res) => {
    const items = (await storage.getInventoryItems()).map(item => {
      const payload = item.rawPayload as Record<string, any> | null;
      return { id: item.id, name: item.name, barcode: item.barcode, brand: item.brand, category: item.category,
        quantity: item.quantity, reservedQuantity: item.reservedQuantity, packageType: item.packageType, unitCount: item.unitCount,
        updatedAt: item.updatedAt, weightPerUnitLbs: item.weightPerUnitLbs, valuePerUnitUsd: item.valuePerUnitUsd,
        imageUrl: productPhotoPath(item), ...measurementProposal(item),
        measurementHistory: (Array.isArray(payload?.frcMeasurementHistory) ? payload.frcMeasurementHistory : []).slice(-5).reverse()
          .map((entry: any) => ({ at: entry.at, reason: entry.history?.reason, ...(entry.history ? { history: { mode: entry.history.mode, counts: entry.history.counts } } : {}) })),
      };
    });
    res.json({ total: items.length, missingWeight: items.filter(i => i.missingWeight).length, missingValue: items.filter(i => i.missingValue).length, missingPhoto: items.filter(i => !i.imageUrl).length, items });
  });

  async function review(req: Request, res: Response, preview: boolean) {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = measurementSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ message: 'Enter positive measurements (up to four decimals for pounds and two for dollars), a source, and the current item version.' });
    const body = parsed.data;
    if ((body.weightPerUnitLbs === undefined && body.valuePerUnitUsd === undefined)
      || (body.weightPerUnitLbs !== undefined && (!body.weightSource || body.weightIsEstimated === undefined))
      || (body.valuePerUnitUsd !== undefined && (!body.valueSource || body.costIsEstimated === undefined))) {
      return res.status(400).json({ message: 'Each changed measurement needs its source and an explicit estimate flag.' });
    }
    const scope = body.history;
    if (preview && !scope) return res.status(400).json({ message: 'Choose a historical correction scope to preview.' });
    if (scope) {
      const problem = reportRangeError({ from: scope.from || '', to: scope.to || '' });
      if (problem) return res.status(400).json({ message: problem });
      if (!preview && (!scope.expectedFingerprint || !scope.confirmedSamePackage
        || (scope.mode === 'replace_incorrect' && !scope.confirmedReplace))) {
        return res.status(400).json({ message: 'Preview this correction and confirm the same package and historical replacement scope before saving.' });
      }
    }
    const c = await pool.connect();
    try {
      await c.query(preview ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const row = (await c.query(`SELECT * FROM inventory_items WHERE id=$1${preview ? '' : ' FOR UPDATE'}`, [id.data])).rows[0];
      if (!row) { await c.query('ROLLBACK'); return res.status(404).json({ message: 'Item not found.' }); }
      const version = new Date(row.updated_at).toISOString();
      if (new Date(row.updated_at).getTime() !== new Date(body.expectedUpdatedAt).getTime()) {
        await c.query('ROLLBACK'); return res.status(409).json({ message: 'This item changed. Refresh and review before saving. Your entries are kept.' });
      }
      let snapshot: HistorySnapshot | undefined;
      let fingerprint = '';
      if (scope) {
        snapshot = await readMeasurementHistory(c, row.id, body, scope, !preview);
        const canApply = snapshot.counts.rows <= MAX_HISTORY_ROWS;
        if (canApply) fingerprint = historyFingerprint(row.id, version, body, scope, snapshot);
        if (preview) {
          await c.query('COMMIT');
          return res.json({ expectedUpdatedAt: version, historyFingerprint: fingerprint, mode: scope.mode,
            range: { from: scope.from || '', to: scope.to || '' }, counts: snapshot.counts, totals: snapshot.totals,
            maxRows: MAX_HISTORY_ROWS, canApply });
        }
        if (!canApply) { await c.query('ROLLBACK'); return res.status(413).json({ message: `This correction affects more than ${MAX_HISTORY_ROWS} lines. Narrow the date range and preview again.` }); }
        if (fingerprint !== scope.expectedFingerprint) {
          await c.query('ROLLBACK'); return res.status(409).json({ message: 'Historical measurements or correction inputs changed after the preview. Preview again; your entries are kept.' });
        }
      }
      const audit = { id: randomUUID(), at: new Date().toISOString(), by: req.user!.id,
        previousWeightLbs: row.weight_per_unit_lbs, previousValueUsd: row.value_per_unit_usd, changes: body,
        ...(scope && snapshot ? { history: { mode: scope.mode, from: scope.from || '', to: scope.to || '', reason: scope.reason,
          counts: snapshot.counts, totals: snapshot.totals, beforeAfter: snapshot.lines } } : {}),
      };
      const history = row.raw_payload?.frcMeasurementHistory ?? [];
      if (!Array.isArray(history)) { await c.query('ROLLBACK'); return res.status(409).json({ message: 'The existing measurement audit needs repair before another correction can be recorded.' }); }
      if (Buffer.byteLength(JSON.stringify([...history, audit]), 'utf8') > MAX_MEASUREMENT_AUDIT_BYTES) {
        await c.query('ROLLBACK'); return res.status(413).json({ message: 'This item has reached its stored measurement audit limit. An administrator must archive the audit safely before more corrections; nothing was changed.' });
      }
      if (snapshot) await applyMeasurementHistory(c, row.id, snapshot);
      // Save inventory, every selected historical line, and immutable before/after
      // evidence in one transaction. Stock, quantities, people and nonselected
      // measurements never change. Old callers without history remain future-only.
      const { rows: [saved] } = await c.query(`UPDATE inventory_items SET
        weight_per_unit_lbs=COALESCE($2,weight_per_unit_lbs),
        net_weight_g=CASE WHEN $2::numeric IS NULL THEN net_weight_g ELSE ($2::numeric*453.59237)::real END,
        unit_weight_g=CASE WHEN $2::numeric IS NULL THEN unit_weight_g ELSE ($2::numeric*453.59237/GREATEST(COALESCE(unit_count,1),1))::real END,
        value_per_unit_usd=COALESCE($3,value_per_unit_usd),
        weight_is_estimated=CASE WHEN $2::numeric IS NULL THEN weight_is_estimated ELSE $4 END,
        cost_is_estimated=CASE WHEN $3::numeric IS NULL THEN cost_is_estimated ELSE $5 END,
        cost_cents=CASE WHEN $3::numeric IS NULL THEN cost_cents ELSE round($3::numeric*100)::integer END,
        currency=CASE WHEN $3::numeric IS NULL THEN currency ELSE 'USD' END,
        raw_payload=COALESCE(raw_payload,'{}'::jsonb) || jsonb_build_object('frcMeasurementReview',$6::jsonb,'frcMeasurementHistory',$7::jsonb),
        updated_at=GREATEST(clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond')
        WHERE id=$1 RETURNING updated_at`, [row.id, body.weightPerUnitLbs ?? null, body.valuePerUnitUsd ?? null,
        body.weightIsEstimated ?? false, body.costIsEstimated ?? false, JSON.stringify(audit), JSON.stringify([...history, audit])]);
      await c.query('COMMIT');
      res.json({ saved: true, historicalSnapshotsChanged: !!snapshot?.counts.rows, stockChanged: false,
        updatedAt: new Date(saved.updated_at).toISOString(), ...(snapshot ? { counts: snapshot.counts } : {}) });
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  app.post('/api/inventory/:id/measurements/preview', requireRole('staff', 'admin'), (req, res) => review(req, res, true));
  app.patch('/api/inventory/:id/measurements', requireRole('staff', 'admin'), (req, res) => review(req, res, false));
}
