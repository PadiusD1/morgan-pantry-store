import { describe, expect, it } from "vitest";
import {
  attributeDonor,
  attributeDonorDetailed,
  attributeInboundRows,
  buildSourceOptions,
  donorsWithSharedNames,
  sourceFields,
  sourceNameOf,
} from "@shared/donation-source";
import { pickFields } from "@/lib/donation-source";

describe("buildSourceOptions", () => {
  it("lists donors and partners together, sorted by name, each with its kind", () => {
    const options = buildSourceOptions(
      [{ id: "d1", name: "Test Farm Two" }, { id: "d2", name: "  " }],
      [{ id: "p1", name: "test pantry one", organization: "Test Org" }],
    );
    expect(options).toEqual([
      {
        key: "donor:d1", kind: "donor", id: "d1", name: "Test Farm Two", organization: null,
        identityLabel: "Donor", identifier: null, searchHints: [],
      },
      {
        key: "partner:p1", kind: "partner", id: "p1", name: "test pantry one", organization: "Test Org",
        identityLabel: "Partner organization", identifier: null, searchHints: [],
      },
    ]);
  });

  it("lists student clients as a third kind, with their own identity label", () => {
    const options = buildSourceOptions(
      [],
      [],
      [{ id: "s1", name: "Test Student One", identifier: "TEST-1001", email: "student.one@example.test" }],
    );
    expect(options).toEqual([
      {
        key: "student:s1", kind: "student", id: "s1", name: "Test Student One", organization: null,
        identityLabel: "Student or client", identifier: "TEST-1001",
        searchHints: ["student.one@example.test"],
      },
    ]);
  });

  it("keeps a donor, a partner and a student with the same name as three options", () => {
    const options = buildSourceOptions(
      [{ id: "d1", name: "Same Name" }],
      [{ id: "p1", name: "Same Name" }],
      [{ id: "s1", name: "Same Name" }],
    );
    expect(options.map((o) => o.key)).toEqual(["donor:d1", "partner:p1", "student:s1"]);
  });

  it("keeps a donor and a partner with the same name as two options", () => {
    const options = buildSourceOptions([{ id: "d1", name: "Same Name" }], [{ id: "p1", name: "Same Name" }]);
    expect(options.map((o) => o.key)).toEqual(["donor:d1", "partner:p1"]);
  });
});

describe("sourceFields", () => {
  it("sends donor_id and the donor's name for a donor pick", () => {
    expect(sourceFields({ key: "donor:d1", kind: "donor", id: "d1", name: "Test Farm", organization: null }))
      .toEqual({ donor: "Test Farm", donorId: "d1" });
  });

  it("sends the partner as client_id for a partner pick, as today", () => {
    expect(sourceFields({ key: "partner:p1", kind: "partner", id: "p1", name: "Test Pantry", organization: null }))
      .toEqual({ donor: "Test Pantry", donorClientId: "p1" });
  });

  it("sends nothing when nothing is picked", () => {
    expect(sourceFields(undefined)).toEqual({});
  });
});

describe("sourceNameOf", () => {
  it("names the donor, else the partner, on IN rows only", () => {
    expect(sourceNameOf({ type: "IN", donor: "Test Farm", clientName: null })).toBe("Test Farm");
    expect(sourceNameOf({ type: "IN", donor: null, clientName: "Test Pantry" })).toBe("Test Pantry");
    expect(sourceNameOf({ type: "IN", donor: " ", clientName: null })).toBeNull();
    expect(sourceNameOf({ type: "OUT", donor: null, clientName: "Test Student One" })).toBeNull();
  });
});

describe("attributeDonor", () => {
  const donors = [
    { id: "d1", name: "Test Farm", status: "inactive" },
    { id: "d2", name: "test  farm", status: "active" },
    { id: "d3", name: "Other Donor" },
  ];

  it("attributes by donor_id when the row has one", () => {
    expect(attributeDonor({ donorId: "d3", donor: "Test Farm" }, donors)).toBe("d3");
  });

  it("does not fall back to the name when the donor_id is unknown", () => {
    expect(attributeDonor({ donorId: "gone", donor: "Test Farm" }, donors)).toBeNull();
  });

  it("does not attribute a same-name partner donation to a donor", () => {
    expect(attributeDonor({ clientId: "partner-1", donor: "Test Farm" }, donors)).toBeNull();
  });

  it("falls back to a case blind name match when exactly one donor carries the name", () => {
    expect(attributeDonor({ donor: "other donor" }, donors)).toBe("d3");
    expect(attributeDonor({ donorId: null, donor: "  OTHER DONOR " }, donors)).toBe("d3");
  });

  it("attributes nothing when two donor records share the name", () => {
    // This replaces an earlier expectation that the active record was chosen.
    // d1 and d2 both normalise to "test farm", so a row carrying only that
    // name belongs to neither: picking one turned a tie-break into a claim on
    // an individual's report. The row is reported as ambiguous instead and is
    // counted by attributeInboundRows so the gap stays visible.
    expect(attributeDonor({ donorId: null, donor: "  TEST FARM " }, donors)).toBeNull();
    expect(attributeDonorDetailed({ donorId: null, donor: "Test Farm" }, donors)).toEqual({
      kind: "ambiguous",
      candidates: ["d1", "d2"],
    });
  });

  it("counts what could not be attributed, so a total is never read as complete", () => {
    const { byDonor, coverage } = attributeInboundRows(
      [
        { donorId: "d3", donor: "Other Donor" },
        { donor: "Test Farm" },
        { donor: "Nobody At All" },
        { clientId: "partner-1", donor: "Test Farm" },
      ],
      donors,
    );
    expect([...byDonor.keys()]).toEqual(["d3"]);
    expect(coverage).toEqual({
      allocatedEntries: 1,
      ambiguousLegacyEntries: 1,
      unmatchedNameEntries: 1,
      clientSourcedEntries: 1,
    });
  });

  it("names the donor records whose shared name makes their own rows ambiguous", () => {
    expect([...donorsWithSharedNames(donors)].sort()).toEqual(["d1", "d2"]);
  });

  it("attributes nothing when neither matches", () => {
    expect(attributeDonor({ donor: "Nobody" }, donors)).toBeNull();
    expect(attributeDonor({ donor: null }, donors)).toBeNull();
  });
});

describe("pickFields", () => {
  it("finds or creates a new donor with a key derived from the save key", async () => {
    const calls: [string, string][] = [];
    const fields = await pickFields({ newName: "  Test Farm Three " }, "k1", async (name, key) => {
      calls.push([name, key]);
      return { id: "d9", name };
    });
    expect(calls).toEqual([["Test Farm Three", "k1:donor"]]);
    expect(fields).toEqual({ donor: "Test Farm Three", donorId: "d9" });
  });

  it("posts nothing for a pick from the list", async () => {
    const fields = await pickFields(
      { option: { key: "partner:p1", kind: "partner", id: "p1", name: "Test Pantry", organization: null } },
      "k1",
      async () => { throw new Error("should not post"); },
    );
    expect(fields).toEqual({ donor: "Test Pantry", donorClientId: "p1" });
  });
});
