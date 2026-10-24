import { normaliseDonorName } from './donation-source';
/** Review-only discovery: names in legacy IN rows are not automatically people or organizations. */
export function unregisteredDonors(transactions: { type: string; donor?: string | null; donorId?: string | null; clientId?: string | null }[], donors: { name: string }[]) {
  const registered = new Set(donors.map(donor => normaliseDonorName(donor.name)));
  const ignored = new Set(['unknown', 'anonymous', 'n/a', 'none', 'donation', 'donor', 'not specified']);
  const groups = new Map<string, { name: string; entries: number }>();
  for (const tx of transactions) {
    if (tx.type !== 'IN' || tx.donorId || tx.clientId) continue;
    const name = normaliseDonorName(tx.donor);
    if (!name || ignored.has(name) || registered.has(name)) continue;
    const row = groups.get(name) ?? { name: tx.donor!.trim().replace(/\s+/g, ' '), entries: 0 };
    row.entries += 1; groups.set(name, row);
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name));
}
