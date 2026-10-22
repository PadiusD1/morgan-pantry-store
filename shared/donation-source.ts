// Who the stock came from. Donors, partner organisations and student clients
// share one picker at check in and in the Inventory New item dialog.
//
// Incoming and outgoing are different relationships even when they name the
// same person. A partner organisation both contributes food and receives it,
// and a student who drops off a bag one week collects one the next. The
// direction lives on the transaction type, not on the person: an IN row's
// client_id is who the stock came FROM, an OUT row's client_id is who it went
// TO. So a source pick never changes anybody's record or role, it only records
// an attribution, and the canonical id is what it records.
//
// A donor pick is stored by donor_id with the donor's name. A partner or
// student pick is stored by client_id with their name, keeping today's meaning.

export type SourceKind = "donor" | "partner" | "student";

export type SourceOption = {
  key: string;
  kind: SourceKind;
  id: string;
  name: string;
  organization: string | null;
  /** Shown beside the name so two kinds of record are never confused. */
  identityLabel: string;
  /** The identifier staff know the record by, for searching and disambiguation. */
  identifier: string | null;
  /** Extra searchable text, never displayed as a label. */
  searchHints: string[];
};

type Named = {
  id: string;
  name?: string | null;
  organization?: string | null;
  identifier?: string | null;
  email?: string | null;
  phone?: string | null;
  contact?: string | null;
  partnershipType?: string | null;
};

export const IDENTITY_LABELS: Record<SourceKind, string> = {
  donor: "Donor",
  partner: "Partner organization",
  student: "Student or client",
};

export function buildSourceOptions(
  donors: Named[],
  partners: Named[],
  students: Named[] = [],
): SourceOption[] {
  const out: SourceOption[] = [];
  const add = (kind: SourceKind, row: Named) => {
    const name = (row?.name ?? "").trim();
    if (!row?.id || !name) return;
    const identifier = (row.identifier ?? "").trim() || null;
    out.push({
      key: `${kind}:${row.id}`,
      kind,
      id: row.id,
      name,
      organization: row.organization ?? null,
      identityLabel: IDENTITY_LABELS[kind],
      identifier,
      searchHints: [row.email, row.phone, row.contact, row.partnershipType]
        .map((value) => (value ?? "").trim())
        .filter((value) => value.length > 0),
    });
  };
  for (const d of donors ?? []) add("donor", d);
  for (const p of partners ?? []) add("partner", p);
  for (const student of students ?? []) add("student", student);
  return out.sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.kind.localeCompare(b.kind),
  );
}

/** Everything a staff member might type to find one source. */
export function sourceSearchText(option: SourceOption): string {
  return [option.name, option.identifier, option.organization, option.identityLabel, ...option.searchHints]
    .filter((value): value is string => !!value && value.length > 0)
    .join(" ")
    .toLowerCase();
}

/** Match a typed query against a source, on every field staff can see. */
export function matchesSourceQuery(option: SourceOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = sourceSearchText(option);
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** The fields recordInbound sends for a pick. */
export type SourceFields = { donor?: string; donorId?: string; donorClientId?: string };

export function sourceFields(option: SourceOption | null | undefined): SourceFields {
  if (!option) return {};
  // A partner or a student is a client record, so the attribution is a
  // client_id on an IN row. Only a donor has a donor_id.
  if (option.kind === "partner" || option.kind === "student") {
    return { donor: option.name, donorClientId: option.id };
  }
  return { donor: option.name, donorId: option.id };
}

/** The source name shown on an IN row, the donor's name or the partner's name. */
export function sourceNameOf(tx: {
  type?: string | null;
  donor?: string | null;
  clientName?: string | null;
}): string | null {
  if (tx?.type !== "IN") return null;
  const name = (tx.donor ?? "").trim() || (tx.clientName ?? "").trim();
  return name || null;
}

export function normaliseDonorName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export type DonorAttribution =
  /** The row carries a donor_id, or one name match settles it. */
  | { kind: "allocated"; donorId: string }
  /** The row belongs to a partner or student client, not to a donor. */
  | { kind: "client" }
  /** No donor name, or a name no donor record matches. */
  | { kind: "unknown" }
  /** Several donors share this name and nothing distinguishes them. */
  | { kind: "ambiguous"; candidates: string[] };

/**
 * Which donor an IN row belongs to.
 *
 * A donor_id settles it outright. An older row carries only a typed name, and
 * a name is not an identity: when two donor records share it, this used to pick
 * one by status and age and hand it back as an answer. That turned a tie-break
 * into a claim on an individual's report, and the report then said one person
 * gave food the pantry cannot prove came from them. Such a row is now reported
 * as ambiguous, stays out of every donor's totals, and is counted in the open
 * so the coverage gap is visible and can be reconciled deliberately.
 */
export type ClientSourceEntry = { id: string; name: string; clientType?: string | null };
export type SourceIdentity = { id: string; name: string; kind: SourceKind };
export type SourceAttribution =
  | { kind: "allocated"; source: SourceIdentity; basis: "explicit_id" | "sole_name_match" }
  | { kind: "ambiguous"; candidates: SourceIdentity[] }
  | { kind: "unknown" };

/** One authority for legacy names across donors, partners and students. */
export function attributeSourceDetailed(
  tx: { donorId?: string | null; donor?: string | null; clientId?: string | null },
  sources: readonly SourceIdentity[],
): SourceAttribution {
  if (tx.donorId || tx.clientId) {
    const source = sources.find(source => tx.donorId
      ? source.kind === "donor" && source.id === tx.donorId
      : source.kind !== "donor" && source.id === tx.clientId);
    return source ? { kind: "allocated", source, basis: "explicit_id" } : { kind: "unknown" };
  }
  const name = normaliseDonorName(tx.donor);
  if (!name) return { kind: "unknown" };
  const matches = sources.filter(source => normaliseDonorName(source.name) === name);
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return matches.length === 1
    ? { kind: "allocated", source: matches[0], basis: "sole_name_match" }
    : { kind: "unknown" };
}

export function sourceIdentityDirectory(donors: readonly { id: string; name: string }[], clients: readonly ClientSourceEntry[] = []): SourceIdentity[] {
  return [
    ...donors.map(donor => ({ ...donor, kind: "donor" as const })),
    ...clients.map(client => ({ id: client.id, name: client.name, kind: client.clientType === "partner" ? "partner" as const : "student" as const })),
  ];
}

export function attributeDonorDetailed(
  tx: { donorId?: string | null; donor?: string | null; clientId?: string | null },
  donors: { id: string; name: string; status?: string | null; createdAt?: string | Date }[],
  clients: readonly ClientSourceEntry[] = [],
): DonorAttribution {
  // Explicit client ownership never becomes a donor name fallback, even if
  // this caller is holding only the donor directory.
  if (!tx.donorId && tx.clientId) return { kind: "client" };
  const result = attributeSourceDetailed(tx, sourceIdentityDirectory(donors, clients));
  if (result.kind === "allocated") return result.source.kind === "donor"
    ? { kind: "allocated", donorId: result.source.id }
    : { kind: "client" };
  if (result.kind === "ambiguous") return { kind: "ambiguous", candidates: result.candidates.filter(source => source.kind === "donor").map(source => source.id).sort() };
  return result;
}

/**
 * How much of the incoming history could be attributed, and what could not.
 *
 * Every report that totals donations needs this alongside the totals, because
 * a total with no coverage figure reads as complete when it is not.
 */
export type AttributionCoverage = {
  /** Rows credited to a donor record. */
  allocatedEntries: number;
  /** Rows whose typed name is shared by several donor records. */
  ambiguousLegacyEntries: number;
  /** Rows with no donor name, or a name no donor record carries. */
  unmatchedNameEntries: number;
  /** Rows contributed by a partner or student client, not by a donor. */
  clientSourcedEntries: number;
};

export type InboundRow = { donorId?: string | null; donor?: string | null; clientId?: string | null };

/**
 * Group incoming rows by the donor they belong to, and count the rest.
 *
 * One owner for this decision, so the donor list, a donor's own history and
 * every report agree about which rows count and which stay unallocated.
 */
export function attributeInboundRows<T extends InboundRow>(
  rows: readonly T[],
  donors: { id: string; name: string; status?: string | null; createdAt?: string | Date }[],
  clients: readonly ClientSourceEntry[] = [],
): { byDonor: Map<string, T[]>; coverage: AttributionCoverage } {
  const byDonor = new Map<string, T[]>();
  const coverage: AttributionCoverage = {
    allocatedEntries: 0,
    ambiguousLegacyEntries: 0,
    unmatchedNameEntries: 0,
    clientSourcedEntries: 0,
  };
  for (const row of rows) {
    const attribution = attributeDonorDetailed(row, donors, clients);
    if (attribution.kind === "allocated") {
      coverage.allocatedEntries += 1;
      const existing = byDonor.get(attribution.donorId);
      if (existing) existing.push(row);
      else byDonor.set(attribution.donorId, [row]);
    } else if (attribution.kind === "ambiguous") {
      coverage.ambiguousLegacyEntries += 1;
    } else if (attribution.kind === "client") {
      coverage.clientSourcedEntries += 1;
    } else {
      coverage.unmatchedNameEntries += 1;
    }
  }
  return { byDonor, coverage };
}

/** Donor records whose name is shared, so their legacy rows cannot be told apart. */
export function donorsWithSharedNames(
  donors: { id: string; name: string }[],
  clients: readonly ClientSourceEntry[] = [],
): Set<string> {
  const counts = new Map<string, number>();
  for (const donor of [...donors, ...clients]) {
    const key = normaliseDonorName(donor.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    donors.filter((donor) => (counts.get(normaliseDonorName(donor.name)) ?? 0) > 1).map((donor) => donor.id),
  );
}

/** The donor id this row counts towards, or null when it counts towards none. */
export function attributeDonor(
  tx: { donorId?: string | null; donor?: string | null; clientId?: string | null },
  donors: { id: string; name: string; status?: string | null; createdAt?: string | Date }[],
): string | null {
  const attribution = attributeDonorDetailed(tx, donors);
  return attribution.kind === "allocated" ? attribution.donorId : null;
}
