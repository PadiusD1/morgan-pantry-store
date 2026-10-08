import { describe, expect, it } from "vitest";
import {
  attributeDonor,
  buildSourceOptions,
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
      { key: "donor:d1", kind: "donor", id: "d1", name: "Test Farm Two", organization: null },
      { key: "partner:p1", kind: "partner", id: "p1", name: "test pantry one", organization: "Test Org" },
    ]);
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

  it("falls back to a case blind name match for an old row, the active donor first", () => {
    expect(attributeDonor({ donorId: null, donor: "  TEST FARM " }, donors)).toBe("d2");
    expect(attributeDonor({ donor: "other donor" }, donors)).toBe("d3");
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
