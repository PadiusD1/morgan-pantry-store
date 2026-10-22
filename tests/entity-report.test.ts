import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { relationshipReport, relationshipCsv } from "../shared/relationship-report";
import { buildSourceOptions } from "../shared/donation-source";
import { isPartnerContribution } from "../client/src/lib/partner-contributions";
import { entityReport, entityReportCsv, type EntityTransaction } from "../shared/entity-report";
const all = { from: "", to: "" };
const line = { itemId: "rice", name: 'Rice, "brown"\nwhole', quantity: 2, weightPerUnitLbs: 0.5, valuePerUnitUsd: 1.25 };
const tx = (values: Partial<EntityTransaction> = {}): EntityTransaction => ({ id: "one", type: "OUT", timestamp: "2026-10-01T00:30:00Z", clientId: "client", items: [line, { ...line, itemId: "beans", quantity: 3, weightPerUnitLbs: 0, valuePerUnitUsd: 0 }], ...values });
describe("individual activity reports", () => {
  it.each(["student", "partner"] as const)("separates %s IN and OUT, counts multiline entries once, deduplicates retry rows and exposes coverage", kind => {
    const out = tx({ isEmergency: true });
    const report = entityReport({ kind, id: "client", name: "Example" }, [out, out, tx({ id: "in", type: "IN" }), tx({ id: "other", clientId: "other" })], all);
    expect(report.outgoing).toMatchObject({ entries: 1, activeDays: 1, units: 5, valueCents: 250, weightLbs: 1, unweighedUnits: 3, unvaluedUnits: 3, emergencyEntries: 1 });
    expect(report.incoming.entries).toBe(1);
    expect(report.rows).toHaveLength(2);
    expect(report.coverage).toMatchObject({ unweighedUnits: 6, unvaluedUnits: 6 });
  });
  it("leaves shared legacy donor names unallocated and makes explicit donor/client identities authoritative", () => {
    const donors = [{ id: "d1", name: "Shared Name" }, { id: "d2", name: " shared   name " }];
    const report = entityReport({ kind: "donor", id: "d1", name: "Shared Name" }, [
      tx({ id: "legacy", type: "IN", clientId: undefined, donor: "SHARED NAME" }),
      tx({ id: "explicit", type: "IN", clientId: undefined, donorId: "d1", donor: "old name" }),
      tx({ id: "client-source", type: "IN", donor: "Shared Name" }),
      tx({ id: "another", type: "IN", donorId: "d2" }),
    ], all, donors);
    expect(report.incoming.entries).toBe(1);
    expect(report.outgoing.entries).toBe(0);
    expect(report.coverage.ambiguousLegacyEntries).toBe(1);
    expect(report.rows[0].transactionId).toBe("explicit");
  });
  it("includes the full period across more than one UI page and escapes every CSV text field", () => {
    const transactions = Array.from({ length: 61 }, (_, i) => tx({ id: `row-${i}`, items: [line, line] }));
    const report = entityReport({ kind: "student", id: "client", name: "=FORMULA()" }, transactions, { from: "2026-09-30", to: "2026-09-30" });
    const csv = entityReportCsv(report, new Date("2026-10-02T12:00:00Z"));
    const rows = Papa.parse<string[]>(csv).data;
    expect(rows.find(row => row[0] === "Record")?.[1]).toBe("'=FORMULA()");
    const data = rows.filter(row => row[0] === "outgoing");
    expect(data).toHaveLength(122);
    expect(new Set(data.map(row => row[1])).size).toBe(61);
    expect(data[0][10]).toBe(line.name);
    expect(data.reduce((sum, row) => sum + Number(row[6]), 0)).toBe(report.outgoing.units);
    expect(report.rows.every(row => row.dateEastern === "2026-09-30")).toBe(true);
  });
  it("rejects invalid ranges and excludes out-of-range/invalid dates", () => {
    expect(() => entityReport({ kind: "student", id: "client", name: "X" }, [], { from: "2026-02-30", to: "" })).toThrow();
    expect(entityReport({ kind: "student", id: "client", name: "X" }, [tx(), tx({ id: "bad", timestamp: "invalid" })], { from: "2026-10-01", to: "2026-10-01" }).rows).toHaveLength(0);
  });
  it("credits a unique legacy partner source consistently and excludes cross-kind names visibly", () => {
    const partner = { kind: "partner" as const, id: "p", name: "Campus Source" };
    const student = { id: "s", name: "Campus Source", clientType: "student" };
    const partnerDirectory = [{ id: "p", name: partner.name, clientType: "partner" }];
    const legacy = tx({ type: "IN", clientId: undefined, donor: partner.name });
    const unique = entityReport(partner, [legacy], all, [], partnerDirectory);
    expect(unique.incoming).toMatchObject({ entries: 1, units: 5 });
    expect(unique.coverage.nameMatchedEntries).toBe(1);
    const crossClient = entityReport(partner, [legacy], all, [], [...partnerDirectory, student]);
    expect(crossClient.incoming.entries).toBe(0);
    expect(crossClient.coverage.ambiguousLegacyEntries).toBe(1);
    const donorDirectory = [{ id: "d", name: partner.name }];
    for (const entity of [partner, { kind: "donor" as const, id: "d", name: partner.name }]) {
      const crossDonor = entityReport(entity, [legacy], all, donorDirectory, partnerDirectory);
      expect(crossDonor.incoming.entries).toBe(0);
      expect(crossDonor.coverage.ambiguousLegacyEntries).toBe(1);
    }
    const explicit = entityReport(partner, [tx({type:"IN",clientId:partner.id,donor:partner.name})], all, donorDirectory, partnerDirectory);
    expect(explicit.incoming.entries).toBe(1);
  });

  it("uses identical source attribution for partner cards, directory CSV and individual reports", () => {
    const partner = {id:"p",name:"Unique Legacy Pantry"};
    const legacy = tx({id:"legacy-partner",type:"IN",clientId:undefined,donor:partner.name});
    const sources = buildSourceOptions([], [partner]);
    expect(isPartnerContribution(legacy, partner, sources)).toBe(true);
    expect(relationshipReport("partner", [partner], [legacy], all, [partner], sources)[0]).toMatchObject({legacyNameEntries:1, received:{entries:1,units:5}});
    const shared = buildSourceOptions([{id:"d",name:partner.name}], [partner]);
    expect(isPartnerContribution(legacy,partner,shared)).toBe(false);
    const row = relationshipReport("partner", [partner], [legacy], all, [partner], shared)[0];
    expect(row).toMatchObject({ambiguousLegacyEntries:1,received:{entries:0,units:0}});
    const donor = {id:"d",name:partner.name};
    expect(relationshipReport("donor", [donor], [legacy], all, [donor], shared)[0]).toMatchObject({ambiguousLegacyEntries:1,received:{entries:0}});
    expect(relationshipCsv("partner",[partner],[legacy],all,[partner],new Date("2026-10-01T12:00:00Z"),shared)).toContain("Ambiguous unallocated IN entries");
  });

});
