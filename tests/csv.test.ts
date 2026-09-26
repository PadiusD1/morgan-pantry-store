import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvRow, toCsv } from "@shared/csv";

describe("csvCell", () => {
  it("keeps a negative number the app computes as a number", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(-76.58)).toBe("-76.58");
    expect(csvCell(0)).toBe("0");
  });

  it("writes empty for null, undefined and non finite numbers", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("prefixes a quote to a name starting with an equals sign", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("prefixes a quote to text starting with plus, minus, at, tab or carriage return", () => {
    expect(csvCell("+15555550100")).toBe("'+15555550100");
    expect(csvCell("-3")).toBe("'-3");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("\tTest")).toBe("'\tTest");
    expect(csvCell("\rTest")).toBe("\"'\rTest\"");
  });

  it("quotes commas, quotes and line breaks and doubles inner quotes", () => {
    expect(csvCell("Test Student, One")).toBe("\"Test Student, One\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("line one\nline two")).toBe("\"line one\nline two\"");
    expect(csvCell("a\r\nb")).toBe("\"a\r\nb\"");
  });

  it("leaves plain text alone", () => {
    expect(csvCell("Bottled Water")).toBe("Bottled Water");
    expect(csvCell("test.student@example.com")).toBe("test.student@example.com");
  });
});

describe("csvRow and toCsv", () => {
  it("joins cells with commas", () => {
    expect(csvRow(["Water, 24 pack", -3, "=cmd", 80])).toBe("\"Water, 24 pack\",-3,'=cmd,80");
  });

  it("writes one byte order mark first and CRLF between rows", () => {
    const text = toCsv([["name", "qty"], ["Test Student One", 2]]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.indexOf(CSV_BOM, 1)).toBe(-1);
    expect(text).toBe(`${CSV_BOM}name,qty\r\nTest Student One,2`);
  });
});
