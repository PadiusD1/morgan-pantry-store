import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requestActionErrorText } from "@/lib/request-action";

const refused = new Error(`400: {"message":"Cannot approve request with status 'cancelled'"}`);

describe("requestActionErrorText", () => {
  it("shows the server message in plain words, no status code, braces or quotes", () => {
    const text = requestActionErrorText(refused);
    expect(text).toBe("Cannot approve request with status cancelled.");
    expect(text).not.toMatch(/[{}:;"']|400/);
  });

  it("uses a plain fallback when the body is not JSON", () => {
    const text = requestActionErrorText(new Error("502: <html>Bad Gateway</html>"));
    expect(text).toBe("The request was not changed. The list is refreshed, please check it and try again.");
    expect(text).not.toMatch(/[{}:;<>]|502/);
  });

  it("uses the plain fallback for an error with no message field", () => {
    expect(requestActionErrorText(new Error(`500: {"error":"x"}`))).toBe(
      "The request was not changed. The list is refreshed, please check it and try again.",
    );
    expect(requestActionErrorText("boom")).toBe(
      "The request was not changed. The list is refreshed, please check it and try again.",
    );
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

  it("shows the mapped text, never e.message as is", () => {
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
