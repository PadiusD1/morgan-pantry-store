import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientSaveRequest } from "@/lib/client-save";

// Rendered FAIL item 12. The Clients page matched a new person to an existing
// record by student ID and changed that person in place, so a mistyped ID
// renamed another student. A new person must always be a create, so the
// server's duplicate rule can refuse it by name.
describe("the Clients page save", () => {
  const fields = { name: "Test Student Three", identifier: "T0000003", householdSize: 1 };

  it("sends a new person as a create even when the student ID is already on file", () => {
    const req = clientSaveRequest(undefined, fields);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/clients");
    expect(req.body).toMatchObject({ name: "Test Student Three", identifier: "T0000003" });
  });

  it("sends an edit of a known person to that person only", () => {
    const req = clientSaveRequest("client-1", fields);
    expect(req.method).toBe("PATCH");
    expect(req.url).toBe("/api/clients/client-1");
  });

  it("never routes the page through the merging upsert", () => {
    const page = readFileSync("client/src/pages/clients.tsx", "utf8");
    expect(page).not.toMatch(/upsertClient/);
    expect(page).toMatch(/clientSaveRequest/);
  });
});
