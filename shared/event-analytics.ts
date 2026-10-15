/** Event reporting: never infer missing attribution or turn missing measurements into zero. */
export type EventLedgerLine = {
  transactionId: string;
  eventId: string | null;
  eventName?: string | null;
  direction: "IN" | "OUT";
  sourceId?: string | null;
  sourceName?: string | null;
  clientId?: string | null;
  quantity: number;
  unitWeightLbs: number | null;
  unitValueUsd: number | null;
};
export type EventRollup = {
  eventId: string | null;
  eventName: string;
  receivedUnits: number;
  distributedUnits: number;
  receivedWeightLbs: number;
  distributedWeightLbs: number;
  receivedValueUsd: number;
  distributedValueUsd: number;
  missingWeightUnits: number;
  missingValueUnits: number;
  clientsServed: number;
  transactions: number;
};
const safe = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0;
export function eventRollups(lines: readonly EventLedgerLine[]): EventRollup[] {
  const map = new Map<string, EventRollup>();
  const clients = new Map<string, Set<string>>();
  const transactions = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Invalid event ledger quantity");
    const key = line.eventId ?? "__unassigned__";
    let row = map.get(key);
    if (!row) {
      row = { eventId: line.eventId, eventName: line.eventName?.trim() || (line.eventId ? "Unnamed event" : "Unassigned"), receivedUnits: 0, distributedUnits: 0, receivedWeightLbs: 0, distributedWeightLbs: 0, receivedValueUsd: 0, distributedValueUsd: 0, missingWeightUnits: 0, missingValueUnits: 0, clientsServed: 0, transactions: 0 };
      map.set(key, row);
      clients.set(key, new Set());
      transactions.set(key, new Set());
    }
    const incoming = line.direction === "IN";
    if (incoming) row.receivedUnits += line.quantity;
    else row.distributedUnits += line.quantity;
    if (safe(line.unitWeightLbs)) {
      if (incoming) row.receivedWeightLbs += line.quantity * line.unitWeightLbs;
      else row.distributedWeightLbs += line.quantity * line.unitWeightLbs;
    } else row.missingWeightUnits += line.quantity;
    if (safe(line.unitValueUsd)) {
      if (incoming) row.receivedValueUsd += line.quantity * line.unitValueUsd;
      else row.distributedValueUsd += line.quantity * line.unitValueUsd;
    } else row.missingValueUnits += line.quantity;
    if (!incoming && line.clientId) clients.get(key)!.add(line.clientId);
    transactions.get(key)!.add(line.transactionId);
  }
  for (const [key, row] of map) {
    row.clientsServed = clients.get(key)!.size;
    row.transactions = transactions.get(key)!.size;
  }
  return [...map.values()].sort((a, b) => b.distributedUnits - a.distributedUnits || a.eventName.localeCompare(b.eventName));
}
export type SourceRank = { sourceId: string; sourceName: string; units: number; weightLbs: number; valueUsd: number; missingWeightUnits: number; missingValueUnits: number; transactions: number };
/** Only inbound stock is credited to a donor; never count distributions as new donations. */
export function rankDonationSources(lines: readonly EventLedgerLine[]): SourceRank[] {
  const map = new Map<string, SourceRank>();
  const tx = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.direction !== "IN" || !line.sourceId) continue;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Invalid donation quantity");
    let row = map.get(line.sourceId);
    if (!row) {
      row = { sourceId: line.sourceId, sourceName: line.sourceName?.trim() || "Unnamed source", units: 0, weightLbs: 0, valueUsd: 0, missingWeightUnits: 0, missingValueUnits: 0, transactions: 0 };
      map.set(line.sourceId, row);
      tx.set(line.sourceId, new Set());
    }
    row.units += line.quantity;
    if (safe(line.unitWeightLbs)) row.weightLbs += line.quantity * line.unitWeightLbs;
    else row.missingWeightUnits += line.quantity;
    if (safe(line.unitValueUsd)) row.valueUsd += line.quantity * line.unitValueUsd;
    else row.missingValueUnits += line.quantity;
    tx.get(line.sourceId)!.add(line.transactionId);
  }
  for (const [key, row] of map) row.transactions = tx.get(key)!.size;
  return [...map.values()].sort((a,b) => b.units - a.units || a.sourceName.localeCompare(b.sourceName));
}
