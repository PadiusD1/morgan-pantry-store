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

export function monthlyGeneratedLine(now: Date): string {
  // Newer ICU puts a narrow no break space before AM or PM, so any space
  // becomes a plain one and the cell reads the same on every Node version.
  const value = GENERATED_FORMAT.format(now).replace(/\s+/g, " ");
  return `Generated,${csvCell(value)}`;
}
