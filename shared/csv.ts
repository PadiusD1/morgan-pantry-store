// One CSV writer for every export, used by the client downloads and the
// server donor report so both quote, guard and encode cells the same way.

export type CsvCell = string | number | null | undefined;

// Written first so spreadsheet apps read the file as UTF 8.
export const CSV_BOM = "﻿";

// A text cell starting with one of these can be run as a formula by a
// spreadsheet, so it gets a leading single quote.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  // Numbers the app computes stay numbers, so a delta of -3 is not quoted.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

// A whole file, byte order mark first, rows separated by CRLF.
export function toCsv(rows: CsvCell[][]): string {
  return CSV_BOM + rows.map(csvRow).join("\r\n");
}
