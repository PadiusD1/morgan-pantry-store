// Add New Donor posts on every submit and donor names carry no uniqueness,
// so a donor whose normalised name is already stored is returned, not inserted.

import { normaliseName } from "@shared/identity";
import type { Donor, InsertDonor } from "@shared/schema";

export type DonorStore = {
  findDonorsByNormalisedName(key: string): Promise<Donor[]>;
  createDonor(data: InsertDonor): Promise<Donor>;
};

export async function findOrCreateDonor(
  store: DonorStore,
  data: InsertDonor,
): Promise<{ donor: Donor; created: boolean }> {
  const key = normaliseName(data.name);
  const matches = (await store.findDonorsByNormalisedName(key)).filter(
    (d) => normaliseName(d.name) === key,
  );
  const existing = matches.find((d) => d.status === "active") ?? matches[0];
  if (existing) return { donor: existing, created: false };
  return { donor: await store.createDonor(data), created: true };
}
