import { describe, expect, it } from "vitest";
import { AmbiguousDonorError, findOrCreateDonor, resolveDonor, type DonorStore } from "../server/donor-find-or-create";
import type { Donor, InsertDonor } from "@shared/schema";

const donor = (over: Partial<Donor>): Donor =>
  ({
    id: "d-0",
    name: "Test Donor",
    organization: null,
    contactName: null,
    phone: null,
    email: null,
    address: null,
    notes: null,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  }) as Donor;

function storeOf(existing: Donor[]): DonorStore & { created: InsertDonor[] } {
  const created: InsertDonor[] = [];
  return {
    created,
    findDonorsByNormalisedName: async () => existing,
    createDonor: async (data) => {
      created.push(data);
      return donor({ id: `d-new-${created.length}`, ...(data as Partial<Donor>) });
    },
  };
}

describe("resolveDonor", () => {
  it("creates a donor when the name is new", async () => {
    const store = storeOf([]);
    const result = await resolveDonor(store, { name: "Test Pantry Friend", status: "active" } as InsertDonor);
    expect(result.kind).toBe("created");
    expect(store.created).toHaveLength(1);
  });

  it("reuses a stored donor when only a name was typed, as the inline flow does", async () => {
    const store = storeOf([donor({ id: "d-1", name: "Test Donor", email: "person.a@example.test" })]);
    const result = await resolveDonor(store, { name: "test donor", status: "active" } as InsertDonor);
    expect(result).toMatchObject({ kind: "existing" });
    expect(store.created).toHaveLength(0);
  });

  it("does not collapse two people when the submitted email and phone both disagree", async () => {
    // Codex review R10: person-a was silently returned for person-b's details.
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor", email: "person.a@example.test", phone: "410-555-0100" }),
    ]);
    const result = await resolveDonor(store, {
      name: "Test Donor",
      email: "person.b@example.test",
      phone: "410-555-0199",
      status: "active",
    } as InsertDonor);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.id)).toEqual(["d-a"]);
      expect(result.reason).toMatch(/other contact details/);
    }
    expect(store.created).toHaveLength(0);
  });

  it("reuses the stored donor a submitted email positively confirms", async () => {
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor", email: "person.a@example.test" }),
      donor({ id: "d-b", name: "Test Donor", email: "person.b@example.test" }),
    ]);
    // Only d-b is uncontradicted and confirmed; d-a's email disagrees.
    const result = await resolveDonor(store, {
      name: "Test Donor",
      email: "person.b@example.test",
      status: "active",
    } as InsertDonor);
    expect(result).toMatchObject({ kind: "existing" });
    if (result.kind === "existing") expect(result.donor.id).toBe("d-b");
  });

  it("matches a phone written in another format", async () => {
    const store = storeOf([donor({ id: "d-a", name: "Test Donor", phone: "+1 (410) 555-0100" })]);
    const result = await resolveDonor(store, {
      name: "Test Donor",
      phone: "4105550100",
      status: "active",
    } as InsertDonor);
    expect(result).toMatchObject({ kind: "existing" });
  });

  it("asks staff to choose when several same-name donors are all active", async () => {
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor" }),
      donor({ id: "d-b", name: "Test Donor" }),
    ]);
    const result = await resolveDonor(store, { name: "Test Donor", status: "active" } as InsertDonor);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.reason).toMatch(/2 donors are named/);
  });

  it("stays ambiguous when two same-name records differ only by status", async () => {
    // Codex review R10 follow-up: status is not identity, so preferring the
    // active record would be a guess about whose donation this is.
    const store = storeOf([
      donor({ id: "d-old", name: "Test Donor", status: "inactive" }),
      donor({ id: "d-live", name: "Test Donor", status: "active" }),
    ]);
    const result = await resolveDonor(store, { name: "Test Donor", status: "active" } as InsertDonor);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.id).sort()).toEqual(["d-live", "d-old"]);
      expect(result.reason).toMatch(/nothing here tells them apart/);
    }
  });

  it("does not let a matching email override a contradicting phone", async () => {
    // Codex review R10 follow-up: one field matching while the other
    // disagrees describes two different people, not a confirmation.
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor", email: "person.a@example.test", phone: "410-555-0100" }),
    ]);
    const result = await resolveDonor(store, {
      name: "Test Donor",
      email: "person.a@example.test",
      phone: "410-555-0199",
      status: "active",
    } as InsertDonor);
    expect(result.kind).toBe("ambiguous");
    expect(store.created).toHaveLength(0);
  });

  it("stays ambiguous when one submitted field points at each of two records", async () => {
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor", email: "person.a@example.test", phone: "410-555-0100" }),
      donor({ id: "d-b", name: "Test Donor", email: "person.b@example.test", phone: "410-555-0199" }),
    ]);
    const result = await resolveDonor(store, {
      name: "Test Donor",
      email: "person.a@example.test",
      phone: "410-555-0199",
      status: "active",
    } as InsertDonor);
    expect(result.kind).toBe("ambiguous");
  });

  it("treats a blank submitted field as saying nothing, not as a disagreement", async () => {
    const store = storeOf([donor({ id: "d-a", name: "Test Donor", email: "person.a@example.test" })]);
    const result = await resolveDonor(store, {
      name: "Test Donor",
      email: "",
      phone: null,
      status: "active",
    } as unknown as InsertDonor);
    expect(result).toMatchObject({ kind: "existing" });
  });
});

describe("findOrCreateDonor", () => {
  it("throws rather than guessing when the name cannot identify one person", async () => {
    const store = storeOf([
      donor({ id: "d-a", name: "Test Donor" }),
      donor({ id: "d-b", name: "Test Donor" }),
    ]);
    await expect(findOrCreateDonor(store, { name: "Test Donor", status: "active" } as InsertDonor))
      .rejects.toBeInstanceOf(AmbiguousDonorError);
  });

  it("still reports created and existing for the ordinary cases", async () => {
    const empty = storeOf([]);
    expect(await findOrCreateDonor(empty, { name: "New Donor", status: "active" } as InsertDonor))
      .toMatchObject({ created: true });
    const stored = storeOf([donor({ id: "d-1", name: "New Donor" })]);
    expect(await findOrCreateDonor(stored, { name: "New Donor", status: "active" } as InsertDonor))
      .toMatchObject({ created: false });
  });
});
