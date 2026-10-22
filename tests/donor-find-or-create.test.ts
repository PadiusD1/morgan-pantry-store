import { describe, expect, it } from "vitest";
import { findOrCreateDonor, type DonorStore } from "../server/donor-find-or-create";
import type { Donor, InsertDonor } from "@shared/schema";

function donor(id: string, name: string, status = "active"): Donor {
  const at = new Date("2026-01-01T00:00:00Z");
  return {
    id, name, status, organization: null, contactName: null, phone: null,
    email: null, address: null, notes: null, createdAt: at, updatedAt: at,
  };
}

// The fake returns every stored donor, so the helper's own matching decides.
function fakeStore(rows: Donor[]) {
  const keys: string[] = [];
  const created: InsertDonor[] = [];
  const store: DonorStore = {
    async findDonorsByNormalisedName(key) {
      keys.push(key);
      return rows;
    },
    async createDonor(data) {
      created.push(data);
      return donor(`new${created.length}`, data.name);
    },
  };
  return { store, keys, created };
}

describe("findOrCreateDonor", () => {
  it("returns the existing donor for the same name written differently", async () => {
    const { store, keys, created } = fakeStore([donor("d1", "Test Donor One")]);
    const r = await findOrCreateDonor(store, { name: "  test   DONOR one " } as InsertDonor);
    expect(keys).toEqual(["test donor one"]);
    expect(r.created).toBe(false);
    expect(r.donor.id).toBe("d1");
    expect(created).toHaveLength(0);
  });

  it("creates a donor when no stored name matches", async () => {
    const { store, created } = fakeStore([donor("d1", "Test Donor One")]);
    const r = await findOrCreateDonor(store, { name: "Test Donor Two" } as InsertDonor);
    expect(r.created).toBe(true);
    expect(created).toEqual([{ name: "Test Donor Two" }]);
  });

  it("a second submit of the same name returns the first donor", async () => {
    const rows: Donor[] = [];
    const { store } = fakeStore(rows);
    const first = await findOrCreateDonor(store, { name: "Test Donor Three" } as InsertDonor);
    rows.push(first.donor);
    const second = await findOrCreateDonor(store, { name: "test donor three" } as InsertDonor);
    expect(second.created).toBe(false);
    expect(second.donor.id).toBe(first.donor.id);
  });

  it("refuses to choose between an active donor and an inactive twin", async () => {
    // This replaces an earlier expectation that the active record was taken.
    // Status is not identity: an inactive record is still a person, so picking
    // the active one was a guess about whose donation was being recorded, and
    // that guess then travelled into every report and receipt. The caller is
    // now told to choose. See the R10 review in tests/donor-identity.test.ts.
    const { store } = fakeStore([donor("d1", "Test Donor Four", "inactive"), donor("d2", "Test Donor Four")]);
    await expect(findOrCreateDonor(store, { name: "Test Donor Four" } as InsertDonor)).rejects.toThrow(
      /nothing here tells them apart/,
    );
  });
});
