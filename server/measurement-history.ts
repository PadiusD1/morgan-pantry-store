import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { REPORT_TIME_ZONE } from "@shared/reporting";

export const MAX_HISTORY_ROWS = 1000;
export const MAX_MEASUREMENT_AUDIT_BYTES = 2_000_000;
export type HistoryScope = { mode: "missing_only" | "replace_incorrect"; from?: string; to?: string; reason: string };
export type MeasurementChanges = { weightPerUnitLbs?: number; valuePerUnitUsd?: number; weightSource?: string; valueSource?: string; weightIsEstimated?: boolean; costIsEstimated?: boolean };
export type HistoryLine = { lineId: string; transactionId: string; type: string; timestamp: Date; quantity: number; beforeWeightLbs: string; afterWeightLbs: string; beforeValueUsd: string; afterValueUsd: string };
export type HistoryCounts = { rows: number; transactions: number; weightRows: number; weightTransactions: number; valueRows: number; valueTransactions: number };
export type HistorySnapshot = { lines: HistoryLine[]; counts: HistoryCounts; totals: { beforeWeightLbs: number; afterWeightLbs: number; beforeValueUsd: number; afterValueUsd: number } };

/** Stable item identity and inclusive Baltimore dates; no name-based matching. */
export async function readMeasurementHistory(client: PoolClient, id: string, changes: MeasurementChanges, scope: HistoryScope, lock: boolean): Promise<HistorySnapshot> {
  const params = [id, changes.weightPerUnitLbs ?? null, changes.valuePerUnitUsd ?? null, scope.mode, scope.from || null, scope.to || null, REPORT_TIME_ZONE];
  const weight = "($2::numeric IS NOT NULL AND ($4='replace_incorrect' OR ti.weight_per_unit_lbs<=0))";
  const value = "($3::numeric IS NOT NULL AND ($4='replace_incorrect' OR ti.value_per_unit_usd<=0))";
  const query = `SELECT ti.id AS "lineId", ti.transaction_id AS "transactionId", t.type, t.timestamp, ti.quantity,
    ti.weight_per_unit_lbs AS "beforeWeightLbs", CASE WHEN ${weight} THEN $2::numeric ELSE ti.weight_per_unit_lbs END AS "afterWeightLbs",
    ti.value_per_unit_usd AS "beforeValueUsd", CASE WHEN ${value} THEN $3::numeric ELSE ti.value_per_unit_usd END AS "afterValueUsd"
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ti.inventory_item_id=$1 AND t.type IN ('IN','OUT')
      AND ($5::date IS NULL OR (t.timestamp AT TIME ZONE $7)::date >= $5::date)
      AND ($6::date IS NULL OR (t.timestamp AT TIME ZONE $7)::date <= $6::date)
      AND ((${weight} AND ti.weight_per_unit_lbs IS DISTINCT FROM $2::numeric)
        OR (${value} AND ti.value_per_unit_usd IS DISTINCT FROM $3::numeric))`;
  // Item lock precedes all line locks, matching stock writers. Lock at most one
  // bounded batch; an oversized request is refused atomically, never truncated.
  const lines: HistoryLine[] = (await client.query(`${query} ORDER BY ti.id LIMIT ${MAX_HISTORY_ROWS + 1}${lock ? " FOR UPDATE OF ti, t" : ""}`, params)).rows;
  const result = (await client.query(`SELECT count(*)::int AS rows, count(DISTINCT "transactionId")::int AS transactions,
    count(*) FILTER(WHERE "beforeWeightLbs" IS DISTINCT FROM "afterWeightLbs")::int AS "weightRows",
    count(DISTINCT "transactionId") FILTER(WHERE "beforeWeightLbs" IS DISTINCT FROM "afterWeightLbs")::int AS "weightTransactions",
    count(*) FILTER(WHERE "beforeValueUsd" IS DISTINCT FROM "afterValueUsd")::int AS "valueRows",
    count(DISTINCT "transactionId") FILTER(WHERE "beforeValueUsd" IS DISTINCT FROM "afterValueUsd")::int AS "valueTransactions",
    COALESCE(sum(quantity*"beforeWeightLbs"),0)::float8 AS "beforeWeightLbs", COALESCE(sum(quantity*"afterWeightLbs"),0)::float8 AS "afterWeightLbs",
    COALESCE(sum(quantity*"beforeValueUsd"),0)::float8 AS "beforeValueUsd", COALESCE(sum(quantity*"afterValueUsd"),0)::float8 AS "afterValueUsd"
    FROM (${query}) h`, params)).rows[0];
  const { rows, transactions, weightRows, weightTransactions, valueRows, valueTransactions, ...totals } = result;
  return { lines, counts: { rows, transactions, weightRows, weightTransactions, valueRows, valueTransactions }, totals };
}

/** Bind the preview to exact rows, values, item version, sources and scope. */
export function historyFingerprint(id: string, version: string, changes: MeasurementChanges, scope: HistoryScope, snapshot: HistorySnapshot): string {
  return createHash("sha256").update(JSON.stringify({ id, version,
    weight: changes.weightPerUnitLbs ?? null, value: changes.valuePerUnitUsd ?? null,
    weightSource: changes.weightSource ?? null, valueSource: changes.valueSource ?? null,
    weightIsEstimated: changes.weightIsEstimated ?? null, costIsEstimated: changes.costIsEstimated ?? null,
    mode: scope.mode, from: scope.from || "", to: scope.to || "", reason: scope.reason,
    lines: snapshot.lines,
  })).digest("hex");
}

export async function applyMeasurementHistory(client: PoolClient, id: string, snapshot: HistorySnapshot): Promise<void> {
  if (!snapshot.lines.length) return;
  const result = await client.query(`UPDATE transaction_items ti
    SET weight_per_unit_lbs=x.weight, value_per_unit_usd=x.value
    FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, weight numeric, value numeric)
    WHERE ti.id=x.id AND ti.inventory_item_id=$1`, [id, JSON.stringify(snapshot.lines.map(line => ({ id: line.lineId, weight: line.afterWeightLbs, value: line.afterValueUsd })))]);
  if (result.rowCount !== snapshot.lines.length) throw new Error("Historical measurement update count changed");
}
