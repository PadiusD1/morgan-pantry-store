import { describe, expect, it } from "vitest";
import { eventWhen, fromLocalInput, isEventRefusal, toLocalInput } from "../client/src/lib/events";
import { receiptFromFulfilled, receiptFromSaved } from "../client/src/lib/receipt";

describe("event refusals", () => {
  it("recognises only the server's event refusals", () => {
    expect(isEventRefusal(new Error('409: {"message":"Synthetic Market has ended.","code":"event_closed"}'))).toBe(true);
    expect(isEventRefusal(new Error('409: {"message":"gone","code":"event_missing"}'))).toBe(true);
    expect(isEventRefusal(new Error('409: {"message":"not set up","code":"event_tracking_unavailable"}'))).toBe(true);
    expect(isEventRefusal(new Error('409: {"message":"This request is still being saved"}'))).toBe(false);
    expect(isEventRefusal(new Error('422: {"code":"event_closed"}'))).toBe(false);
    expect(isEventRefusal("event_closed")).toBe(false);
  });
});

describe("event times", () => {
  it("shows Baltimore time with the end on the same day", () => {
    expect(eventWhen({ startsAt: "2026-10-24T14:00:00.000Z", endsAt: "2026-10-24T18:30:00.000Z" })).toBe("Sat, Oct 24, 2026, 10:00 AM to 2:30 PM");
    expect(eventWhen({ startsAt: "2026-10-24T14:00:00.000Z", endsAt: null })).toBe("Sat, Oct 24, 2026, 10:00 AM");
    expect(eventWhen({ startsAt: "not a date", endsAt: null })).toBe("");
  });

  it("round trips a datetime-local value through an instant", () => {
    const local = toLocalInput("2026-10-24T14:05:00.000Z");
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe("2026-10-24T14:05:00.000Z");
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });
});

describe("receipts name the saved event", () => {
  const saved = { type: "OUT", clientName: "Synthetic Student", timestamp: "2026-10-24T15:00:00.000Z", items: [{ name: "Rice", quantity: 2, weightPerUnitLbs: "1.5", valuePerUnitUsd: "2.25" }] };

  it("shows the event the server saved and nothing when there was none", () => {
    expect(receiptFromSaved({ ...saved, eventName: "Synthetic Market" }, [], "x")?.eventName).toBe("Synthetic Market");
    expect(receiptFromSaved({ ...saved, eventName: null }, [], "x")).not.toHaveProperty("eventName");
    expect(receiptFromSaved({ ...saved, eventName: "   " }, [], "x")).not.toHaveProperty("eventName");
  });

  it("carries the event of a fulfilled request pickup", () => {
    const fulfilled = { clientName: "Synthetic Student", clientIdentifier: "SYN1", transaction: { ...saved, eventName: "Synthetic Market" } };
    expect(receiptFromFulfilled(fulfilled, "x")?.eventName).toBe("Synthetic Market");
  });
});
