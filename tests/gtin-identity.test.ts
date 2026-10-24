import { describe, expect, it } from "vitest";
import {
  barcodeIsSameRecord,
  barcodeLookupForms,
  gtinCheckDigitValid,
  restrictedCirculation,
  sameGtin,
  strictGtin,
  usableAsProductIdentifier,
} from "@shared/gtin";

// 012345678905 is a valid UPC-A: its mod-10 check digit verifies.
const VALID_UPC_A = "012345678905";

describe("strictGtin", () => {
  it("accepts the four GTIN lengths and canonicalises them to one key", () => {
    expect(strictGtin(VALID_UPC_A)).toBe("00012345678905");
    expect(strictGtin("0012345678905")).toBe("00012345678905");
    expect(strictGtin("00012345678905")).toBe("00012345678905");
  });

  it("refuses a length that is not a GTIN, so a fragment cannot become an identity", () => {
    // Codex review R1: nine digits previously canonicalised to 00000123456789.
    expect(strictGtin("123456789")).toBeNull();
    expect(strictGtin("1234567890")).toBeNull();
    expect(strictGtin("12345678901")).toBeNull();
  });

  it("refuses a code with any character that is not a digit", () => {
    // Codex review R1: stripping the letters off this SKU aliased a real UPC.
    expect(strictGtin("SKU-012345678905")).toBeNull();
    expect(strictGtin("012345678905 ")).toBe("00012345678905");
  });

  it("refuses a code whose check digit does not verify", () => {
    // Codex review R1: 012345678904 was previously treated as usable.
    expect(gtinCheckDigitValid("012345678904")).toBe(false);
    expect(strictGtin("012345678904")).toBeNull();
  });
});

describe("usableAsProductIdentifier", () => {
  it("is false for every code in the reproduced review case", () => {
    expect(usableAsProductIdentifier("123456789")).toBe(false);
    expect(usableAsProductIdentifier("SKU-012345678905")).toBe(false);
    expect(usableAsProductIdentifier("012345678904")).toBe(false);
  });

  it("is true for a valid, globally circulating GTIN", () => {
    expect(usableAsProductIdentifier(VALID_UPC_A)).toBe(true);
  });

  it("is false for a store-local variable-measure code", () => {
    // UPC-A number system 2 is a store's own random-weight range.
    const storeLocal = "212345678909";
    expect(gtinCheckDigitValid(storeLocal)).toBe(true);
    expect(restrictedCirculation(storeLocal)?.restricted).toBe(true);
    expect(usableAsProductIdentifier(storeLocal)).toBe(false);
  });

  it("does not classify an invalid code as restricted, because it has no identity to restrict", () => {
    expect(restrictedCirculation("2000000100017")).toBeNull();
  });
});

describe("sameGtin", () => {
  it("matches the UPC-A, EAN-13 and GTIN-14 renderings of one trade item", () => {
    expect(sameGtin(VALID_UPC_A, "0012345678905")).toBe(true);
    expect(sameGtin("00012345678905", VALID_UPC_A)).toBe(true);
  });

  it("never matches two invalid codes, even when their digits agree", () => {
    expect(sameGtin("123456789", "123456789")).toBe(false);
    expect(sameGtin("SKU-012345678905", VALID_UPC_A)).toBe(false);
  });
});

describe("barcodeIsSameRecord", () => {
  it("treats the renderings of one GTIN as the same saved item", () => {
    expect(barcodeIsSameRecord(VALID_UPC_A, "0012345678905")).toBe(true);
  });

  it("keeps a legacy identifier distinct unless it matches exactly", () => {
    expect(barcodeIsSameRecord("SKU-012345678905", VALID_UPC_A)).toBe(false);
    expect(barcodeIsSameRecord("SKU-012345678905", "SKU-012345678905")).toBe(true);
  });

  it("does not match an empty code against an empty saved value", () => {
    expect(barcodeIsSameRecord("", "")).toBe(false);
  });
});

describe("barcodeLookupForms", () => {
  it("offers every rendering a saved row might hold for one GTIN", () => {
    expect(barcodeLookupForms(VALID_UPC_A).sort()).toEqual(
      ["00012345678905", "0012345678905", "012345678905"].sort(),
    );
  });

  it("offers only the raw text for a non-GTIN identifier", () => {
    expect(barcodeLookupForms("SKU-01234")).toEqual(["SKU-01234"]);
  });

  it("does not invent a shorter rendering that would drop a significant digit", () => {
    // A GTIN-14 with a packaging indicator has no valid 13-digit form.
    const gtin14 = "10012345678902";
    expect(gtinCheckDigitValid(gtin14)).toBe(true);
    expect(barcodeLookupForms(gtin14)).toEqual([gtin14]);
  });
});
