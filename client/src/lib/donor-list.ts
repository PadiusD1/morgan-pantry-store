import type { DonorRecord } from "./donor-cache";
export type DonorSort = "newest" | "name";
const created = (value: string) => { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; };
/** Do not mutate the canonical cache. Include donors with no donations yet. */
export function visibleDonors(donors: readonly DonorRecord[], query: string, sort: DonorSort): DonorRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return donors.filter(donor => !needle || [donor.name, donor.organization, donor.contactName, donor.email, donor.phone, donor.notes]
    .some(value => value?.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (sort === "newest" ? created(b.createdAt) - created(a.createdAt) : 0)
      || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
