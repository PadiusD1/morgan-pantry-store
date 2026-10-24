/**
 * Events and contributors for the board.
 *
 * One model feeds the on screen view, the CSV and the printed report, so the
 * three always show the same filtered selection. The rules, in the order they
 * protect the figures.
 *
 * A transaction belongs to the event saved on it and to nothing else. A row
 * saved without an event stays unassigned. No date window, name or guess ever
 * moves it into an event, because only the checkout itself is evidence.
 *
 * A transaction is counted once. Rows are deduplicated by id, every row lands
 * in exactly one event line, and totals add those lines, so no visit, unit or
 * pound is counted twice. Unique clients are the exception that cannot be
 * added. They are distinct linked client records, counted again for the whole
 * selection rather than summed across events.
 *
 * Incoming and outgoing never mix. Distributions are OUT rows. Donations are IN
 * rows, credited to a donor or partner only through the shared attribution in
 * donation-source.ts, the same authority the donor directory and each
 * individual report use. A typed name shared by several records credits no one.
 *
 * Only recorded measurements are summed. A line with no positive weight or
 * value adds nothing to that total and is counted as incomplete instead, and a
 * ranking by pounds or value says which contributors carry such units.
 *
 * Students are never named. A student who brought food in is counted inside
 * one combined line, and no client name, identifier or contact appears here.
 */
import { attributeSourceDetailed, sourceIdentityDirectory, type ClientSourceEntry } from "./donation-source";
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
import type { BoardSection } from "./board-selection";

export type BoardEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt?: string | null;
  status: "active" | "closed";
};

export type EventBoardTransaction = ReportTransaction & { eventId?: string | null; donorId?: string | null };

export type EventScope = { kind: "all" } | { kind: "events"; ids: readonly string[]; includeUnassigned: boolean };

export type RankMetric = "units" | "weight" | "value";

export const UNASSIGNED_KEY = "unassigned";
export const UNASSIGNED_LABEL = "Not assigned to an event";
export const STUDENT_CONTRIBUTORS_LABEL = "Students (names withheld)";

export type Movement = {
  /** Distinct saved transactions. A checkout with eleven items counts once. */
  entries: number;
  units: number;
  /** Recorded positive unit weights only. */
  weightLbs: number;
  /** Recorded positive unit values only, summed in cents. */
  valueCents: number;
  /** Units whose saved line has no positive weight. */
  unweighedUnits: number;
  /** Units whose saved line has no positive value. */
  unvaluedUnits: number;
};

export type DistributionMovement = Movement & {
  identifiedClients: number;
  students: number;
  partners: number;
  /** Visits saved without a linked client record, which cannot be deduplicated. */
  unlinkedVisits: number;
  emergencyVisits: number;
};

export type ReceivingMovement = Movement & {
  /** Entries credited to a donor, a partner or a student. */
  attributedEntries: number;
};

export type EventRow = {
  key: string;
  eventId: string | null;
  name: string;
  startsAt: string | null;
  status: BoardEvent["status"] | null;
  /** True when the saved event id is not in the event list that was loaded. */
  unknownEvent: boolean;
  distribution: DistributionMovement;
  receiving: ReceivingMovement;
};

export type ContributorRow = {
  key: string;
  kind: "donor" | "partner" | "students";
  name: string;
  /** One for a donor or partner, the number of distinct students otherwise. */
  contributors: number;
  movement: Movement;
  /** Entries credited by a unique name match rather than a stored id. */
  nameMatchedEntries: number;
  /** The ranking measure is missing for some of these units. */
  incomplete: boolean;
};

export type EventBoardReport = {
  range: ReportRange;
  periodLabel: string;
  generatedAt: string;
  scopeLabel: string;
  rankMetric: RankMetric;
  events: EventRow[];
  totals: { distribution: DistributionMovement; receiving: ReceivingMovement };
  contributors: ContributorRow[];
  coverage: {
    /** IN entries whose typed source name is shared by several records. */
    ambiguousInbound: number;
    /** IN entries with no identifiable donor, partner or student. */
    unattributedInbound: number;
    /** IN entries credited by name alone. */
    nameMatchedInbound: number;
    /** Entries in the selection saved with an event id the event list lacks. */
    unknownEventEntries: number;
  };
};

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const emptyMovement = (): Movement => ({ entries: 0, units: 0, weightLbs: 0, valueCents: 0, unweighedUnits: 0, unvaluedUnits: 0 });
const emptyDistribution = (): DistributionMovement => ({ ...emptyMovement(), identifiedClients: 0, students: 0, partners: 0, unlinkedVisits: 0, emergencyVisits: 0 });
const emptyReceiving = (): ReceivingMovement => ({ ...emptyMovement(), attributedEntries: 0 });

const GENERATED_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

/** Adds one transaction's saved lines to a movement, recorded values only. */
function addLines(movement: Movement, lines: ReportTransaction["items"]): void {
  movement.entries += 1;
  for (const line of lines) {
    const quantity = finite(line.quantity) > 0 ? finite(line.quantity) : 0;
    movement.units += quantity;
    if (finite(line.weightPerUnitLbs) > 0) movement.weightLbs += quantity * finite(line.weightPerUnitLbs);
    else movement.unweighedUnits += quantity;
    if (finite(line.valuePerUnitUsd) > 0) movement.valueCents += quantity * Math.round(finite(line.valuePerUnitUsd) * 100);
    else movement.unvaluedUnits += quantity;
  }
}

function addMovement(target: Movement, source: Movement): void {
  target.entries += source.entries;
  target.units += source.units;
  target.weightLbs += source.weightLbs;
  target.valueCents += source.valueCents;
  target.unweighedUnits += source.unweighedUnits;
  target.unvaluedUnits += source.unvaluedUnits;
}

export function rankValue(movement: Movement, metric: RankMetric): number {
  return metric === "units" ? movement.units : metric === "weight" ? movement.weightLbs : movement.valueCents;
}

export function rankIncomplete(movement: Movement, metric: RankMetric): boolean {
  return metric === "weight" ? movement.unweighedUnits > 0 : metric === "value" ? movement.unvaluedUnits > 0 : false;
}

export function scopeLabel(scope: EventScope, events: readonly BoardEvent[]): string {
  if (scope.kind === "all") return "All events and unassigned activity";
  const names = scope.ids.map((id) => events.find((event) => event.id === id)?.name ?? "Unknown event");
  const parts = [...names, ...(scope.includeUnassigned ? [UNASSIGNED_LABEL] : [])];
  return parts.length ? parts.join(", ") : "No events selected";
}

function inScope(eventId: string | null, scope: EventScope): boolean {
  if (scope.kind === "all") return true;
  return eventId ? scope.ids.includes(eventId) : scope.includeUnassigned;
}

export type EventBoardInput = {
  transactions: readonly EventBoardTransaction[];
  events: readonly BoardEvent[];
  donors: readonly { id: string; name: string }[];
  clients: readonly ClientSourceEntry[];
  range: ReportRange;
  scope: EventScope;
  rankMetric: RankMetric;
  now?: Date;
};

export function buildEventBoard(input: EventBoardInput): EventBoardReport {
  const problem = reportRangeError(input.range);
  if (problem) throw new Error(problem);
  const now = input.now ?? new Date();
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const clientKind = new Map(input.clients.map((client) => [client.id, client.clientType === "partner" ? "partner" : "student"]));
  const directory = sourceIdentityDirectory(input.donors, input.clients);

  type Working = EventRow & { clientIds: Set<string>; studentIds: Set<string>; partnerIds: Set<string>; firstSeen: string };
  const rows = new Map<string, Working>();
  const rowFor = (eventId: string | null, timestamp: string): Working => {
    const key = eventId ?? UNASSIGNED_KEY;
    let row = rows.get(key);
    if (!row) {
      const event = eventId ? eventById.get(eventId) : undefined;
      row = {
        key, eventId,
        name: eventId ? event?.name ?? `Unknown event ${eventId.slice(0, 8)}` : UNASSIGNED_LABEL,
        startsAt: event?.startsAt ?? null,
        status: event?.status ?? null,
        unknownEvent: Boolean(eventId && !event),
        distribution: emptyDistribution(), receiving: emptyReceiving(),
        clientIds: new Set(), studentIds: new Set(), partnerIds: new Set(), firstSeen: timestamp,
      };
      rows.set(key, row);
    }
    if (timestamp < row.firstSeen) row.firstSeen = timestamp;
    return row;
  };

  // An event chosen by name, or one that started in the period, is listed even
  // with nothing recorded, because a held event with no saved visits is real
  // information and not a missing figure.
  for (const event of input.events) {
    const started = reportDateKey(event.startsAt);
    const chosen = input.scope.kind === "events" && input.scope.ids.includes(event.id);
    const startedInRange = input.scope.kind === "all" && started !== null
      && (!input.range.from || started >= input.range.from) && (!input.range.to || started <= input.range.to);
    if (chosen || startedInRange) rowFor(event.id, event.startsAt);
  }
  if (input.scope.kind === "events" && input.scope.includeUnassigned) rowFor(null, "");

  const allClients = new Set<string>();
  const allStudents = new Set<string>();
  const allPartners = new Set<string>();
  const contributors = new Map<string, ContributorRow & { studentIds: Set<string> }>();
  const coverage = { ambiguousInbound: 0, unattributedInbound: 0, nameMatchedInbound: 0, unknownEventEntries: 0 };
  const seen = new Set<string>();

  for (const tx of filterReportTransactions(input.transactions as EventBoardTransaction[], input.range)) {
    // A retry that produced two rows for one action would otherwise count twice.
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const eventId = tx.eventId ?? null;
    if (!inScope(eventId, input.scope)) continue;
    const row = rowFor(eventId, tx.timestamp);
    if (row.unknownEvent) coverage.unknownEventEntries += 1;

    if (tx.type === "OUT") {
      const d = row.distribution;
      addLines(d, tx.items);
      if (tx.isEmergency) d.emergencyVisits += 1;
      if (tx.clientId) {
        row.clientIds.add(tx.clientId);
        allClients.add(tx.clientId);
        if (clientKind.get(tx.clientId) === "partner") { row.partnerIds.add(tx.clientId); allPartners.add(tx.clientId); }
        else { row.studentIds.add(tx.clientId); allStudents.add(tx.clientId); }
      } else d.unlinkedVisits += 1;
      continue;
    }

    addLines(row.receiving, tx.items);
    const attribution = attributeSourceDetailed(tx, directory);
    if (attribution.kind === "ambiguous") { coverage.ambiguousInbound += 1; continue; }
    if (attribution.kind === "unknown") { coverage.unattributedInbound += 1; continue; }
    row.receiving.attributedEntries += 1;
    if (attribution.basis === "sole_name_match") coverage.nameMatchedInbound += 1;
    const source = attribution.source;
    const key = source.kind === "student" ? "students" : `${source.kind}:${source.id}`;
    let contributor = contributors.get(key);
    if (!contributor) {
      contributor = {
        key, kind: source.kind === "student" ? "students" : source.kind,
        name: source.kind === "student" ? STUDENT_CONTRIBUTORS_LABEL : source.name,
        contributors: 0, movement: emptyMovement(), nameMatchedEntries: 0, incomplete: false, studentIds: new Set(),
      };
      contributors.set(key, contributor);
    }
    addLines(contributor.movement, tx.items);
    if (attribution.basis === "sole_name_match") contributor.nameMatchedEntries += 1;
    if (source.kind === "student") contributor.studentIds.add(source.id);
  }

  const totals = { distribution: emptyDistribution(), receiving: emptyReceiving() };
  const events: EventRow[] = [...rows.values()]
    .sort((a, b) => {
      if (a.key === UNASSIGNED_KEY || b.key === UNASSIGNED_KEY) return a.key === UNASSIGNED_KEY ? 1 : -1;
      const at = a.startsAt ?? a.firstSeen;
      const bt = b.startsAt ?? b.firstSeen;
      return at.localeCompare(bt) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
    })
    .map(({ clientIds, studentIds, partnerIds, firstSeen: _firstSeen, ...row }) => {
      row.distribution.identifiedClients = clientIds.size;
      row.distribution.students = studentIds.size;
      row.distribution.partners = partnerIds.size;
      addMovement(totals.distribution, row.distribution);
      totals.distribution.unlinkedVisits += row.distribution.unlinkedVisits;
      totals.distribution.emergencyVisits += row.distribution.emergencyVisits;
      addMovement(totals.receiving, row.receiving);
      totals.receiving.attributedEntries += row.receiving.attributedEntries;
      return row;
    });
  // Distinct across the whole selection, never a sum of per event counts.
  totals.distribution.identifiedClients = allClients.size;
  totals.distribution.students = allStudents.size;
  totals.distribution.partners = allPartners.size;

  const ranked = [...contributors.values()]
    .map(({ studentIds, ...row }) => ({
      ...row,
      contributors: row.kind === "students" ? studentIds.size : 1,
      incomplete: rankIncomplete(row.movement, input.rankMetric),
    }))
    .sort((a, b) => rankValue(b.movement, input.rankMetric) - rankValue(a.movement, input.rankMetric)
      || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

  return {
    range: { ...input.range },
    periodLabel: reportPeriodLabel(input.range),
    generatedAt: GENERATED_FORMAT.format(now).replace(/\s+/g, " "),
    scopeLabel: scopeLabel(input.scope, input.events),
    rankMetric: input.rankMetric,
    events,
    totals,
    contributors: ranked,
    coverage,
  };
}

// ─── Selection, the single model for screen, CSV and print ─────────────────

export const EVENT_BOARD_OPTIONS = [
  { key: "distributions", label: "Distributions by event", kind: "section" },
  { key: "donations", label: "Donations received by event", kind: "section" },
  { key: "clients", label: "Unique clients served", kind: "section" },
  { key: "contributors", label: "Top donors and partners", kind: "section" },
  { key: "trend", label: "Event comparison and trend", kind: "section" },
  { key: "units", label: "Units", kind: "measure" },
  { key: "weight", label: "Pounds", kind: "measure" },
  { key: "value", label: "Estimated value", kind: "measure" },
] as const;
export type EventBoardKey = typeof EVENT_BOARD_OPTIONS[number]["key"];
export type EventBoardSelection = readonly EventBoardKey[];
export const ALL_EVENT_BOARD_DATA: EventBoardSelection = EVENT_BOARD_OPTIONS.map((option) => option.key);
export const RANK_METRIC_LABELS: Record<RankMetric, string> = { units: "units received", weight: "recorded pounds received", value: "recorded estimated value received" };
export const TOP_CONTRIBUTOR_CHOICES = [5, 10, 25, 0] as const;

const count = (value: number) => value.toLocaleString("en-US");
const pounds = (value: number) => value.toFixed(1);
const dollars = (cents: number) => (cents / 100).toFixed(2);
const eventDate = (row: Pick<EventRow, "startsAt">) => (row.startsAt ? reportDateKey(row.startsAt) ?? "" : "");
// Words rather than a signed number, which a spreadsheet would read as a formula.
const visitChange = (difference: number) => difference === 0 ? "Same" : difference > 0 ? `${count(difference)} more` : `${count(-difference)} fewer`;

function measureColumns(selection: EventBoardSelection): { label: string; value: (m: Movement) => string | number }[] {
  const has = (key: EventBoardKey) => selection.includes(key);
  return [
    ...(has("units") ? [{ label: "Units", value: (m: Movement) => m.units }] : []),
    ...(has("weight") ? [{ label: "Recorded lbs", value: (m: Movement) => pounds(m.weightLbs) }, { label: "Units without weight", value: (m: Movement) => m.unweighedUnits }] : []),
    ...(has("value") ? [{ label: "Estimated value (USD)", value: (m: Movement) => dollars(m.valueCents) }, { label: "Units without value", value: (m: Movement) => m.unvaluedUnits }] : []),
  ];
}

export function hasEventBoardSection(selection: EventBoardSelection): boolean {
  return EVENT_BOARD_OPTIONS.some((option) => option.kind === "section" && selection.includes(option.key));
}

/** topN of 0 lists every contributor. */
export function eventBoardSections(report: EventBoardReport, selection: EventBoardSelection, topN = 10): BoardSection[] {
  const has = (key: EventBoardKey) => selection.includes(key);
  const measures = measureColumns(selection);
  const sections: BoardSection[] = [];
  const assigned = report.events.filter((row) => row.key !== UNASSIGNED_KEY);

  if (has("distributions")) {
    sections.push({
      key: "distributions", title: "Distributions by event",
      columns: ["Event", "Date", "Visits", ...measures.map((m) => m.label), "Emergency visits"],
      rows: [
        ...report.events.map((row) => [row.name, eventDate(row), row.distribution.entries, ...measures.map((m) => m.value(row.distribution)), row.distribution.emergencyVisits]),
        ["Total", "", report.totals.distribution.entries, ...measures.map((m) => m.value(report.totals.distribution)), report.totals.distribution.emergencyVisits],
      ],
      note: "Each checkout belongs to the one event saved on it. Checkouts saved without an event stay unassigned.",
    });
  }
  if (has("donations")) {
    sections.push({
      key: "donations", title: "Donations received by event",
      columns: ["Event", "Date", "Entries received", "From identified donors and partners", ...measures.map((m) => m.label)],
      rows: [
        ...report.events.map((row) => [row.name, eventDate(row), row.receiving.entries, row.receiving.attributedEntries, ...measures.map((m) => m.value(row.receiving))]),
        ["Total", "", report.totals.receiving.entries, report.totals.receiving.attributedEntries, ...measures.map((m) => m.value(report.totals.receiving))],
      ],
      note: "Entries received include every check in saved with the event, purchases and transfers too. Only entries from an identified donor, partner or student are donations credited to someone.",
    });
  }
  if (has("clients")) {
    sections.push({
      key: "clients", title: "Unique clients served",
      columns: ["Event", "Date", "Identified clients", "Students", "Partner organizations", "Visits without a linked client"],
      rows: [
        ...report.events.map((row) => [row.name, eventDate(row), row.distribution.identifiedClients, row.distribution.students, row.distribution.partners, row.distribution.unlinkedVisits]),
        ["Distinct across this selection", "", report.totals.distribution.identifiedClients, report.totals.distribution.students, report.totals.distribution.partners, report.totals.distribution.unlinkedVisits],
      ],
      note: "A client served at several events is counted once in the bottom line, so event rows do not add up to it. Visits without a linked client record cannot be deduplicated and are listed separately.",
    });
  }
  if (has("contributors")) {
    const list = topN > 0 ? report.contributors.slice(0, topN) : report.contributors;
    const rankLabel = report.rankMetric === "units" ? "Units" : report.rankMetric === "weight" ? "Recorded lbs" : "Estimated value (USD)";
    const rankCell = (m: Movement) => report.rankMetric === "units" ? m.units : report.rankMetric === "weight" ? pounds(m.weightLbs) : dollars(m.valueCents);
    const otherMeasures = measures.filter((m) => m.label !== rankLabel);
    sections.push({
      key: "contributors", title: `Top donors and partners by ${RANK_METRIC_LABELS[report.rankMetric]}`,
      columns: ["Rank", "Contributor", "Type", "Entries", rankLabel, ...otherMeasures.map((m) => m.label), "Measurement"],
      rows: list.map((row, index) => [
        index + 1, row.name,
        row.kind === "donor" ? "Donor" : row.kind === "partner" ? "Partner organization" : `${row.contributors} students`,
        row.movement.entries, rankCell(row.movement), ...otherMeasures.map((m) => m.value(row.movement)),
        row.incomplete ? "Incomplete" : "Recorded",
      ]),
      note: `${topN > 0 && report.contributors.length > topN ? `Top ${topN} of ${report.contributors.length} contributors. ` : ""}Ranked only by recorded figures. Incomplete means some of these units have no recorded ${report.rankMetric === "value" ? "value" : "weight"}, so the true position may be higher.`,
    });
  }
  if (has("trend")) {
    sections.push({
      key: "trend", title: "Event comparison and trend",
      columns: ["Event", "Date", "Visits", "Visits compared with the previous event", "Identified clients", ...(has("units") ? ["Units distributed"] : []), "Entries received"],
      rows: assigned.map((row, index) => [
        row.name, eventDate(row), row.distribution.entries,
        index === 0 ? "First in view" : visitChange(row.distribution.entries - assigned[index - 1].distribution.entries),
        row.distribution.identifiedClients, ...(has("units") ? [row.distribution.units] : []), row.receiving.entries,
      ]),
      note: "Events in date order. Activity without an event is left out of the trend.",
    });
  }
  return sections;
}

export function eventBoardDefinitions(report: EventBoardReport, selection: EventBoardSelection): string[] {
  const has = (key: EventBoardKey) => selection.includes(key);
  const c = report.coverage;
  return [
    "Dates use the inclusive Baltimore calendar. Only selected sections and measures are included, and an omitted one is not zero.",
    "Every transaction belongs to the event saved on it. Activity saved without an event is shown as not assigned and is never placed in an event afterwards.",
    ...(has("distributions") || has("trend") ? ["A visit is one saved checkout, however many items it holds."] : []),
    ...(has("clients") ? ["Identified clients are distinct linked client records, students and partner organizations, not people in households. The selection total counts each client once."] : []),
    ...(has("weight") || has("value") ? ["Pounds and estimated value add only the positive figures saved with each line. Units without one are listed, so a total that excludes them is understated, not complete. Estimated value is not cash or acquisition cost."] : []),
    ...(has("contributors") || has("donations") ? [`Donations are credited through the same attribution as the donor directory. ${count(c.ambiguousInbound)} entries name a source shared by several records and are credited to no one. ${count(c.unattributedInbound)} entries have no identifiable donor or partner. ${count(c.nameMatchedInbound)} entries are credited by a unique name rather than a stored record.`] : []),
    ...(c.unknownEventEntries ? [`${count(c.unknownEventEntries)} entries name an event that was not in the loaded event list. Refresh before sharing.`] : []),
    "No student name, student ID or contact detail appears. Donor and partner names appear because this view ranks contributors. Review event names and contributor names before sharing outside the pantry.",
  ];
}

export function eventBoardCsv(report: EventBoardReport, selection: EventBoardSelection, topN = 10): string {
  const sections = eventBoardSections(report, selection, topN);
  if (!sections.length) throw new Error("Select at least one event board section.");
  const rows: (string | number)[][] = [
    ["Morgan State Food Resource Center", "Events and contributors"],
    ["Reporting period", report.periodLabel], ["Calendar timezone", REPORT_TIME_ZONE], ["Generated", report.generatedAt],
    ["Events included", report.scopeLabel],
    ["Selected data", EVENT_BOARD_OPTIONS.filter((option) => selection.includes(option.key)).map((option) => option.label).join(", ")],
    ...(selection.includes("contributors") ? [["Contributors ranked by", RANK_METRIC_LABELS[report.rankMetric]]] : []),
    [],
  ];
  for (const section of sections) rows.push([section.title], section.columns, ...section.rows, ...(section.note ? [[section.note]] : []), []);
  rows.push(["Definitions"], ...eventBoardDefinitions(report, selection).map((note) => [note]));
  return rows.map(csvRow).join("\r\n");
}
