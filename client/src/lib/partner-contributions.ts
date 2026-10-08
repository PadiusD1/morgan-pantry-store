import { normaliseDonorName, type SourceOption } from "@shared/donation-source";
import type { Transaction } from "./repository";

/** Explicit ownership wins. A legacy name must identify just one partner. */
export function isPartnerContribution(
  transaction: Pick<Transaction, "type" | "donorId" | "clientId" | "donor">,
  partner: { id: string; name: string },
  sources: readonly SourceOption[],
): boolean {
  if (transaction.type !== "IN" || transaction.donorId) return false;
  if (transaction.clientId) return transaction.clientId === partner.id;
  const name = normaliseDonorName(transaction.donor);
  if (!name || name !== normaliseDonorName(partner.name)) return false;
  // A donor with this name owns the legacy row in donor reporting. Multiple
  // same-name partners cannot be distinguished without an explicit link.
  const matches = sources.filter((source) => normaliseDonorName(source.name) === name);
  return matches.length === 1 && matches[0].kind === "partner" && matches[0].id === partner.id;
}
