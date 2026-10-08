import { CSV_BOM, csvCell, csvRow } from "@shared/csv";

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

export type MonthlyCsvRow = {
  tx_id: string;
  ts: string | Date;
  is_emergency: boolean;
  inv_id: string;
  item_name: string;
  quantity: number | string;
  value_per_unit: number | string;
  category: string | null;
};

/** Build the annual item summary from saved checkout lines, never current prices. */
export function buildMonthlyCsv(rows: MonthlyCsvRow[], options: { year?: string | null; emergencyOnly?: boolean; now?: Date } = {}): string {
  type ItemTotal = { name: string; quantity: number; cents: number };
  type CategoryTotal = { items: Map<string, ItemTotal>; cents: number };
  type MonthTotal = { categories: Map<string, CategoryTotal>; cents: number; emergencyIds: Set<string> };
  const years = new Map<number, Map<number, MonthTotal>>();
  for (const row of rows) {
    if (options.emergencyOnly && !row.is_emergency) continue;
    const timestamp = new Date(row.ts);
    if (Number.isNaN(timestamp.getTime())) continue;
    const { year, month } = easternYearMonth(timestamp);
    if (options.year && String(year) !== options.year) continue;
    const quantity = Number(row.quantity) || 0;
    const cents = quantity * Math.round((Number(row.value_per_unit) || 0) * 100);
    const categoryName = row.category || "Uncategorized";
    const itemName = row.item_name || "Unknown item";

    let yearTotal = years.get(year);
    if (!yearTotal) { yearTotal = new Map(); years.set(year, yearTotal); }
    let monthTotal = yearTotal.get(month);
    if (!monthTotal) {
      monthTotal = { categories: new Map(), cents: 0, emergencyIds: new Set() };
      yearTotal.set(month, monthTotal);
    }
    // A checkout has several lines; each emergency appointment counts only once.
    if (row.is_emergency) monthTotal.emergencyIds.add(row.tx_id);
    monthTotal.cents += cents;
    let categoryTotal = monthTotal.categories.get(categoryName);
    if (!categoryTotal) { categoryTotal = { items: new Map(), cents: 0 }; monthTotal.categories.set(categoryName, categoryTotal); }
    categoryTotal.cents += cents;
    // Separate identical names that refer to different inventory records.
    const key = `${row.inv_id || ""}\u0000${itemName}`;
    const itemTotal = categoryTotal.items.get(key) ?? { name: itemName, quantity: 0, cents: 0 };
    itemTotal.quantity += quantity;
    itemTotal.cents += cents;
    categoryTotal.items.set(key, itemTotal);
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const lines = [
    `Morgan State FRC Monthly Summary${options.emergencyOnly ? " (Emergency Shop Appointments only)" : ""}`,
    monthlyGeneratedLine(options.now ?? new Date()),
    csvRow(["Reporting year", options.year || "All recorded years"]),
    "Calendar timezone,America/New_York",
    csvRow(["Valuation", "Estimated unit values are weighted averages rounded to two decimals. Line totals use values saved with each checkout; categories reflect current inventory records."]),
    "",
  ];
  for (const [year, months] of [...years.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`Year,${year}`);
    let yearCents = 0;
    let yearEmergencies = 0;
    for (const [month, total] of [...months.entries()].sort((a, b) => a[0] - b[0])) {
      yearCents += total.cents;
      yearEmergencies += total.emergencyIds.size;
      lines.push("", `Month,${monthNames[month - 1]} ${year}`);
      if (total.emergencyIds.size) lines.push(`Emergency Shop Appointments,${total.emergencyIds.size}`);
      lines.push("Category,Item,Quantity,Weighted average estimated value per unit (USD),Line total (USD)");
      for (const [category, subtotal] of [...total.categories.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        for (const item of [...subtotal.items.values()].sort((a, b) => a.name.localeCompare(b.name))) {
          const value = item.cents / 100;
          lines.push(monthlyItemLine(category, item.name, item.quantity, item.quantity ? value / item.quantity : 0, value));
        }
        lines.push(monthlySubtotalLine(category, subtotal.cents / 100));
      }
      lines.push(`${monthNames[month - 1]} ${year} total,,,,${(total.cents / 100).toFixed(2)}`);
    }
    lines.push("", `${year} GRAND TOTAL,,,,${(yearCents / 100).toFixed(2)}`);
    if (yearEmergencies) lines.push(`${year} Emergency Shop Appointments,,,,${yearEmergencies}`);
    lines.push("");
  }
  if (!years.size) lines.push("No distribution records found for the selected filter.");
  return CSV_BOM + lines.join("\r\n");
}
