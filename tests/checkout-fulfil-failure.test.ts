import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FULFIL_REFUSAL, FULFIL_UNCERTAIN, fulfilFailure } from "@/lib/checkout-failure";

// Finding I of the round 2 review. The fulfil path of the check out page said
// a lost response could not be completed, although the request may already be
// fulfilled. A lost response or a 5xx must use the uncertain outcome wording.

describe("fulfil failure text", () => {
  it("says a lost response may already be completed, never that it could not be", () => {
    const t = fulfilFailure(new TypeError("Failed to fetch"));
    expect(t.description).toBe(FULFIL_UNCERTAIN);
    expect(t.description).toMatch(/may already be completed/);
    expect(t.description).not.toMatch(/could not be/);
    expect(t.title).not.toMatch(/failed/i);
  });

  it("treats a 5xx as uncertain", () => {
    expect(fulfilFailure(new Error('502: {"message":"Bad Gateway"}')).description).toBe(FULFIL_UNCERTAIN);
  });

  it("shows the server message for a known refusal", () => {
    const t = fulfilFailure(new Error('400: {"message":"Request already fulfilled"}'));
    expect(t.title).toBe("Fulfillment failed");
    expect(t.description).toBe("Request already fulfilled");
  });

  it("falls back to the refusal text for a 4xx with no message", () => {
    expect(fulfilFailure(new Error("404: ")).description).toBe(FULFIL_REFUSAL);
  });

  it("is the text the check out page shows and the page refreshes the requests", () => {
    const page = readFileSync(path.resolve(__dirname, "../client/src/pages/check-out.tsx"), "utf8");
    const branch = page.slice(page.indexOf("Failed to mark request as fulfilled"));
    const catchBlock = branch.slice(0, branch.indexOf("return;"));
    expect(catchBlock).toMatch(/fulfilFailure\(e\)/);
    expect(catchBlock).toMatch(/invalidateQueries\(\{ queryKey: \["\/api\/requests"\] \}\)/);
    expect(catchBlock).not.toMatch(/could not be completed/);
  });
});
