import { csvCell } from "@shared/csv";

// Lines of the monthly summary CSV. The text cells go through the shared
// writer so a category or item name that starts like a formula is guarded,
// while the number cells keep their fixed decimals and are never guarded.

export function monthlyItemLine(
  category: string,
  itemName: string,
  quantity: number,
  costPerUnit: number,
  total: number,
): string {
  return [
    csvCell(category),
    csvCell(itemName),
    quantity.toString(),
    costPerUnit.toFixed(2),
    total.toFixed(2),
  ].join(",");
}

export function monthlySubtotalLine(category: string, total: number): string {
  return `${csvCell(`${category} subtotal`)},,,,${total.toFixed(2)}`;
}

// The Generated time is read by staff in Baltimore, so it is written in New
// York time with its zone, EDT or EST, whatever zone the server runs in. The
// value holds a comma, so it goes through csvCell to stay one cell.
const GENERATED_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

/** The Generated time in New York time with its zone, spaces made plain. */
export function generatedValue(now: Date): string {
  // Newer ICU puts a narrow no break space before AM or PM, so any space
  // becomes a plain one and the cell reads the same on every Node version.
  return GENERATED_FORMAT.format(now).replace(/\s+/g, " ");
}

export function monthlyGeneratedLine(now: Date): string {
  return `Generated,${csvCell(generatedValue(now))}`;
}

const EASTERN_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** A stored UTC time as its calendar date in Baltimore, whatever zone the server runs in. */
export function easternDate(value: string | Date): string {
  return EASTERN_DATE_FORMAT.format(new Date(value));
}

const EASTERN_MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "numeric",
});

/**
 * The year and month a stored UTC time falls in on the Baltimore calendar,
 * whatever zone the server runs in, so an evening check out on the last day
 * of a month counts in that month and never in the next one.
 */
export function easternYearMonth(value: Date): { year: number; month: number } {
  const parts = EASTERN_MONTH_FORMAT.formatToParts(value);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}
