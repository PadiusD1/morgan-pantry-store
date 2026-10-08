import { csvRow } from "./csv";

/** All pantry reporting follows the calendar in Baltimore, including exports. */
export const REPORT_TIME_ZONE = "America/New_York";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const GENERATED_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE, year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

export type ReportLine = {
  itemId: string;
  name: string;
  quantity: number;
  weightPerUnitLbs: number;
  valuePerUnitUsd: number;
};
export type ReportTransaction = {
  id: string;
  type: "IN" | "OUT";
  timestamp: string;
  items: ReportLine[];
  source?: string;
  donor?: string;
  clientId?: string;
  clientName?: string;
  isEmergency?: boolean;
  location?: { latitude: number; longitude: number; accuracy?: number };
};
export type ReportInventory = {
  id: string;
  name: string;
  quantity: number;
  weightPerUnitLbs: number;
  valuePerUnitUsd: number;
  reorderThreshold?: number;
};
export type ReportRange = { from: string; to: string };

export function reportDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = DATE_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reportRangeError({ from, to }: ReportRange): string | null {
  if ((from && !validDateInput(from)) || (to && !validDateInput(to))) return "Enter valid start and end dates.";
  if (from && to && from > to) return "The from date must be on or before the to date.";
  return null;
}

export function filterReportTransactions<T extends Pick<ReportTransaction, "timestamp">>(transactions: T[], range: ReportRange): T[] {
  if (reportRangeError(range)) return [];
  return transactions.filter((tx) => {
    const date = reportDateKey(tx.timestamp);
    return date !== null && (!range.from || date >= range.from) && (!range.to || date <= range.to);
  });
}

export function reportPeriodLabel({ from, to }: ReportRange): string {
  if (!from && !to) return "All recorded dates";
  return `${from || "First recorded date"} to ${to || "Latest recorded date"}`;
}

export function reportFilenameRange({ from, to }: ReportRange): string {
  return from || to ? `${from || "first"}-to-${to || "latest"}` : "all-dates";
}

export function reportDatePreset(preset: "month" | "previous-month" | "year" | "all", now = new Date()): ReportRange {
  if (preset === "all") return { from: "", to: "" };
  const today = reportDateKey(now)!;
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const [year, month] = today.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
  };
}

export function reportYears(transactions: ReportTransaction[], now = new Date()): number[] {
  // Always include the selected default, even when all existing records are older.
  const years = new Set([Number(reportDateKey(now)!.slice(0, 4))]);
  for (const tx of transactions) {
    const date = tx.type === "OUT" ? reportDateKey(tx.timestamp) : null;
    if (date) years.add(Number(date.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

type MovementTotals = { entries: number; units: number; weightLbs: number; valueUsd: number };
type MonthTotals = MovementTotals & { month: string; knownClients: number; emergencyVisits: number };
export type ReportItemTotal = { id: string; name: string; quantity: number; weightLbs: number; valueUsd: number };
export type BoardReport = {
  range: ReportRange;
  periodLabel: string;
  generatedAt: string;
  distribution: MovementTotals & { knownClients: number; unlinkedVisits: number; emergencyVisits: number; unvaluedUnits: number; unweighedUnits: number };
  receiving: MovementTotals;
  inventory: { itemTypes: number; units: number; weightLbs: number; valueUsd: number; lowStockItems: number; outOfStockItems: number };
  months: MonthTotals[];
  items: ReportItemTotal[];
};

const emptyMovement = (): MovementTotals => ({ entries: 0, units: 0, weightLbs: 0, valueUsd: 0 });
const finite = (value: number) => Number.isFinite(value) ? value : 0;

/** Aggregate saved line snapshots; today's item values must not rewrite past service. */
export function buildBoardReport(transactions: ReportTransaction[], inventory: ReportInventory[], range: ReportRange, now = new Date()): BoardReport {
  const distribution = { ...emptyMovement(), knownClients: 0, unlinkedVisits: 0, emergencyVisits: 0, unvaluedUnits: 0, unweighedUnits: 0 };
  const receiving = emptyMovement();
  const clients = new Set<string>();
  const months = new Map<string, MonthTotals & { clients: Set<string> }>();
  const items = new Map<string, ReportItemTotal>();

  for (const tx of filterReportTransactions(transactions, range)) {
    const movement = tx.type === "OUT" ? distribution : receiving;
    movement.entries += 1;
    let month: (MonthTotals & { clients: Set<string> }) | undefined;
    if (tx.type === "OUT") {
      if (tx.clientId) clients.add(tx.clientId);
      else distribution.unlinkedVisits += 1;
      if (tx.isEmergency) distribution.emergencyVisits += 1;
      const key = reportDateKey(tx.timestamp)!.slice(0, 7);
      month = months.get(key);
      if (!month) {
        month = { month: key, ...emptyMovement(), knownClients: 0, emergencyVisits: 0, clients: new Set() };
        months.set(key, month);
      }
      month.entries += 1;
      if (tx.clientId) month.clients.add(tx.clientId);
      if (tx.isEmergency) month.emergencyVisits += 1;
    }
    for (const item of tx.items) {
      const quantity = finite(item.quantity);
      const weight = quantity * finite(item.weightPerUnitLbs);
      // Stored USD unit values have two decimal places. Sum cents to avoid drift.
      const value = quantity * Math.round(finite(item.valuePerUnitUsd) * 100) / 100;
      movement.units += quantity;
      movement.weightLbs += weight;
      movement.valueUsd += value;
      if (month) {
        month.units += quantity;
        month.weightLbs += weight;
        month.valueUsd += value;
        if (!(item.valuePerUnitUsd > 0)) distribution.unvaluedUnits += quantity;
        if (!(item.weightPerUnitLbs > 0)) distribution.unweighedUnits += quantity;
        const id = item.itemId || item.name;
        const total = items.get(id) ?? { id, name: item.name, quantity: 0, weightLbs: 0, valueUsd: 0 };
        total.quantity += quantity;
        total.weightLbs += weight;
        total.valueUsd += value;
        items.set(id, total);
      }
    }
  }
  distribution.knownClients = clients.size;

  const current = { itemTypes: inventory.length, units: 0, weightLbs: 0, valueUsd: 0, lowStockItems: 0, outOfStockItems: 0 };
  for (const item of inventory) {
    current.units += finite(item.quantity);
    current.weightLbs += finite(item.quantity) * finite(item.weightPerUnitLbs);
    current.valueUsd += finite(item.quantity) * Math.round(finite(item.valuePerUnitUsd) * 100) / 100;
    if (item.quantity <= 0) current.outOfStockItems += 1;
    else if (item.reorderThreshold !== undefined && item.quantity <= item.reorderThreshold) current.lowStockItems += 1;
  }

  return {
    range: { ...range }, periodLabel: reportPeriodLabel(range), generatedAt: GENERATED_FORMAT.format(now).replace(/\s+/g, " "),
    distribution, receiving, inventory: current,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(({ clients: monthClients, ...month }) => ({ ...month, knownClients: monthClients.size })),
    items: [...items.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
  };
}

export const REPORT_DEFINITIONS = [
  "Visits are saved OUT transactions; one checkout counts once regardless of its item count.",
  "Identified clients are distinct linked client IDs. Visits without a linked record are reported separately; unique monthly counts must not be added together.",
  "Distributed weight and estimated USD value use the unit values saved with each checkout. Zero or missing values can understate totals.",
  "Received stock includes all IN sources, including purchases and transfers; it is not a measure of donations alone.",
  "Current inventory is a snapshot at generation time, not a historical end-of-period balance. Low stock excludes items already out of stock.",
] as const;

/** Deliberately excludes client names, IDs, contact details, locations, and donor names. */
export function boardSummaryCsv(report: BoardReport): string {
  const d = report.distribution;
  const rows: (string | number)[][] = [
    ["Morgan State Food Resource Center — Board Summary"],
    ["Reporting period", report.periodLabel], ["Calendar timezone", REPORT_TIME_ZONE], ["Generated", report.generatedAt], [],
    ["Service metric", "Value", "Unit"],
    ["Completed distribution visits", d.entries, "visits"], ["Identified clients served", d.knownClients, "distinct linked clients"],
    ["Visits without a linked client record", d.unlinkedVisits, "visits"], ["Units distributed", d.units, "units"],
    ["Weight distributed", d.weightLbs.toFixed(2), "lbs"], ["Estimated value distributed", d.valueUsd.toFixed(2), "USD"],
    ["Emergency visits", d.emergencyVisits, "visits"],
    ["Distributed units without a positive recorded unit value", d.unvaluedUnits, "units"],
    ["Distributed units without a positive recorded unit weight", d.unweighedUnits, "units"], [],
    ["Received stock in reporting period", "Value", "Unit"],
    ["Receiving entries", report.receiving.entries, "IN transactions"], ["Units received", report.receiving.units, "units"],
    ["Weight received", report.receiving.weightLbs.toFixed(2), "lbs"], ["Estimated value received", report.receiving.valueUsd.toFixed(2), "USD"], [],
    ["Current inventory at generation time", "Value", "Unit"],
    ["Item types", report.inventory.itemTypes, "items"], ["Units on hand", report.inventory.units, "units"],
    ["Weight on hand", report.inventory.weightLbs.toFixed(2), "lbs"], ["Estimated value on hand", report.inventory.valueUsd.toFixed(2), "USD"],
    ["Low-stock items", report.inventory.lowStockItems, "items"], ["Out-of-stock items", report.inventory.outOfStockItems, "items"], [],
    ["Monthly service within reporting period"],
    ["Month", "Visits", "Identified clients", "Units", "Weight (lbs)", "Estimated value (USD)", "Emergency visits"],
    ...report.months.map((m) => [m.month, m.entries, m.knownClients, m.units, m.weightLbs.toFixed(2), m.valueUsd.toFixed(2), m.emergencyVisits]), [],
    ["Distribution by item within reporting period"], ["Item", "Units", "Weight (lbs)", "Estimated value (USD)"],
    ...report.items.map((item) => [item.name, item.quantity, item.weightLbs.toFixed(2), item.valueUsd.toFixed(2)]), [],
    ["Definitions"], ...REPORT_DEFINITIONS.map((definition) => [definition]),
  ];
  return rows.map(csvRow).join("\r\n");
}

/** Operational line-level export, with the same inclusive dates as the on-screen report. */
export function detailedReportCsv(transactions: ReportTransaction[], clients: { id: string; name: string; identifier: string }[], range: ReportRange): { csv: string; lineCount: number } {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const rows: (string | number)[][] = [[
    "type", "timestamp", "dateEastern", "transactionId", "source", "donor", "client", "clientIdentifier", "itemName", "quantity",
    "weightPerUnitLbs", "totalWeightLbs", "valuePerUnitUsd", "totalValueUsd", "isEmergency", "latitude", "longitude", "accuracy",
  ]];
  for (const tx of filterReportTransactions(transactions, range)) {
    const client = tx.clientId ? clientMap.get(tx.clientId) : undefined;
    for (const item of tx.items) rows.push([
      tx.type, tx.timestamp, reportDateKey(tx.timestamp)!, tx.id, tx.source ?? "", tx.donor ?? "",
      tx.clientName ?? client?.name ?? "", client?.identifier ?? "", item.name, item.quantity,
      item.weightPerUnitLbs, (item.quantity * item.weightPerUnitLbs).toFixed(4), item.valuePerUnitUsd, (item.quantity * item.valuePerUnitUsd).toFixed(2),
      tx.isEmergency ? "Yes" : "No", tx.location?.latitude ?? "", tx.location?.longitude ?? "", tx.location?.accuracy ?? "",
    ]);
  }
  return { csv: rows.map(csvRow).join("\r\n"), lineCount: rows.length - 1 };
}
