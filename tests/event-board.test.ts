import { describe, expect, it } from "vitest";
import {
  ALL_EVENT_BOARD_DATA, STUDENT_CONTRIBUTORS_LABEL, UNASSIGNED_KEY, UNASSIGNED_LABEL, buildEventBoard, eventBoardCsv, eventBoardSections,
  type BoardEvent, type EventBoardInput, type EventBoardTransaction,
} from "../shared/event-board";
import { eventBoardHtml } from "../shared/event-board-document";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const events: BoardEvent[] = [
  { id: E2, name: "Second Market", startsAt: "2026-10-17T14:00:00.000Z", status: "closed" },
  { id: E1, name: "First Market", startsAt: "2026-10-03T14:00:00.000Z", status: "active" },
];
const clients = [
  { id: "student-a", name: "Avery Synthetic", clientType: "student" },
  { id: "student-b", name: "Blake Synthetic", clientType: "student" },
  { id: "partner-x", name: "Synthetic Partner Org", clientType: "partner" },
];
const donors = [
  { id: "donor-1", name: "Synthetic Grocer" },
  { id: "donor-2", name: "Shared Name" },
  { id: "donor-3", name: "Shared Name" },
  { id: "donor-4", name: "Synthetic Bakery" },
];

let serial = 0;
function out(eventId: string | null, clientId: string | null, quantity = 2, timestamp = "2026-10-03T15:00:00.000Z", weight = 1.5, value = 2.25): EventBoardTransaction {
  serial += 1;
  return { id: `out-${serial}`, type: "OUT", timestamp, eventId, clientId: clientId ?? undefined, items: [{ itemId: "rice", name: "Rice", quantity, weightPerUnitLbs: weight, valuePerUnitUsd: value }] };
}
function inbound(eventId: string | null, source: Partial<EventBoardTransaction>, quantity = 10, weight = 1, value = 0.5): EventBoardTransaction {
  serial += 1;
  return { id: `in-${serial}`, type: "IN", timestamp: "2026-10-03T16:00:00.000Z", eventId, items: [{ itemId: "beans", name: "Beans", quantity, weightPerUnitLbs: weight, valuePerUnitUsd: value }], ...source };
}
function board(transactions: EventBoardTransaction[], extra: Partial<EventBoardInput> = {}) {
  return buildEventBoard({
    transactions, events, donors, clients, range: { from: "", to: "" }, scope: { kind: "all" }, rankMetric: "units",
    now: new Date("2026-10-24T22:00:00.000Z"), ...extra,
  });
}
const row = (report: ReturnType<typeof board>, key: string) => report.events.find((event) => event.key === key)!;

describe("event board figures", () => {
  it("keeps unassigned history unassigned even inside an event's window", () => {
    // Saved at the very hour of First Market, but without an event id.
    const report = board([out(E1, "student-a"), out(null, "student-b", 3, "2026-10-03T15:30:00.000Z")]);
    expect(row(report, E1).distribution.entries).toBe(1);
    expect(row(report, UNASSIGNED_KEY)).toMatchObject({ name: UNASSIGNED_LABEL, eventId: null });
    expect(row(report, UNASSIGNED_KEY).distribution.units).toBe(3);
    expect(report.events.at(-1)!.key).toBe(UNASSIGNED_KEY);
  });

  it("counts a visit once however many lines it holds or however often it was loaded", () => {
    const visit = out(E1, "student-a");
    visit.items.push({ itemId: "beans", name: "Beans", quantity: 4, weightPerUnitLbs: 1, valuePerUnitUsd: 1 });
    const report = board([visit, { ...visit }]);
    expect(row(report, E1).distribution).toMatchObject({ entries: 1, units: 6 });
    expect(report.totals.distribution.entries).toBe(1);
  });

  it("deduplicates clients across events instead of adding per event counts", () => {
    const report = board([
      out(E1, "student-a"), out(E1, "student-a"), out(E1, "partner-x"), out(E1, null),
      out(E2, "student-a", 1, "2026-10-17T15:00:00.000Z"), out(E2, "student-b", 1, "2026-10-17T15:00:00.000Z"),
    ]);
    expect(row(report, E1).distribution).toMatchObject({ entries: 4, identifiedClients: 2, students: 1, partners: 1, unlinkedVisits: 1 });
    expect(row(report, E2).distribution).toMatchObject({ identifiedClients: 2, students: 2 });
    expect(report.totals.distribution).toMatchObject({ entries: 6, identifiedClients: 3, students: 2, partners: 1, unlinkedVisits: 1 });
  });

  it("adds only recorded measurements and counts the rest as incomplete", () => {
    const report = board([out(E1, "student-a", 3, undefined, 0, 0), out(E1, "student-b", 2, undefined, 1.25, 0.1)]);
    expect(row(report, E1).distribution).toMatchObject({ units: 5, weightLbs: 2.5, valueCents: 20, unweighedUnits: 3, unvaluedUnits: 3 });
  });

  it("never mixes donations into distributions or credits outgoing food to a donor", () => {
    const report = board([out(E1, "partner-x", 5), inbound(E1, { donorId: "donor-1", donor: "Synthetic Grocer" }, 7)]);
    expect(row(report, E1).distribution.units).toBe(5);
    expect(row(report, E1).receiving).toMatchObject({ entries: 1, units: 7, attributedEntries: 1 });
    expect(report.contributors).toEqual([expect.objectContaining({ key: "donor:donor-1", movement: expect.objectContaining({ units: 7, entries: 1 }) })]);
  });

  it("ranks only on recorded figures, flags incomplete rankings and breaks ties by name", () => {
    const transactions = [
      inbound(E1, { donorId: "donor-1", donor: "Synthetic Grocer" }, 10, 2, 1),
      inbound(E1, { donorId: "donor-4", donor: "Synthetic Bakery" }, 30, 0, 1),
      inbound(E1, { clientId: "partner-x", donor: "Synthetic Partner Org" }, 10, 2, 1),
    ];
    const byUnits = board(transactions);
    expect(byUnits.contributors.map((c) => c.name)).toEqual(["Synthetic Bakery", "Synthetic Grocer", "Synthetic Partner Org"]);
    expect(byUnits.contributors.every((c) => !c.incomplete)).toBe(true);
    const byWeight = board(transactions, { rankMetric: "weight" });
    // 30 unweighed units rank last on pounds and are marked, not guessed.
    expect(byWeight.contributors.map((c) => [c.name, c.movement.weightLbs, c.incomplete])).toEqual([
      ["Synthetic Grocer", 20, false], ["Synthetic Partner Org", 20, false], ["Synthetic Bakery", 0, true],
    ]);
  });

  it("credits no one for a shared legacy name and discloses name matches", () => {
    const report = board([
      inbound(E1, { donor: "Shared Name" }), inbound(E1, { donor: "synthetic grocer" }), inbound(E1, { source: "Purchase" }),
    ]);
    expect(report.coverage).toMatchObject({ ambiguousInbound: 1, nameMatchedInbound: 1, unattributedInbound: 1 });
    expect(report.contributors).toEqual([expect.objectContaining({ key: "donor:donor-1", nameMatchedEntries: 1 })]);
    expect(row(report, E1).receiving).toMatchObject({ entries: 3, attributedEntries: 1 });
  });

  it("combines students who brought food in and never names them", () => {
    const report = board([inbound(E1, { clientId: "student-a", donor: "Avery Synthetic" }), inbound(E1, { clientId: "student-b", donor: "Blake Synthetic" })]);
    expect(report.contributors).toEqual([expect.objectContaining({ key: "students", name: STUDENT_CONTRIBUTORS_LABEL, contributors: 2 })]);
    const files = [JSON.stringify(report), eventBoardCsv(report, ALL_EVENT_BOARD_DATA, 0), eventBoardHtml(report, ALL_EVENT_BOARD_DATA, 0)];
    for (const file of files) for (const secret of ["Avery", "Blake", "student-a", "student-b"]) expect(file).not.toContain(secret);
  });

  it("limits a chosen scope and lists a chosen event with nothing recorded as zero", () => {
    const transactions = [out(E1, "student-a"), out(E2, "student-b", 1, "2026-10-17T15:00:00.000Z"), out(null, "student-a")];
    const onlyFirst = board(transactions, { scope: { kind: "events", ids: [E1], includeUnassigned: false } });
    expect(onlyFirst.events.map((event) => event.key)).toEqual([E1]);
    expect(onlyFirst.scopeLabel).toBe("First Market");
    const firstAndUnassigned = board(transactions, { scope: { kind: "events", ids: [E1], includeUnassigned: true } });
    expect(firstAndUnassigned.events.map((event) => event.key)).toEqual([E1, UNASSIGNED_KEY]);
    expect(firstAndUnassigned.totals.distribution.identifiedClients).toBe(1);
    const quietEvent = board([], { scope: { kind: "events", ids: [E2], includeUnassigned: false } });
    expect(quietEvent.events).toEqual([expect.objectContaining({ key: E2, distribution: expect.objectContaining({ entries: 0 }) })]);
  });

  it("uses the inclusive Baltimore calendar for the date range", () => {
    // 11.30 PM Eastern on October 24 is already October 25 in UTC.
    const late = out(E1, "student-a", 1, "2026-10-25T03:30:00.000Z");
    expect(board([late], { range: { from: "2026-10-24", to: "2026-10-24" } }).totals.distribution.entries).toBe(1);
    expect(board([late], { range: { from: "2026-10-25", to: "" } }).totals.distribution.entries).toBe(0);
    expect(() => board([late], { range: { from: "2026-10-25", to: "2026-10-01" } })).toThrow();
  });

  it("orders events by date and flags an event id missing from the loaded list", () => {
    const report = board([out(E2, "student-a", 1, "2026-10-17T15:00:00.000Z"), out(E1, "student-a"), out("99999999-9999-4999-8999-999999999999", "student-b")]);
    // An unknown event has no start date, so it sits at its first saved activity.
    expect(report.events.map((event) => event.name)).toEqual(["First Market", "Unknown event 99999999", "Second Market"]);
    expect(report.coverage.unknownEventEntries).toBe(1);
  });
});

describe("one selection for screen, CSV and print", () => {
  const transactions = [
    out(E1, "student-a", 4), out(E1, "student-b", 2), out(E2, "student-a", 1, "2026-10-17T15:00:00.000Z"), out(null, "partner-x", 3),
    inbound(E1, { donorId: "donor-1", donor: "Synthetic Grocer" }, 12), inbound(E2, { donorId: "donor-4", donor: "Synthetic Bakery" }, 6),
  ];

  it("puts exactly the selected sections and measures in every output", () => {
    const report = board(transactions);
    const selection = ["distributions", "contributors", "units"] as const;
    const sections = eventBoardSections(report, selection);
    expect(sections.map((s) => s.key)).toEqual(["distributions", "contributors"]);
    expect(sections[0].columns).toEqual(["Event", "Date", "Visits", "Units", "Emergency visits"]);
    expect(sections[0].rows.at(-1)).toEqual(["Total", "", 4, 10, 0]);
    const csv = eventBoardCsv(report, selection);
    for (const section of sections) for (const r of section.rows) expect(csv).toContain(String(r[0]));
    expect(csv).not.toContain("Unique clients served");
    expect(csv).not.toContain("Recorded lbs");
    const html = eventBoardHtml(report, selection);
    expect(html).toContain("Systems by Design");
    expect(html).toContain("Distributions by event");
    expect(html).not.toContain("Unique clients served");
  });

  it("lists the top contributors it says, and every one when asked", () => {
    const report = board(transactions);
    expect(eventBoardSections(report, ["contributors"], 1)[0].rows).toHaveLength(1);
    expect(eventBoardSections(report, ["contributors"], 0)[0].rows).toHaveLength(2);
  });

  it("shows the trend in date order with words for the change", () => {
    const trend = eventBoardSections(board(transactions), ["trend", "units"])[0];
    expect(trend.rows.map((r) => [r[0], r[2], r[3]])).toEqual([["First Market", 2, "First in view"], ["Second Market", 1, "1 fewer"]]);
  });

  it("escapes names in the print document and guards spreadsheet formulas", () => {
    const hostile: BoardEvent[] = [{ id: E1, name: "<img src=x onerror=alert(1)>", startsAt: "2026-10-03T14:00:00.000Z", status: "active" }];
    const report = board([out(E1, "student-a")], { events: hostile });
    const html = eventBoardHtml(report, ALL_EVENT_BOARD_DATA);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const formula = board([out(E1, "student-a")], { events: [{ ...hostile[0], name: "=HYPERLINK(\"http://x\")" }] });
    expect(eventBoardCsv(formula, ALL_EVENT_BOARD_DATA)).toContain("'=HYPERLINK");
  });

  it("refuses an export with no section selected", () => {
    const report = board(transactions);
    expect(() => eventBoardCsv(report, ["units"])).toThrow();
    expect(() => eventBoardHtml(report, ["weight"])).toThrow();
  });
});
