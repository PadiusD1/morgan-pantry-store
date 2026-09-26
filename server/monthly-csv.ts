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
