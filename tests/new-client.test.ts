import { describe, expect, it } from "vitest";
import { newClientRecord } from "@/lib/new-client";

describe("a new client record", () => {
  it("keeps the classification typed at check out, so the person row stores it", () => {
    const record = newClientRecord(
      { name: "Test Student Eight", identifier: "T0000008", email: "eight@example.invalid", classification: "Junior" },
      "temp-8",
      "2026-09-26T18:00:00.000Z",
    );
    expect(record.classification).toBe("Junior");
    expect(record).toMatchObject({
      id: "temp-8",
      name: "Test Student Eight",
      identifier: "T0000008",
      email: "eight@example.invalid",
      householdSize: 1,
      status: "active",
      clientType: "student",
      createdAt: "2026-09-26T18:00:00.000Z",
      updatedAt: "2026-09-26T18:00:00.000Z",
    });
  });
});
