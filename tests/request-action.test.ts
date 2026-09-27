import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requestActionErrorText, requestActionErrorTitle } from "@/lib/request-action";

const refused = new Error(`400: {"message":"Cannot approve request with status 'cancelled'"}`);

describe("requestActionErrorText", () => {
  it("shows the server message in plain words, no status code, braces or quotes", () => {
    const text = requestActionErrorText(refused);
    expect(text).toBe("Cannot approve request with status cancelled.");
    expect(text).not.toMatch(/[{}:;"']|400/);
  });

  // Review round 2 finding F. A lost response or a 5xx on a committed
  // transition must never say the request was not changed.
  const UNCERTAIN = "The change may already be recorded. The list is refreshed to show the current status.";
  const uncertain: Array<[string, unknown]> = [
    ["a lost response", new TypeError("Failed to fetch")],
    ["a 502 with an HTML body", new Error("502: <html>Bad Gateway</html>")],
    ["a 500 with no message field", new Error(`500: {"error":"x"}`)],
    ["a 500 with a message", new Error(`500: {"message":"Internal error"}`)],
    ["an error that is not an Error", "boom"],
  ];
  for (const [name, err] of uncertain) {
    it(`${name} says the change may already be recorded`, () => {
      const text = requestActionErrorText(err);
      expect(text).toBe(UNCERTAIN);
      expect(text).not.toMatch(/not changed|[{}:;<>]|50\d/);
      expect(requestActionErrorTitle(err)).toBe("Change not confirmed");
    });
  }

  it("a refusal with no message field keeps the not changed fallback", () => {
    expect(requestActionErrorText(new Error(`409: {"error":"x"}`))).toBe(
      "The request was not changed. The list is refreshed, please check it and try again.",
    );
    expect(requestActionErrorTitle(new Error(`409: {"error":"x"}`))).toBe("Not changed");
    expect(requestActionErrorTitle(refused)).toBe("Not changed");
  });

  it("turns underscores in a status into spaces", () => {
    expect(requestActionErrorText(new Error(`400: {"message":"Cannot deny request with status 'ready_for_pickup'"}`))).toBe(
      "Cannot deny request with status ready for pickup.",
    );
  });
});

describe("Requests page transition error path", () => {
  const src = readFileSync(path.resolve(__dirname, "../client/src/pages/requests.tsx"), "utf8");
  const catchBlock = src.slice(src.indexOf("} catch (e: any) {", src.indexOf("async function doAction")), src.indexOf("} finally {", src.indexOf("async function doAction")));

  it("shows the mapped title and text, never e.message as is", () => {
    expect(catchBlock).toContain("title: requestActionErrorTitle(e)");
    expect(catchBlock).toContain("requestActionErrorText(e)");
    expect(catchBlock).not.toContain("description: e.message");
  });

  it("refetches the requests list after a refused transition", () => {
    expect(catchBlock).toContain('queryKey: ["/api/requests"]');
  });
});

describe("requestActionSuccessText", () => {
  it("says what happened in plain words with no hyphen for every staff action", async () => {
    const { requestActionSuccessText } = await import("@/lib/request-action");
    expect(requestActionSuccessText("approve")).toBe("Request approved.");
    expect(requestActionSuccessText("deny")).toBe("Request denied.");
    expect(requestActionSuccessText("fulfill")).toBe("Request fulfilled.");
    expect(requestActionSuccessText("cancel")).toBe("Request cancelled.");
    expect(requestActionSuccessText("no-show")).toBe("Request marked as no show.");
    for (const action of ["approve", "deny", "fulfill", "cancel", "no-show", "something-new"]) {
      expect(requestActionSuccessText(action)).not.toMatch(/[-–—:;]/);
    }
  });
});
