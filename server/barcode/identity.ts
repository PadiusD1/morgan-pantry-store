import { gtinCheckDigitValid, restrictedCirculation, strictGtin } from "@shared/gtin";

const GTIN_LENGTHS = [8, 12, 13, 14];

/**
 * The reason a scanned code cannot identify a trade item, or null.
 *
 * Nothing but a valid, globally meaningful GTIN reaches an external provider.
 * A nine-digit fragment, a mistyped check digit and a local alphanumeric SKU
 * are each refused with their own explanation, because adopting a stranger's
 * product record for a code that merely looks like a UPC is worse than asking
 * staff to type the item in. A store-local or variable-measure code is refused
 * for a different reason: its weight and price belong to one package in one
 * shop, so no product database can hold a correct answer for it.
 */
export function identityProblemFor(barcode: string): string | null {
  const code = (barcode ?? "").trim();

  if (strictGtin(code) === null) {
    if (!/^\d+$/.test(code)) {
      return "This code contains characters that are not digits, so it is a local identifier rather than a barcode. Enter the item details by hand.";
    }
    if (!GTIN_LENGTHS.includes(code.length)) {
      return `A barcode has 8, 12, 13 or 14 digits and this one has ${code.length}. Scan it again or enter the item by hand.`;
    }
    if (!gtinCheckDigitValid(code)) {
      return "This barcode's check digit does not match, so it was misread or mistyped. Scan it again or enter the item by hand.";
    }
    return "This is not a GTIN-8, UPC-A, EAN-13 or GTIN-14 barcode. Enter the item details by hand.";
  }

  const restricted = restrictedCirculation(code);
  if (restricted) {
    return `${restricted.reason} Enter this item by hand and weigh the package, because no product database can hold a correct weight or price for a store-local code.`;
  }
  return null;
}
