/**
 * One person or organisation's own record of activity.
 *
 * The existing reports answer "what did the pantry do". This answers "what did
 * this person do", which is the question a donor acknowledgement, a partner
 * review and a student's own history all need, and the one the board summary
 * must never answer because it stays anonymous.
 *
 * Two rules shape everything here.
 *
 * Incoming and outgoing are never added together. A partner organisation both
 * brings food in and takes food out, and a student who drops off a bag one week
 * collects one the next. A single total would describe neither direction and
 * would make a partner look like a larger recipient the more it contributed.
 * So a report carries two movement blocks and no combined figure exists.
 *
 * A visit is a transaction, not a line. Someone collecting eleven items made
 * one visit. Counting lines inflates service figures by whatever the shelves
 * happened to hold that day, and the inflation grows with generosity.
 */
import { attributeSourceDetailed, sourceIdentityDirectory, type ClientSourceEntry, type SourceIdentity } from "./donation-source";
import { csvRow } from "./csv";
import {
  REPORT_TIME_ZONE,
  filterReportTransactions,
  reportDateKey,
  reportPeriodLabel,
  reportRangeError,
  type ReportRange,
  type ReportTransaction,
} from "./reporting";

export type EntityKind = "donor" | "partner" | "student";

export type EntityRef = {
  kind: EntityKind;
  id: string;
  name: string;
  identifier?: string | null;
  organization?: string | null;
};

/** A directory record, enough to tell two same-name donors apart. */
export type DonorDirectoryEntry = { id: string; name: string };

export type EntityTransaction = ReportTransaction & { donorId?: string | null };

export type EntityMovement = {
  /** Distinct transactions, so one visit with eleven items counts once. */
  entries: number;
  /** Distinct calendar days in the reporting timezone. */
  activeDays: number;
  units: number;
  weightLbs: number;
  /** Summed in cents, because stored unit values have two decimals. */
  valueCents: number;
  /** Units whose saved line carried no positive weight. */
  unweighedUnits: number;
  /** Units whose saved line carried no positive value. */
  unvaluedUnits: number;
  emergencyEntries: number;
};

export type EntityReportRow = {
  transactionId: string;
  direction: "incoming" | "outgoing";
  timestamp: string;
  dateEastern: string;
  source: string | null;
  units: number;
  weightLbs: number;
  valueCents: number;
  isEmergency: boolean;
  /** How this row was attributed, so a reader can audit the figure. */
  attribution: "explicit_id" | "sole_name_match";
  items: { name: string; quantity: number; weightPerUnitLbs: number; valuePerUnitUsd: number }[];
};

export type EntityCoverage = {
  /**
   * Incoming rows whose typed donor name is shared by several donor records,
   * so they belong to none of them and are counted here instead.
   */
  ambiguousLegacyEntries: number;
  /** Rows attributed only by a name, which a reconciliation could change. */
  nameMatchedEntries: number;
  unweighedUnits: number;
  unvaluedUnits: number;
};

export type EntityReport = {
  entity: EntityRef;
  range: ReportRange;
  periodLabel: string;
  incoming: EntityMovement;
  outgoing: EntityMovement;
  rows: EntityReportRow[];
  coverage: EntityCoverage;
};

const emptyMovement = (): EntityMovement => ({
  entries: 0,
  activeDays: 0,
  units: 0,
  weightLbs: 0,
  valueCents: 0,
  unweighedUnits: 0,
  unvaluedUnits: 0,
  emergencyEntries: 0,
});

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

type Tally = { movement: EntityMovement; days: Set<string>; transactions: Set<string> };

const newTally = (): Tally => ({ movement: emptyMovement(), days: new Set(), transactions: new Set() });

/**
 * Which of this entity's directions a transaction belongs to, or null.
 *
 * A donor only ever appears on an incoming row, and only when the row names it
 * explicitly or its typed name belongs to exactly one donor record. A partner
 * or student is a client, so its client_id means "came from" on an incoming row
 * and "went to" on an outgoing one.
 */
function classify(
  tx: EntityTransaction,
  entity: EntityRef,
  directory: readonly SourceIdentity[],
): { direction: "incoming" | "outgoing"; attribution: EntityReportRow["attribution"] } | "ambiguous" | null {
  if (tx.type === "OUT") return entity.kind !== "donor" && tx.clientId === entity.id
    ? { direction: "outgoing", attribution: "explicit_id" } : null;
  const result = attributeSourceDetailed(tx, directory);
  if (result.kind === "ambiguous") return result.candidates.some(source => source.id === entity.id && source.kind === entity.kind) ? "ambiguous" : null;
  if (result.kind !== "allocated" || result.source.id !== entity.id || result.source.kind !== entity.kind) return null;
  return { direction: "incoming", attribution: result.basis };
}

export function entityReport(
  entity: EntityRef,
  transactions: readonly EntityTransaction[],
  range: ReportRange,
  donorDirectory: readonly DonorDirectoryEntry[] = [],
  clientDirectory: readonly ClientSourceEntry[] = [],
): EntityReport {
  const error = reportRangeError(range);
  if (error) throw new Error(error);

  const directory = sourceIdentityDirectory(donorDirectory, clientDirectory);
  // Callers rendering an individual client already know its canonical identity.
  if (entity.kind !== "donor" && !directory.some(source => source.kind === entity.kind && source.id === entity.id)) directory.push({ ...entity });
  const incoming = newTally();
  const outgoing = newTally();
  const rows: EntityReportRow[] = [];
  const coverage: EntityCoverage = {
    ambiguousLegacyEntries: 0,
    nameMatchedEntries: 0,
    unweighedUnits: 0,
    unvaluedUnits: 0,
  };

  const seen = new Set<string>();
  for (const tx of filterReportTransactions(transactions as EntityTransaction[], range)) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const verdict = classify(tx, entity, directory);
    if (verdict === null) continue;
    if (verdict === "ambiguous") {
      // Counted in the open and left out of every figure, because crediting it
      // would claim this person gave food the pantry cannot prove came from them.
      coverage.ambiguousLegacyEntries += 1;
      continue;
    }

    const tally = verdict.direction === "incoming" ? incoming : outgoing;
    const date = reportDateKey(tx.timestamp);
    // A retry that produced two rows for one action would otherwise count twice.
    if (!tally.transactions.has(tx.id)) {
      tally.transactions.add(tx.id);
      tally.movement.entries += 1;
      if (tx.isEmergency) tally.movement.emergencyEntries += 1;
      if (date) tally.days.add(date);
    }
    if (verdict.attribution === "sole_name_match") coverage.nameMatchedEntries += 1;

    let units = 0;
    let weightLbs = 0;
    let valueCents = 0;
    for (const line of tx.items) {
      const quantity = finite(line.quantity) > 0 ? finite(line.quantity) : 0;
      units += quantity;
      if (finite(line.weightPerUnitLbs) > 0) weightLbs += quantity * finite(line.weightPerUnitLbs);
      else {
        tally.movement.unweighedUnits += quantity;
        coverage.unweighedUnits += quantity;
      }
      if (finite(line.valuePerUnitUsd) > 0) valueCents += quantity * Math.round(finite(line.valuePerUnitUsd) * 100);
      else {
        tally.movement.unvaluedUnits += quantity;
        coverage.unvaluedUnits += quantity;
      }
    }
    tally.movement.units += units;
    tally.movement.weightLbs += weightLbs;
    tally.movement.valueCents += valueCents;

    rows.push({
      transactionId: tx.id,
      direction: verdict.direction,
      timestamp: tx.timestamp,
      dateEastern: date ?? "",
      source: tx.source ?? null,
      units,
      weightLbs,
      valueCents,
      isEmergency: !!tx.isEmergency,
      attribution: verdict.attribution,
      items: tx.items.map((line) => ({
        name: line.name,
        quantity: finite(line.quantity),
        weightPerUnitLbs: finite(line.weightPerUnitLbs),
        valuePerUnitUsd: finite(line.valuePerUnitUsd),
      })),
    });
  }

  incoming.movement.activeDays = incoming.days.size;
  outgoing.movement.activeDays = outgoing.days.size;

  return {
    entity,
    range: { ...range },
    periodLabel: reportPeriodLabel(range),
    incoming: incoming.movement,
    outgoing: outgoing.movement,
    rows: rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.transactionId.localeCompare(b.transactionId)),
    coverage,
  };
}

const money = (cents: number): string => (cents / 100).toFixed(2);

const DEFINITIONS = [
  "Incoming is what this record contributed to the pantry. Outgoing is what the pantry distributed to it. The two are never added together.",
  "An entry is one saved transaction. A visit with several items counts once. CSV transaction totals appear only on its first item line to avoid double counting.",
  "Active days are distinct calendar days in the reporting timezone, so two entries on one day are one day.",
  "Weight and value use the unit figures saved with each transaction, so past service is not restated at today's prices.",
  "Units with no positive recorded weight or value are listed separately. Totals that exclude them are understated, not complete.",
  "A retail or estimated value is not the pantry's acquisition cost.",
] as const;

/**
 * Every row for the selected period, not the page on screen.
 *
 * The on-screen table pages, and an export that silently carried only the
 * first page would understate a donor's year by however many rows happened to
 * be visible.
 */
export function entityReportCsv(report: EntityReport, now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid report generation time is required.");
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIME_ZONE, year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(now).replace(/\s+/g, " ");

  const movementRows = (label: string, movement: EntityMovement): (string | number)[][] => [
    [`${label} entries`, movement.entries],
    [`${label} active days`, movement.activeDays],
    [`${label} units`, movement.units],
    [`${label} weight (lbs)`, movement.weightLbs.toFixed(4)],
    [`${label} recorded value (USD)`, money(movement.valueCents)],
    [`${label} units with no recorded weight`, movement.unweighedUnits],
    [`${label} units with no recorded value`, movement.unvaluedUnits],
    [`${label} emergency entries`, movement.emergencyEntries],
  ];

  const rows: (string | number)[][] = [
    ["FRC Individual Activity Report"],
    ["Record", report.entity.name],
    ["Record type", report.entity.kind === "donor" ? "Donor" : report.entity.kind === "partner" ? "Partner organization" : "Student or client"],
    ["Identifier", report.entity.identifier ?? ""],
    ["Organization", report.entity.organization ?? ""],
    ["Period", report.periodLabel],
    ["Calendar", REPORT_TIME_ZONE],
    ["Generated (Baltimore)", generated],
    ["Generated (UTC)", now.toISOString()],
    ["Rows in this file", report.rows.length],
    [],
    ["Measure", "Value"],
    ...movementRows("Incoming", report.incoming),
    ...movementRows("Outgoing", report.outgoing),
    [],
    ["Data coverage", "Value"],
    ["Incoming entries left unallocated because the source name is shared", report.coverage.ambiguousLegacyEntries],
    ["Entries attributed by name alone, not by a stored identifier", report.coverage.nameMatchedEntries],
    ["Units with no recorded weight", report.coverage.unweighedUnits],
    ["Units with no recorded value", report.coverage.unvaluedUnits],
    [],
    ["Every transaction in the selected period"],
    ["direction", "transactionId", "timestamp", "dateEastern", "source", "attribution", "units", "weightLbs", "valueUSD", "emergency", "itemName", "itemQuantity", "itemWeightPerUnitLbs", "itemValuePerUnitUSD"],
  ];

  for (const row of report.rows) {
    if (row.items.length === 0) {
      rows.push([
        row.direction, row.transactionId, row.timestamp, row.dateEastern, row.source ?? "", row.attribution,
        row.units, row.weightLbs.toFixed(4), money(row.valueCents), row.isEmergency ? "Yes" : "No", "", "", "", "",
      ]);
      continue;
    }
    for (const [index, line] of row.items.entries()) {
      rows.push([
        row.direction, row.transactionId, row.timestamp, row.dateEastern, row.source ?? "", row.attribution,
        index === 0 ? row.units : "", index === 0 ? row.weightLbs.toFixed(4) : "", index === 0 ? money(row.valueCents) : "", row.isEmergency ? "Yes" : "No",
        line.name, line.quantity, line.weightPerUnitLbs, line.valuePerUnitUsd.toFixed(2),
      ]);
    }
  }

  rows.push([], ["Definitions"], ...DEFINITIONS.map((definition) => [definition]));
  return rows.map(csvRow).join("\r\n");
}
