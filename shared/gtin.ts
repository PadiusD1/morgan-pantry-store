/**
 * GTIN identity for scanned barcodes.
 *
 * GS1 keeps the product identifier and the price apart: an ordinary UPC or EAN
 * carries neither a description nor a price, so a price only ever arrives from a
 * separate dated observation by a named retailer. Variable-measure and
 * store-local codes are the exception that proves the rule. They are allocated
 * for restricted circulation inside one retailer, the same digits mean different
 * things in different shops, and part of the number encodes a weight or a price
 * that changes per package. They must never become a global product identifier
 * carrying one permanent package weight.
 *
 * Two jobs live here and are deliberately kept apart.
 *
 * `strictGtin` is the only identity accepted for talking to an external
 * provider or for deciding that two records are the same trade item. It admits
 * nothing but a digits-only GTIN-8, UPC-A, EAN-13 or GTIN-14 whose check digit
 * verifies. A nine-digit fragment, a mistyped check digit and a local string
 * like "SKU-012345678905" are all refused, because stripping the letters off
 * that SKU would alias a genuine UPC and adopt a stranger's product data.
 *
 * `barcodeIsSameRecord` is the looser comparison used against our own saved
 * rows, which may hold legacy identifiers that were never GTINs. It compares
 * valid GTINs across their renderings and falls back to exact text equality,
 * so a legacy identifier keeps its own identity instead of being merged.
 *
 * References read 2026-10-21:
 *   https://support.gs1.org/support/solutions/articles/43000734158-are-the-description-and-price-of-the-item-included-in-the-barcode-
 *   https://www.help.gs1us.org/is-this-item-variable-measure
 */

const GTIN_LENGTHS = [8, 12, 13, 14];

/** The standard GS1 mod-10 check digit over every digit but the last. */
export function gtinCheckDigitValid(code: string | null | undefined): boolean {
  const digits = (code ?? "").trim();
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  // Weights alternate 3 and 1, starting at 3 on the rightmost body digit.
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1));
}

/**
 * The canonical GTIN-14 for a code that really is a GTIN, or null.
 *
 * Strict by design: digits only, a supported length, and a check digit that
 * verifies. UPC-A 012345678905, EAN-13 0012345678905 and GTIN-14
 * 00012345678905 are the same trade item and all canonicalise alike.
 */
export function strictGtin(code: string | null | undefined): string | null {
  const digits = (code ?? "").trim();
  if (!/^\d+$/.test(digits)) return null;
  if (!GTIN_LENGTHS.includes(digits.length)) return null;
  if (!gtinCheckDigitValid(digits)) return null;
  return digits.padStart(14, "0");
}

/** Exact trade-item equality, for provider matching and adoption. */
export function sameGtin(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = strictGtin(a);
  const right = strictGtin(b);
  return left !== null && right !== null && left === right;
}

/**
 * Whether a scanned code and a saved barcode denote the same stored record.
 * Valid GTINs compare across renderings; anything else must match exactly, so
 * a legacy identifier is never silently merged into a GTIN.
 */
export function barcodeIsSameRecord(scanned: string | null | undefined, saved: string | null | undefined): boolean {
  if (sameGtin(scanned, saved)) return true;
  const left = (scanned ?? "").trim();
  const right = (saved ?? "").trim();
  return left.length > 0 && left === right;
}

/**
 * Every rendering of a scanned code that could be stored on an existing row:
 * the text as scanned plus, for a valid GTIN, its GTIN-14, EAN-13 and UPC-A
 * forms. Used to find an already-saved item instead of creating a duplicate.
 */
export function barcodeLookupForms(code: string | null | undefined): string[] {
  const raw = (code ?? "").trim();
  const forms = new Set<string>();
  if (raw) forms.add(raw);
  const gtin = strictGtin(raw);
  if (gtin) {
    forms.add(gtin);
    // Each shorter rendering is only valid when the digits it drops are zeros.
    for (const length of [13, 12, 8]) {
      const trimmed = gtin.slice(14 - length);
      if (trimmed.length === length && gtin.slice(0, 14 - length) === "0".repeat(14 - length)) {
        forms.add(trimmed);
      }
    }
  }
  return [...forms];
}

export type RestrictedCirculation = {
  restricted: true;
  /** Why the code is not a global product identifier. */
  reason: string;
};

/**
 * Codes allocated for restricted circulation inside one shop, which includes
 * variable-measure (random weight) items from a deli, bakery or meat counter.
 * GS1 reserves prefixes 020 to 029, 040 to 049 and 200 to 299 for restricted
 * distribution, and UPC-A number system digits 2 and 4 mean the same in the
 * 12-digit rendering. Only a code that is already a valid GTIN is classified;
 * anything else has no identity to restrict.
 */
export function restrictedCirculation(code: string | null | undefined): RestrictedCirculation | null {
  const gtin = strictGtin(code);
  if (!gtin) return null;
  const digits = (code ?? "").trim();

  if (digits.length === 12) {
    if (digits[0] === "2") {
      return { restricted: true, reason: "UPC-A number system 2 is a store-local variable-measure code, so its weight and price belong to one package in one shop." };
    }
    if (digits[0] === "4") {
      return { restricted: true, reason: "UPC-A number system 4 is reserved for a retailer's own restricted use, so the same digits mean different items in different shops." };
    }
    return null;
  }

  // Compare on the 13-digit rendering so a GTIN-14 packaging indicator cannot
  // shift the GS1 prefix.
  const ean13 = gtin.slice(1);
  const prefix = Number(ean13.slice(0, 3));
  if ((prefix >= 20 && prefix <= 29) || (prefix >= 40 && prefix <= 49) || (prefix >= 200 && prefix <= 299)) {
    return { restricted: true, reason: `GS1 prefix ${ean13.slice(0, 3)} is allocated for restricted distribution inside one retailer, so this code is not a global product identifier.` };
  }
  return null;
}

/** True only for a valid, globally meaningful trade-item identifier. */
export function usableAsProductIdentifier(code: string | null | undefined): boolean {
  return strictGtin(code) !== null && restrictedCirculation(code) === null;
}
