// Who donated it. Donors and partner organisations share one picker at check in
// and in the Inventory New item dialog. A donor pick is stored by donor_id with
// the donor's name, a partner pick keeps today's meaning, client_id is the partner.

export type SourceKind = "donor" | "partner";

export type SourceOption = {
  key: string;
  kind: SourceKind;
  id: string;
  name: string;
  organization: string | null;
};

type Named = { id: string; name?: string | null; organization?: string | null };

export function buildSourceOptions(donors: Named[], partners: Named[]): SourceOption[] {
  const out: SourceOption[] = [];
  const add = (kind: SourceKind, row: Named) => {
    const name = (row?.name ?? "").trim();
    if (!row?.id || !name) return;
    out.push({ key: `${kind}:${row.id}`, kind, id: row.id, name, organization: row.organization ?? null });
  };
  for (const d of donors ?? []) add("donor", d);
  for (const p of partners ?? []) add("partner", p);
  return out.sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.kind.localeCompare(b.kind),
  );
}

/** The fields recordInbound sends for a pick. */
export type SourceFields = { donor?: string; donorId?: string; donorClientId?: string };

export function sourceFields(option: SourceOption | null | undefined): SourceFields {
  if (!option) return {};
  if (option.kind === "partner") return { donor: option.name, donorClientId: option.id };
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

/**
 * The donor an IN row belongs to. donor_id decides when the row has one. An
 * old row with no donor_id falls back to its donor name, compared case blind.
 */
export function attributeDonor(
  tx: { donorId?: string | null; donor?: string | null; clientId?: string | null },
  donors: { id: string; name: string; status?: string | null; createdAt?: string | Date }[],
): string | null {
  if (tx.donorId) return donors.some((d) => d.id === tx.donorId) ? tx.donorId : null;
  // A partner donation is identified by client_id. Its display name must
  // never make the same transaction count as a separate donor's donation.
  if (tx.clientId) return null;
  const name = normaliseDonorName(tx.donor);
  if (!name) return null;
  const matches = donors.filter((d) => normaliseDonorName(d.name) === name);
  if (matches.length === 0) return null;
  matches.sort((a, b) =>
    Number((b.status ?? "active") === "active") - Number((a.status ?? "active") === "active") ||
    new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime() ||
    a.id.localeCompare(b.id),
  );
  return matches[0].id;
}
