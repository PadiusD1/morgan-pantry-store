import { attributeSourceDetailed, type SourceIdentity } from "./donation-source";
import { csvRow } from "./csv";
import { filterReportTransactions, reportPeriodLabel, reportRangeError, REPORT_TIME_ZONE, type ReportTransaction, type ReportRange } from "./reporting";
export type RelationshipRecord = { id: string; name: string; organization?: string | null; status?: string | null; createdAt?: string };
export type RelationshipMovement = { entries: number; units: number; weightLbs: number; valueCents: number; unweighedUnits: number; unvaluedUnits: number };
const empty = (): RelationshipMovement => ({ entries: 0, units: 0, weightLbs: 0, valueCents: 0, unweighedUnits: 0, unvaluedUnits: 0 });
/** Directory rows with no movements are retained; name-only legacy matches are explicitly counted. */
export function relationshipReport(kind: "donor" | "partner", records: RelationshipRecord[], transactions: (ReportTransaction & { donorId?: string })[], range: ReportRange, directory: RelationshipRecord[] = records, sourceDirectory?: readonly SourceIdentity[]) {
  if (reportRangeError(range)) throw new Error(reportRangeError(range)!);
  const rows = records.map(record => ({ ...record, received: empty(), distributed: empty(), legacyNameEntries: 0, ambiguousLegacyEntries: 0 }));
  const byId = new Map(rows.map(row => [row.id, row]));
  const sources = sourceDirectory ?? directory.map(record => ({ ...record, kind }));
  for (const tx of filterReportTransactions(transactions, range)) {
    const attribution = tx.type === "IN" ? attributeSourceDetailed(tx, sources) : null;
    if (attribution?.kind === "ambiguous") {
      for (const candidate of attribution.candidates) {
        if (candidate.kind === kind) {
          const row = byId.get(candidate.id);
          if (row) row.ambiguousLegacyEntries += 1;
        }
      }
      continue;
    }
    const id = tx.type === "IN"
      ? (attribution?.kind === "allocated" && attribution.source.kind === kind ? attribution.source.id : null)
      : (kind === "partner" ? tx.clientId : null);
    const row = id ? byId.get(id) : undefined;
    if (!row) continue;
    if (attribution?.kind === "allocated" && attribution.basis === "sole_name_match") row.legacyNameEntries += 1;
    const total = tx.type === "IN" ? row.received : row.distributed;
    total.entries += 1;
    for (const line of tx.items) {
      const units = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
      total.units += units;
      if (Number.isFinite(line.weightPerUnitLbs) && line.weightPerUnitLbs > 0) total.weightLbs += units * line.weightPerUnitLbs;
      else total.unweighedUnits += units;
      if (Number.isFinite(line.valuePerUnitUsd) && line.valuePerUnitUsd > 0) total.valueCents += units * line.valuePerUnitUsd * 100;
      else total.unvaluedUnits += units;
    }
  }
  return rows;
}
export function relationshipCsv(kind: "donor" | "partner", records: RelationshipRecord[], transactions: (ReportTransaction & { donorId?: string })[], range: ReportRange, directory: RelationshipRecord[] = records, now: Date = new Date(), sourceDirectory?: readonly SourceIdentity[]): string {
  const rows = relationshipReport(kind, records, transactions, range, directory, sourceDirectory);
  if (!Number.isFinite(now.getTime())) throw new Error("A valid report generation time is required.");
  const generatedAt = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(now).replace(/\s+/g, " ");
  const columns = ["Name", "Organization", "Status", "Added at", "IN entries", "IN units", "IN lbs", "IN estimated USD", "IN units missing weight", "IN units missing value"];
  if (kind === "partner") columns.push("OUT entries", "OUT units", "OUT lbs", "OUT estimated USD", "OUT units missing weight", "OUT units missing value");
  columns.push("Legacy name-matched IN entries (review)", "Ambiguous unallocated IN entries");
  const movement = (value: RelationshipMovement) => [value.entries, value.units, value.weightLbs.toFixed(4), (value.valueCents / 100).toFixed(2), value.unweighedUnits, value.unvaluedUnits];
  return [[`FRC ${kind === "donor" ? "Donor" : "Partner"} Directory Report`], ["Period", reportPeriodLabel(range)], ["Calendar", REPORT_TIME_ZONE], ["Generated at (Baltimore)", generatedAt], ["Generated at (UTC)", now.toISOString()], ["Scope", "Filtered directory; no client contacts or student identities. Snapshot values, not cash savings."], [], columns, ...rows.map(r => [r.name, r.organization ?? "", r.status ?? "active", r.createdAt ?? "", ...movement(r.received), ...(kind === "partner" ? movement(r.distributed) : []), r.legacyNameEntries, r.ambiguousLegacyEntries])].map(csvRow).join("\r\n");
}
