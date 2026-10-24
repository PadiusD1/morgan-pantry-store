// Add New Donor posts on every submit and donor names carry no uniqueness,
// so a donor whose normalised name is already stored is reused rather than
// inserted a second time.
//
// Reuse stops where identity stops. Two people really can both be called
// J. Smith, and a name on its own is not an identity: collapsing a submitted
// donor into a stored one whose email and phone both disagree would attribute
// one person's donations to another, and that attribution then travels into
// every report and receipt. So a name match is only honoured when nothing the
// caller submitted contradicts it. When it does contradict, or when the name
// alone cannot choose between several stored donors, the caller is told to
// disambiguate instead of being handed an arbitrary person.

import { normaliseEmail, normaliseName, normalisePhone } from "@shared/identity";
import type { Donor, InsertDonor } from "@shared/schema";

export type DonorStore = {
  findDonorsByNormalisedName(key: string): Promise<Donor[]>;
  createDonor(data: InsertDonor): Promise<Donor>;
};

export type DonorResolution =
  | { kind: "created"; donor: Donor }
  | { kind: "existing"; donor: Donor }
  /** The name matches stored donors that the submitted details cannot choose between. */
  | { kind: "ambiguous"; candidates: Donor[]; reason: string };

/** Fields that can tell two same-name donors apart. */
const comparable = (donor: { email?: string | null; phone?: string | null }) => ({
  email: normaliseEmail(donor.email),
  phone: normalisePhone(donor.phone),
});

/**
 * Whether a submitted record contradicts a stored one. Only two values that are
 * both present and different are a contradiction; a blank submitted field says
 * nothing, which is the ordinary case when staff type just a name inline.
 */
function contradicts(submitted: InsertDonor, stored: Donor): boolean {
  const left = comparable(submitted);
  const right = comparable(stored);
  return (
    (left.email !== "" && right.email !== "" && left.email !== right.email) ||
    (left.phone !== "" && right.phone !== "" && left.phone !== right.phone)
  );
}

/** Whether a submitted identifying field positively confirms a stored donor. */
function confirms(submitted: InsertDonor, stored: Donor): boolean {
  const left = comparable(submitted);
  const right = comparable(stored);
  return (
    (left.email !== "" && left.email === right.email) ||
    (left.phone !== "" && left.phone === right.phone)
  );
}

export async function resolveDonor(store: DonorStore, data: InsertDonor): Promise<DonorResolution> {
  const key = normaliseName(data.name);
  const sameName = (await store.findDonorsByNormalisedName(key)).filter(
    (donor) => normaliseName(donor.name) === key,
  );
  const typed = data.name.trim();

  if (sameName.length === 0) return { kind: "created", donor: await store.createDonor(data) };

  // A record is only a candidate when nothing submitted contradicts it. An
  // email that matches while the phone disagrees is not a confirmation, it is
  // a conflict, and the two fields together describe two different people.
  const plausible = sameName.filter((donor) => !contradicts(data, donor));

  // A submitted identifying field that matches an uncontradicted record settles
  // it, even when several donors share the name.
  const confirmed = plausible.filter((donor) => confirms(data, donor));
  if (confirmed.length === 1) return { kind: "existing", donor: confirmed[0] };
  if (confirmed.length > 1) {
    return {
      kind: "ambiguous",
      candidates: confirmed,
      reason: `More than one donor named ${typed} matches these contact details. Open the donor list and pick the right record.`,
    };
  }

  if (plausible.length === 0) {
    return {
      kind: "ambiguous",
      candidates: sameName,
      reason: `A different donor named ${typed} is already saved with other contact details. Open the donor list to update that record, or save this one with a name that tells them apart.`,
    };
  }
  if (plausible.length === 1) return { kind: "existing", donor: plausible[0] };

  // Several stored donors share the name and nothing submitted distinguishes
  // them. Status is not identity: an inactive record is still a person, so
  // preferring the active one would be a guess about whose donation this is.
  return {
    kind: "ambiguous",
    candidates: plausible,
    reason: `${plausible.length} donors are named ${typed} and nothing here tells them apart. Open the donor list and pick the right record so this donation is credited to the right person.`,
  };
}

/**
 * Backwards-compatible wrapper for callers that only need the reuse decision.
 * An ambiguous name throws, because silently choosing a person is the defect
 * this module exists to prevent.
 */
export async function findOrCreateDonor(
  store: DonorStore,
  data: InsertDonor,
): Promise<{ donor: Donor; created: boolean }> {
  const resolution = await resolveDonor(store, data);
  if (resolution.kind === "ambiguous") throw new AmbiguousDonorError(resolution);
  return { donor: resolution.donor, created: resolution.kind === "created" };
}

export class AmbiguousDonorError extends Error {
  readonly candidates: Donor[];
  constructor(resolution: { candidates: Donor[]; reason: string }) {
    super(resolution.reason);
    this.name = "AmbiguousDonorError";
    this.candidates = resolution.candidates;
  }
}
