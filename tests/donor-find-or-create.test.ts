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

  it("prefers an active donor over an inactive twin", async () => {
    const { store } = fakeStore([donor("d1", "Test Donor Four", "inactive"), donor("d2", "Test Donor Four")]);
    const r = await findOrCreateDonor(store, { name: "Test Donor Four" } as InsertDonor);
    expect(r.donor.id).toBe("d2");
  });
});
