import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Finding 1 on the page. The check out payload comes from the identity
// resolution, and a refusal is a pinned toast sent before any save, so the
// form and cart stay as they were.

const source = readFileSync(path.join(__dirname, "..", "client", "src", "pages", "check-out.tsx"), "utf8");
const submit = source.slice(source.indexOf("async function submitCheckOut"));

describe("check out page identity", () => {
  it("builds the payload from the resolution and never from the old email fallback", () => {
    expect(source).not.toMatch(/findReturningClient/);
    expect(submit).toMatch(/resolveCheckoutIdentity\(clients,/);
    expect(submit).toMatch(/existing:\s*identity\.existing/);
    expect(submit).toMatch(/name:\s*identity\.name/);
  });

  it("refuses with a destructive toast before any request or cart change", () => {
    const refusal = submit.indexOf("if (!identity.ok)");
    expect(refusal).toBeGreaterThan(0);
    const branch = submit.slice(refusal, submit.indexOf("const clientPayload", refusal));
    expect(branch).toMatch(/variant:\s*"destructive"/);
    expect(branch).toMatch(/description:\s*identity\.message/);
    expect(branch).toMatch(/return;/);
    expect(branch).not.toMatch(/setCart|apiRequest|recordOutbound/);
    for (const later of ["apiRequest(", "recordOutbound(", "setCart([])"]) {
      expect(submit.indexOf(later)).toBeGreaterThan(refusal);
    }
  });
});
