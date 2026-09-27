import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Verdict finding 5 remainder on the page. The receipt a check out shows is
// built from the saved response, never from the cart, including the path where
// a retry reads back what an earlier try recorded.

const source = readFileSync(path.join(__dirname, "..", "client", "src", "pages", "check-out.tsx"), "utf8");
const submit = source.slice(source.indexOf("async function submitCheckOut"), source.indexOf("const totalUnits"));
const outbound = submit.slice(submit.indexOf("const location = locationFor(key)"));

describe("check out page receipt", () => {
  it("never builds receipt lines from the cart", () => {
    expect(submit).not.toMatch(/receiptItems/);
    expect(submit).not.toMatch(/cart[\s\S]{0,40}\.map\([\s\S]{0,200}quantity:\s*c\.quantity\s*\}/);
  });

  it("shows the receipt of a saved check out from the saved response", () => {
    const success = outbound.slice(outbound.indexOf("if (result?.client)"));
    expect(success).toMatch(/receiptFromSaved\(result\.saved,/);
    expect(success).not.toMatch(/setReceipt\(\{/);
  });

  it("shows what the earlier try recorded when a retry reads it back", () => {
    const earlier = outbound.slice(outbound.indexOf("if (isEarlierSaveRecorded(e))"));
    // The read back is settled under the old key first (finding A1), then shown.
    const branch = earlier.slice(0, earlier.indexOf("earlierSaveText("));
    expect(branch).toMatch(/settleEarlierSave\(e, key\)/);
    expect(branch).toMatch(/receiptFromSaved\(earlier\.recorded,/);
    expect(branch).toMatch(/setReceipt\(/);
  });
});
