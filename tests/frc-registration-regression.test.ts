import { describe, expect, it, vi } from "vitest";
import { visibleDonors } from "../client/src/lib/donor-list";
import { pickFields } from "../client/src/lib/donation-source";
import type { DonorRecord } from "../client/src/lib/donor-cache";

const donors: DonorRecord[] = [
  { id: "old", name: "A donor with history", createdAt: "2026-01-01T12:00:00Z", status: "active", totalDonations: 10 },
  { id: "new", name: "Z new donor", createdAt: "2026-10-14T12:00:00Z", status: "active", totalDonations: 0, contactName: "Searchable contact", email: "new@example.test" },
  { id: "legacy", name: "B legacy", createdAt: "invalid", status: "active" },
];
describe("new registrations", () => {
  it("shows zero-donation additions first without changing the canonical list", () => {
    const before = JSON.stringify(donors);
    expect(visibleDonors(donors, "", "newest").map(d => d.id)).toEqual(["new", "old", "legacy"]);
    expect(JSON.stringify(donors)).toBe(before);
  });
  it("supports explicit alphabetical sorting and contact search", () => {
    expect(visibleDonors(donors, "", "name").map(d => d.id)).toEqual(["old", "legacy", "new"]);
    expect(visibleDonors(donors, "SEARCHABLE contact", "newest").map(d => d.id)).toEqual(["new"]);
    expect(visibleDonors(donors, "new@example", "newest").map(d => d.id)).toEqual(["new"]);
  });
  it("registers an inline partner with its own retry key and partner attribution", async () => {
    const donor = vi.fn();
    const partner = vi.fn(async (name: string, _key: string) => ({ id: "partner-1", name }));
    const form = { newName: "  Community Pantry  ", newKind: "partner" as const };
    for (let i = 0; i < 2; i++) expect(await pickFields(form, "attempt-1", donor, partner)).toEqual({ donor: "Community Pantry", donorClientId: "partner-1" });
    expect(donor).not.toHaveBeenCalled();
    expect(partner.mock.calls).toEqual([["Community Pantry", "attempt-1:partner"], ["Community Pantry", "attempt-1:partner"]]);
  });
  it("never silently registers a requested partner as a donor", async () => {
    const donor = vi.fn();
    await expect(pickFields({ newName: "Partner", newKind: "partner" }, "k", donor)).rejects.toThrow();
    expect(donor).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { cacheSavedPartner } from "../client/src/lib/partner-save";
import { cacheSavedDonor } from "../client/src/lib/donor-cache";
import { resolveCheckoutIdentity } from "../shared/checkout-identity";

describe("canonical partner and source records", () => {
  it("retains a server-confirmed source when the follow-up source read fails", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = ["/api/donation-sources"];
    cache.setQueryData(key, []);
    const observer = new QueryObserver(cache, { queryKey: key, staleTime: Infinity, queryFn: async () => { throw new Error("read temporarily unavailable"); } });
    const stop = observer.subscribe(() => {});
    await cacheSavedPartner(cache, { id: "partner", name: "Same name", clientType: "partner" });
    await cacheSavedDonor(cache, { id: "donor", name: "Same name", createdAt: "2026-10-14", status: "active" });
    expect(cache.getQueryData(key)).toEqual([
      { id: "donor", name: "Same name", kind: "donor", key: "donor:donor", organization: null },
      { id: "partner", name: "Same name", kind: "partner", key: "partner:partner", organization: null },
    ]);
    stop(); cache.clear();
  });
  it("keeps an explicitly selected partner separate from a student's shared contact email", () => {
    const partner = { id: "partner", clientType: "partner", name: "Community Pantry", identifier: "PARTNER-unique-id", email: "contact@example.test" };
    const student = { id: "student", clientType: "student", name: "Student", identifier: "1234567", email: partner.email };
    expect(resolveCheckoutIdentity([student, partner], { selected: partner, studentId: partner.identifier, email: partner.email, name: "Typed different name" })).toEqual({ ok: true, existing: partner, name: partner.name });
    expect(resolveCheckoutIdentity([student, partner], { selected: partner, studentId: student.identifier, name: partner.name }).ok).toBe(false);
  });
});
