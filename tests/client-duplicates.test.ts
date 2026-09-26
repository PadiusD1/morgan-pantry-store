import { describe, expect, it, vi } from "vitest";

const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] as unknown[] }));
vi.mock("../server/pg", () => ({ pool: { query } }));

import {
  CANDIDATE_SQL,
  checkClientDuplicate,
  sqlCandidateLookup,
  type CandidateProbe,
} from "../server/client-duplicates";
import { duplicateMessage, GENERIC_DUPLICATE_MESSAGE } from "@shared/identity";

const stored = {
  id: "a1",
  name: "Test Student One",
  identifier: "T0000001",
  email: "student.one@example.test",
  phone: "5550100001",
  clientType: "student",
};

function fakeLookup(rows: typeof stored[]) {
  const probes: CandidateProbe[] = [];
  const lookup = async (probe: CandidateProbe) => {
    probes.push(probe);
    return rows;
  };
  return { probes, lookup };
}

describe("checkClientDuplicate", () => {
  it("probes with normalised fields and the client type, then refuses a two field match", async () => {
    const { probes, lookup } = fakeLookup([stored]);
    const d = await checkClientDuplicate(
      { name: " Test  Student One ", identifier: "T0000009", email: "STUDENT.ONE@example.test", phone: "+1 555 010 0001" },
      null,
      lookup,
    );
    expect(probes).toEqual([
      { clientType: "student", name: "test student one", studentId: "t0000009", email: "student.one@example.test", phone: "5550100001" },
    ]);
    expect(d.duplicate).toBe(true);
    if (d.duplicate) expect(duplicateMessage(d.match)).toBe("Test Student One is already in");
  });

  it("skips the query when fewer than two fields are filled", async () => {
    const { probes, lookup } = fakeLookup([stored]);
    const d = await checkClientDuplicate({ name: "Test Student One", identifier: "Test Student One" }, null, lookup);
    expect(d.duplicate).toBe(false);
    expect(probes).toHaveLength(0);
  });

  it("keeps a legacy duplicate editable on update", async () => {
    const twin = { ...stored, id: "a2", identifier: "T0000002" };
    const { lookup } = fakeLookup([stored, twin]);
    const d = await checkClientDuplicate({ ...stored, notes: "moved" } as typeof stored, stored, lookup);
    expect(d.duplicate).toBe(false);
  });

  it("refuses an update whose change creates the match", async () => {
    const other = { ...stored, id: "a3", name: "Test Student Three", identifier: "T0000003", email: "three@example.test", phone: "5550100003" };
    const { lookup } = fakeLookup([other]);
    const after = { ...stored, email: "three@example.test", phone: "555 010 0003" };
    const d = await checkClientDuplicate(after, stored, lookup);
    expect(d.duplicate).toBe(true);
    if (d.duplicate) expect(d.match.id).toBe("a3");
  });

  it("never blocks a student with a partner contact", async () => {
    const partner = { ...stored, id: "p1", identifier: "PARTNER-1", clientType: "partner" };
    const { lookup } = fakeLookup([partner]);
    const d = await checkClientDuplicate({ ...stored, id: undefined, identifier: "T0000009" } as any, null, lookup);
    expect(d.duplicate).toBe(false);
  });

  it("the generic signup message names nobody", () => {
    expect(GENERIC_DUPLICATE_MESSAGE).not.toContain("Test");
    expect(GENERIC_DUPLICATE_MESSAGE).not.toMatch(/[:;]/);
  });
});

describe("sqlCandidateLookup", () => {
  it("sends one parameterised query in the probe order", async () => {
    query.mockClear();
    await sqlCandidateLookup({ clientType: "student", name: "n", studentId: "s", email: "e", phone: "p" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toBe(CANDIDATE_SQL);
    expect(query.mock.calls[0][1]).toEqual(["student", "n", "s", "e", "p"]);
    expect(CANDIDATE_SQL).toContain("'^1(\\d{10})$', '\\1'");
    expect(CANDIDATE_SQL).toContain(">= 2");
  });
});
