import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_OUT_REFUSAL, CHECK_OUT_UNCERTAIN, checkOutFailure } from "@/lib/checkout-failure";
import { SAVE_STILL_RUNNING_MESSAGE, SESSION_EXPIRED_MESSAGE, SaveStillRunningError, SessionExpiredError } from "@/lib/queryClient";

// People row 3 of the attempt 11 rendered check. The response of a check out
// was lost after the row was written, and the page said the distribution
// could not be recorded. A lost response, a 5xx or a timeout is an uncertain
// outcome per the shared design and must say the save may already be recorded.

describe("check out failure text", () => {
  it("says a lost response may already be recorded, never that it could not be", () => {
    const t = checkOutFailure(new TypeError("Failed to fetch"), null);
    expect(t.description).toBe(CHECK_OUT_UNCERTAIN);
    expect(t.description).toMatch(/may already be recorded/);
    expect(t.description).not.toMatch(/could not be recorded/);
    expect(t.title).not.toMatch(/failed/i);
  });

  it("treats a 5xx as uncertain", () => {
    const t = checkOutFailure(new Error('500: {"message":"Internal Server Error"}'), null);
    expect(t.description).toBe(CHECK_OUT_UNCERTAIN);
  });

  it("shows the server message for a known refusal", () => {
    const t = checkOutFailure(new Error('400: {"message":"Quantity must be at least 1"}'), null);
    expect(t.title).toBe("Check-out failed");
    expect(t.description).toBe("Quantity must be at least 1");
  });

  it("falls back to the refusal text when a refusal has no message", () => {
    const t = checkOutFailure(new Error("400: Bad Request"), null);
    expect(t.description).toBe(CHECK_OUT_REFUSAL);
  });

  it("asks to wait on the held 409", () => {
    const t = checkOutFailure(new SaveStillRunningError('{"message":"This request is still being saved"}'), "This request is still being saved");
    expect(t.description).toBe(SAVE_STILL_RUNNING_MESSAGE);
  });

  it("keeps the sign in text for a 401", () => {
    const t = checkOutFailure(new SessionExpiredError("Unauthorized"), null);
    expect(t.description).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("passes a person refusal or a failed person update through", () => {
    const t = checkOutFailure(new Error("x"), "The visit was not recorded. The person's details may already be saved. Please try again.");
    expect(t.title).toBe("Check-out failed");
    expect(t.description).toMatch(/visit was not recorded/);
  });

  it("uses no colon, semicolon or dash in the new text", () => {
    for (const text of [CHECK_OUT_UNCERTAIN, checkOutFailure(new TypeError("Failed to fetch"), null).title]) {
      expect(text).not.toMatch(/[:;]|\s[-–—]\s/);
    }
  });
});

describe("check out page failure branch", () => {
  const source = readFileSync(path.join(__dirname, "..", "client", "src", "pages", "check-out.tsx"), "utf8");
  const submit = source.slice(source.indexOf("async function submitCheckOut"), source.indexOf("const totalUnits"));
  const outbound = submit.slice(submit.indexOf("const location = locationFor(key)"));
  const failure = outbound.slice(outbound.indexOf("if (isEarlierSaveRecorded(e))"), outbound.indexOf("if (result?.client)"));

  it("sorts a failed check out by the shared design instead of one could not be recorded text", () => {
    expect(failure).not.toMatch(/could not be recorded/);
    expect(failure).toMatch(/checkOutFailure\(e,/);
  });
});
