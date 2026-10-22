import { attributeSourceDetailed, type SourceOption } from "@shared/donation-source";
import type { Transaction } from "./repository";

/** Shared source attribution keeps directory and individual report totals aligned. */
export function isPartnerContribution(
  transaction: Pick<Transaction, "type" | "donorId" | "clientId" | "donor">,
  partner: { id: string; name: string },
  sources: readonly SourceOption[],
): boolean {
  if (transaction.type !== "IN" || transaction.donorId) return false;
  if (transaction.clientId) return transaction.clientId === partner.id;
  const result = attributeSourceDetailed(transaction, sources);
  return result.kind === "allocated" && result.source.kind === "partner" && result.source.id === partner.id;
}
