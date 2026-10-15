import type { BoardReport } from "./reporting";
import { csvRow } from "./csv";

export const BOARD_DATA_OPTIONS = [
  { key: "visits", label: "Distribution visits" },
  { key: "clients", label: "Identified clients" },
  { key: "units", label: "Item quantities" },
  { key: "weight", label: "Recorded weight" },
  { key: "value", label: "Estimated value" },
  { key: "emergencies", label: "Emergency visits" },
  { key: "receiving", label: "Received stock" },
  { key: "inventory", label: "Current stock and alerts" },
  { key: "monthly", label: "Monthly breakdown" },
  { key: "items", label: "Item breakdown" },
] as const;
export type BoardDataKey = typeof BOARD_DATA_OPTIONS[number]["key"];
export type BoardSelection = readonly BoardDataKey[];
export const ALL_BOARD_DATA: BoardSelection = BOARD_DATA_OPTIONS.map(option => option.key);
export const isFullBoardSelection = (selection?: BoardSelection) => selection === undefined || ALL_BOARD_DATA.every(key => selection.includes(key));
export type BoardSection = { key: string; title: string; columns: string[]; rows: (string | number)[][]; note?: string };

export function selectedBoardDefinitions(selection: BoardSelection): string[] {
  const has = (key: BoardDataKey) => selection.includes(key);
  return [
    "This is a selected-data report. Unselected metrics and sections are omitted, not zero. Dates use the inclusive Baltimore calendar.",
    ...(has("visits") || has("emergencies") ? ["Visits are saved OUT transactions. A multi-item checkout counts once. Emergency visits are included in distribution visits."] : []),
    ...(has("clients") ? ["Identified clients are distinct linked client IDs, not a count of people in households. Monthly unique client counts must not be added together."] : []),
    ...(has("weight") ? ["Weight uses saved checkout line snapshots. Missing or non-positive weights can understate the total."] : []),
    ...(has("value") ? ["Estimated value uses saved checkout line snapshots. Missing or non-positive values can understate the total. Estimated value is not cash revenue or independently measured savings."] : []),
    ...(has("receiving") ? ["Received stock includes all IN sources, including purchases and transfers; it is not donations alone."] : []),
    ...(has("inventory") ? ["Current inventory is recorded stock at generation time, not historical end-of-period stock. Low stock excludes out-of-stock items."] : []),
    "Client names, identifiers, contact details, donor names, and locations are excluded. Review any selected free-text item names before external sharing.",
  ];
}

/** Single selected-data model for the on-screen preview, CSV, and print file. */
export function selectedBoardSections(report: BoardReport, selection: BoardSelection): BoardSection[] {
  const has = (key: BoardDataKey) => selection.includes(key);
  const d = report.distribution;
  const service: (string | number)[][] = [];
  if (has("visits")) service.push(["Completed distribution visits", d.entries, "visits"]);
  if (has("clients")) service.push(["Identified clients served", d.knownClients, "distinct linked clients"], ["Visits without a linked client record", d.unlinkedVisits, "visits"]);
  if (has("units")) service.push(["Units distributed", d.units, "units"]);
  if (has("weight")) service.push(["Weight distributed", d.weightLbs.toFixed(2), "lbs"], ["Distributed units without a positive recorded unit weight", d.unweighedUnits, "units"]);
  if (has("value")) service.push(["Estimated value distributed", d.valueUsd.toFixed(2), "USD"], ["Distributed units without a positive recorded unit value", d.unvaluedUnits, "units"]);
  if (has("emergencies")) service.push(["Emergency visits", d.emergencyVisits, "visits"]);
  const sections: BoardSection[] = service.length ? [{ key: "service", title: "Selected service metrics", columns: ["Measure", "Value", "Unit"], rows: service }] : [];
  if (has("receiving")) sections.push({ key: "receiving", title: "Received stock in reporting period", columns: ["Measure", "Value", "Unit"], rows: [
    ["Receiving entries", report.receiving.entries, "IN transactions"],
    ...(has("units") ? [["Units received", report.receiving.units, "units"]] : []),
    ...(has("weight") ? [["Weight received", report.receiving.weightLbs.toFixed(2), "lbs"]] : []),
    ...(has("value") ? [["Estimated value received", report.receiving.valueUsd.toFixed(2), "USD"]] : []),
  ] });
  if (has("inventory")) sections.push({ key: "inventory", title: "Current inventory at generation time", columns: ["Measure", "Value", "Unit"], rows: [
    ["Item types", report.inventory.itemTypes, "items"],
    ...(has("units") ? [["Units on hand", report.inventory.units, "units"]] : []),
    ...(has("weight") ? [["Weight on hand", report.inventory.weightLbs.toFixed(2), "lbs"]] : []),
    ...(has("value") ? [["Estimated value on hand", report.inventory.valueUsd.toFixed(2), "USD"]] : []),
    ["Low-stock items", report.inventory.lowStockItems, "items"], ["Out-of-stock items", report.inventory.outOfStockItems, "items"],
  ] });
  const monthColumns: { key: BoardDataKey; label: string; value: (m: BoardReport["months"][number]) => string | number }[] = [
    { key: "visits", label: "Visits", value: m => m.entries }, { key: "clients", label: "Identified clients", value: m => m.knownClients },
    { key: "units", label: "Units", value: m => m.units }, { key: "weight", label: "Weight (lbs)", value: m => m.weightLbs.toFixed(2) },
    { key: "value", label: "Estimated value (USD)", value: m => m.valueUsd.toFixed(2) }, { key: "emergencies", label: "Emergency visits", value: m => m.emergencyVisits },
  ];
  if (has("monthly")) {
    const columns = monthColumns.filter(column => has(column.key));
    sections.push({ key: "monthly", title: "Monthly service within reporting period", columns: ["Month", ...columns.map(c => c.label)], rows: report.months.map(month => [month.month, ...columns.map(c => c.value(month))]), note: "Only months with recorded distributions are listed." });
  }
  if (has("items")) sections.push({ key: "items", title: "Distribution by item within reporting period", columns: ["Item", ...(has("units") ? ["Units"] : []), ...(has("weight") ? ["Weight (lbs)"] : []), ...(has("value") ? ["Estimated value (USD)"] : [])], rows: report.items.map(item => [item.name, ...(has("units") ? [item.quantity] : []), ...(has("weight") ? [item.weightLbs.toFixed(2)] : []), ...(has("value") ? [item.valueUsd.toFixed(2)] : [])]) });
  return sections;
}

export function selectedBoardCsv(report: BoardReport, selection: BoardSelection): string {
  const sections = selectedBoardSections(report, selection);
  if (!sections.length) throw new Error("Select at least one board-report data option.");
  const rows: (string | number)[][] = [
    ["Morgan State Food Resource Center — Selected Board Summary"],
    ["Reporting period", report.periodLabel], ["Calendar timezone", "America/New_York"], ["Generated", report.generatedAt],
    ["Selected data", BOARD_DATA_OPTIONS.filter(option => selection.includes(option.key)).map(option => option.label).join("; ")], [],
  ];
  for (const section of sections) rows.push([section.title], section.columns, ...section.rows, ...(section.note ? [[section.note]] : []), []);
  rows.push(["Definitions"], ...selectedBoardDefinitions(selection).map(note => [note]));
  return rows.map(csvRow).join("\r\n");
}
