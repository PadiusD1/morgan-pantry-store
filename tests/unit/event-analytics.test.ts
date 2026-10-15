import { describe, expect, it } from "vitest";
import { eventRollups, rankDonationSources, type EventLedgerLine } from "../../shared/event-analytics";
const base: EventLedgerLine = { transactionId: "tx1", eventId: "event1", eventName: "Stand in the Gap", direction: "OUT", clientId: "student1", quantity: 2, unitWeightLbs: 1.5, unitValueUsd: 2 };
describe("event reporting invariants", () => {
  it("groups multiple checkouts and counts distinct recipients, not line items", () => {
    const rows = eventRollups([base, {...base, transactionId: "tx2", quantity: 3}, {...base, transactionId: "tx3", clientId: "student2", quantity: 1}]);
    expect(rows[0]).toMatchObject({ distributedUnits: 6, distributedWeightLbs: 9, distributedValueUsd: 12, clientsServed: 2, transactions: 3 });
  });
  it("does not invent event attribution for historical records", () => {
    expect(eventRollups([{...base, eventId: null, eventName: null}])[0]).toMatchObject({eventId: null, eventName: "Unassigned"});
  });
  it("keeps unknown measurements visible instead of silently treating them as measured", () => {
    expect(eventRollups([{...base, unitWeightLbs: null, unitValueUsd: null}])[0]).toMatchObject({ missingWeightUnits: 2, missingValueUnits: 2, distributedWeightLbs: 0, distributedValueUsd: 0 });
  });
  it("counts incoming donor items only, never outgoing food", () => {
    expect(rankDonationSources([{...base, direction: "IN", sourceId: "donor1", sourceName: "Donor One"}, {...base, direction: "OUT", sourceId: "donor1"}])).toMatchObject([{sourceId:"donor1", units:2, transactions:1}]);
  });
  it("rejects invalid quantities rather than corrupting board totals", () => {
    expect(() => eventRollups([{...base, quantity:-1}])).toThrow();
    expect(() => rankDonationSources([{...base, direction:"IN", sourceId:"d", quantity:1.2}])).toThrow();
  });
});
