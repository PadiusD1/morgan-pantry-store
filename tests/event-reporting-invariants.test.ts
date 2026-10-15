import { describe, expect, it } from "vitest";
import { eventRollups, rankDonationSources, type EventLedgerLine } from "../shared/event-analytics";

const line = (overrides: Partial<EventLedgerLine> = {}): EventLedgerLine => ({
 transactionId: "tx-a", eventId: "11111111-1111-4111-8111-111111111111", eventName: "Stand in the Gap",
 direction: "OUT", sourceId: null, sourceName: null, clientId: "client-a",
 quantity: 2, unitWeightLbs: 1, unitValueUsd: 3, ...overrides
});

describe("FRC board attribution", () => {
 it("keeps event totals separate from unassigned historical transactions", () => {
  const rows = eventRollups([line(), line({transactionId:"tx-b",eventId:null,eventName:null})]);
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.eventId === null)?.distributedUnits).toBe(2);
  expect(rows.find(r => r.eventId !== null)?.distributedUnits).toBe(2);
 });
 it("counts clients and transactions once per event across multiple item lines", () => {
  const [row] = eventRollups([line(),line({quantity:1}),line({transactionId:"tx-b",clientId:"client-b"})]);
  expect(row).toMatchObject({distributedUnits:5,clientsServed:2,transactions:2});
 });
 it("never credits outgoing food to the donor leaderboard", () => {
  const rows = rankDonationSources([
   line({direction:"IN",sourceId:"donor-a",sourceName:"Donor A"}),
   line({direction:"OUT",sourceId:"donor-a",sourceName:"Donor A",transactionId:"tx-b"})
  ]);
  expect(rows).toMatchObject([{sourceId:"donor-a",units:2,transactions:1}]);
 });
 it("flags missing measurements instead of inventing weights or values", () => {
  expect(eventRollups([line({unitWeightLbs:null,unitValueUsd:null})])[0])
   .toMatchObject({missingWeightUnits:2,missingValueUnits:2,distributedWeightLbs:0,distributedValueUsd:0});
 });
});
