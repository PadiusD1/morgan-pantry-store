import { describe, expect, it } from "vitest";
import { partnerSaveRequest, type PartnerForm } from "@/lib/partner-save";
import { isPartnerContribution } from "@/lib/partner-contributions";
import { toTransaction, type ApiTransaction } from "@/lib/api-types";
import type { SourceOption } from "@shared/donation-source";

const partner = { id: "partner-1", name: "Community Farm" };
const form: PartnerForm = {
  name: "Another organization", identifier: "existing-partner-id", organization: "", partnershipType: "Community Organization", status: "active",
};
const sources: SourceOption[] = [{ ...partner, key: "partner:partner-1", kind: "partner", organization: null }];

describe("partner form saves", () => {
  it("always creates a new entry even when its typed identifier belongs to an existing partner", () => {
    const request = partnerSaveRequest(form);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/clients");
    expect(request.body).toMatchObject({ name: "Another organization", identifier: "existing-partner-id", clientType: "partner" });
  });

  it("edits only the explicitly selected partner and clears blank optional fields", () => {
    const request = partnerSaveRequest({ ...form, id: partner.id, phone: " ", email: "", notes: "" });
    expect(request.method).toBe("PATCH");
    expect(request.url).toBe("/api/clients/partner-1");
    expect(request.body).toMatchObject({ phone: null, email: null, notes: null, organization: null });
    // Fields outside this form must not be erased by editing the contact.
    expect(request.body).not.toHaveProperty("allergies");
    expect(request.body).not.toHaveProperty("householdSize");
  });
});

describe("partner contribution attribution", () => {
  it("uses the linked partner ID even after a partner is renamed", () => {
    expect(isPartnerContribution({ type: "IN", clientId: partner.id, donor: "Former Name" }, partner, sources)).toBe(true);
  });

  it("does not count another partner's same-name contribution", () => {
    expect(isPartnerContribution({ type: "IN", clientId: "partner-2", donor: partner.name }, partner, sources)).toBe(false);
  });

  it("does not count a linked donor with the same name, including a contradictory legacy client link", () => {
    expect(isPartnerContribution({ type: "IN", donorId: "donor-1", donor: partner.name }, partner, sources)).toBe(false);
    expect(isPartnerContribution({ type: "IN", donorId: "donor-1", clientId: partner.id, donor: partner.name }, partner, sources)).toBe(false);
  });

  it("keeps unambiguous legacy partner donations but does not assign a shared donor name twice", () => {
    const legacy = { type: "IN" as const, donor: "  COMMUNITY   FARM " };
    expect(isPartnerContribution(legacy, partner, sources)).toBe(true);
    expect(isPartnerContribution(legacy, partner, [
      ...sources, { ...partner, id: "donor-1", key: "donor:donor-1", kind: "donor", organization: null },
    ])).toBe(false);
    expect(isPartnerContribution(legacy, partner, [
      ...sources, { ...sources[0], id: "partner-2", key: "partner:partner-2" },
    ])).toBe(false);
  });

  it("does not count outbound distributions as contributions", () => {
    expect(isPartnerContribution({ type: "OUT", clientId: partner.id, donor: partner.name }, partner, sources)).toBe(false);
  });

  it("retains donorId through the API adapter so partner reporting can enforce ownership", () => {
    const api: ApiTransaction = {
      id: "tx-1", type: "IN", timestamp: "2026-10-01T12:00:00Z", createdAt: "2026-10-01T12:00:00Z",
      source: null, donor: partner.name, donorId: "donor-1", clientId: null, clientName: null,
      latitude: null, longitude: null, accuracy: null, items: [],
    };
    const transaction = toTransaction(api);
    expect(transaction.donorId).toBe("donor-1");
    expect(isPartnerContribution(transaction, partner, sources)).toBe(false);
  });
});
