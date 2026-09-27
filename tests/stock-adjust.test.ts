import { describe, expect, it } from "vitest";
import { stockAdjustFailure } from "../client/src/lib/stock-adjust";

// Review round 2 finding 5 (E). A plus or minus click whose outcome is unknown
// must never tell staff the stock was not changed, or the retry click applies
// the change twice.
const uncertain: Array<[string, unknown]> = [
  ["a lost response", new TypeError("Failed to fetch")],
  ["a 500 with a server message", new Error('500: {"message":"Internal error"}')],
  ["a 502 with no body", new Error("502: Bad Gateway")],
  ["the held 422", new Error('422: {"message":"This key was already used for a different save"}')],
];

describe("stock plus and minus failure text", () => {
  for (const [name, err] of uncertain) {
    it(`${name} says the change may already be recorded`, () => {
      const text = stockAdjustFailure(err);
      expect(text.title).toBe("Save not confirmed");
      expect(text.description).toMatch(/may already be recorded/);
      expect(text.description).toMatch(/refreshed to show the true count/);
      expect(text.description).not.toMatch(/not changed|try again/i);
    });
  }

  it("a 4xx refusal shows the server message as not saved", () => {
    const text = stockAdjustFailure(new Error('400: {"message":"There is not enough stock"}'));
    expect(text).toEqual({ title: "Not saved", description: "There is not enough stock" });
  });

  it("a 4xx refusal with no message says the stock was not changed", () => {
    const text = stockAdjustFailure(new Error("404: Not Found"));
    expect(text).toEqual({ title: "Not saved", description: "The stock was not changed. Please try again." });
  });

  it("no text has a colon, semicolon or dash", () => {
    for (const err of [...uncertain.map(([, e]) => e), new Error("404: Not Found")]) {
      const text = stockAdjustFailure(err);
      expect(`${text.title} ${text.description}`).not.toMatch(/[:;–—]|\s-\s/);
    }
  });
});
