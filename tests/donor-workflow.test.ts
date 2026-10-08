import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { cacheSavedDonor, donorKeys, invalidateDonorData, removeCachedDonor, type DonorRecord } from "@/lib/donor-cache";
import { donorErrorMessage, donorSaveRequest, saveDonorRecord, type DonorForm } from "@/lib/donor-save";
import { getQueryFn, isEarlierSaveRecorded, SessionExpiredError, SESSION_EXPIRED_MESSAGE } from "@/lib/queryClient";

const donor: DonorRecord = { id: "donor-1", name: "Community Farm", status: "active", createdAt: "2026-10-01T12:00:00Z" };
const form: DonorForm = {
  name: " Community Farm ", organization: "", contactName: "", phone: "", email: "",
  address: "", notes: "", status: "active",
};
const clients: QueryClient[] = [];

function queryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("donor save contract", () => {
  it("clears optional contact fields with explicit nulls when editing", () => {
    const request = donorSaveRequest({ ...form, id: donor.id });
    const body = JSON.parse(JSON.stringify(request.body));
    expect(request.method).toBe("PATCH");
    expect(request.url).toBe("/api/donors/donor-1");
    expect(body).toEqual({
      name: "Community Farm", organization: null, contactName: null, phone: null,
      email: null, address: null, notes: null, status: "active",
    });
  });

  it("publishes the server's canonical new donor without waiting for a page reload", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.all, []);
    const fetch = vi.fn().mockResolvedValue(Response.json(donor, { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    const saved = await saveDonorRecord(form, "create-donor-key");
    await cacheSavedDonor(client, saved.donor);

    expect(saved.outcome).toBe("created");
    expect(client.getQueryData(donorKeys.all)).toEqual([donor]);
    expect(client.getQueryData(donorKeys.detail(donor.id))).toEqual(donor);
    expect(fetch.mock.calls[0][0]).toBe("/api/donors");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Idempotency-Key": "create-donor-key" } });
  });

  it("does not claim to create or update a same-name donor returned by POST", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...donor, email: "old@example.test" }, { status: 200 })));
    const saved = await saveDonorRecord({ ...form, email: "new@example.test" }, "same-name-key");
    expect(saved.outcome).toBe("existing");
    expect(saved.donor.email).toBe("old@example.test");
  });

  it.each([200, 201])("preserves replay status %s after a lost answer and edited retry", async (status) => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("Synthetic lost response"))
      .mockResolvedValueOnce(Response.json({ message: "This key was already used for a different save" }, {
        status: 422, headers: { "Idempotency-Key-Status": "held" },
      }))
      .mockResolvedValueOnce(Response.json(donor, { status }));
    vi.stubGlobal("fetch", fetch);
    const key = `lost-donor-response-${status}`;
    await expect(saveDonorRecord(form, key)).rejects.toThrow("Synthetic lost response");

    const failure = await saveDonorRecord({ ...form, name: "Different donor" }, key).catch((error: unknown) => error);
    expect(isEarlierSaveRecorded(failure)).toBe(true);
    if (!isEarlierSaveRecorded(failure)) throw failure;
    expect(failure.recordedStatus).toBe(status);
    expect(failure.recorded).toEqual(donor);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(donorSaveRequest(form).body);
  });

  it("identifies a confirmed edit and preserves its explicit cleared field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...donor, phone: null })));
    const saved = await saveDonorRecord({ ...form, id: donor.id }, "edit-key");
    expect(saved.outcome).toBe("updated");
    expect(saved.donor.phone).toBeNull();
  });

  it("keeps the cache unchanged when a donor save is refused", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.all, [donor]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Invalid data" }, { status: 400 })));
    await expect(saveDonorRecord({ ...form, name: "Another donor" }, "refused-key")).rejects.toThrow("400:");
    expect(client.getQueryData(donorKeys.all)).toEqual([donor]);
  });

  it("does not accept an empty success response as a saved donor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true }, { status: 201 })));
    await expect(saveDonorRecord(form, "malformed-key")).rejects.toThrow("did not return a saved donor");
  });

  it("explains a donor with linked history cannot be deleted and retains the sign-in message", () => {
    expect(donorErrorMessage(new Error('409: {"message":"Set this donor to inactive to preserve donation history."}'), "Try again"))
      .toBe("Set this donor to inactive to preserve donation history.");
    expect(donorErrorMessage(new SessionExpiredError("expired"), "Try again")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(donorErrorMessage(new Error('500: {"message":"internal SQL error"}'), "Try again")).toBe("Try again");
  });
});

describe("donor list, detail, history and source cache consistency", () => {
  it("refetches active donor totals and history after a donation despite infinite stale time", async () => {
    const client = queryClient();
    const responses: Record<string, unknown> = {
      "/api/donors": [{ ...donor, totalDonations: 1, totalItems: 4 }],
      "/api/donors/donor-1": { ...donor, totalDonations: 1 },
      "/api/donors/donor-1/history": [{ id: "tx-1", totalQuantity: 4 }],
      "/api/donation-sources": [{ id: donor.id, name: donor.name }],
    };
    const fetch = vi.fn(async (url: string) => Response.json(responses[url]));
    vi.stubGlobal("fetch", fetch);
    const queryFn = getQueryFn({ on401: "throw" });
    const keys = [donorKeys.all, donorKeys.detail(donor.id), donorKeys.history(donor.id), ["/api/donation-sources"]];
    const unsubscribe = keys.map((queryKey) => {
      client.setQueryData(queryKey, queryKey.length === 2 ? donor : []);
      return new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity }).subscribe(() => {});
    });
    client.setQueryData(["/api/inventory"], [{ id: "rice", quantity: 5 }]);
    expect(fetch).not.toHaveBeenCalled();

    await invalidateDonorData(client);

    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(Object.keys(responses).sort());
    expect(client.getQueryData(donorKeys.history(donor.id))).toEqual([{ id: "tx-1", totalQuantity: 4 }]);
    expect(client.getQueryData<DonorRecord[]>(donorKeys.all)?.[0].totalItems).toBe(4);
    expect(client.getQueryState(["/api/inventory"])?.isInvalidated).toBe(false);
    unsubscribe.forEach((stop) => stop());
  });

  it("marks previously visited inactive histories stale so navigating back reloads them", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.detail(donor.id), donor);
    client.setQueryData(donorKeys.history(donor.id), []);
    await invalidateDonorData(client);
    expect(client.getQueryState(donorKeys.detail(donor.id))?.isInvalidated).toBe(true);
    expect(client.getQueryState(donorKeys.history(donor.id))?.isInvalidated).toBe(true);
  });

  it("preserves existing totals when saving only a donor profile and does not duplicate the row", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.all, [{ ...donor, totalDonations: 2, totalItems: 9, phone: "555-1234" }]);
    await cacheSavedDonor(client, { ...donor, phone: null });
    await cacheSavedDonor(client, { ...donor, phone: null });
    expect(client.getQueryData(donorKeys.all)).toEqual([{ ...donor, totalDonations: 2, totalItems: 9, phone: null }]);
  });

  it("prevents an older in-flight list response from erasing the confirmed new row", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.all, []);
    let resolveOld!: (value: DonorRecord[]) => void;
    const staleRead = client.fetchQuery({
      queryKey: donorKeys.all,
      staleTime: 0,
      queryFn: () => new Promise<DonorRecord[]>((resolve) => { resolveOld = resolve; }),
    }).catch(() => undefined);
    await cacheSavedDonor(client, donor);
    resolveOld([]);
    await staleRead;
    expect(client.getQueryData(donorKeys.all)).toEqual([donor]);
  });

  it("removes a confirmed deletion from both the list and cached detail/history", async () => {
    const client = queryClient();
    client.setQueryData(donorKeys.all, [donor]);
    client.setQueryData(donorKeys.detail(donor.id), donor);
    client.setQueryData(donorKeys.history(donor.id), []);
    client.setQueryData(["/api/donation-sources"], [{ id: donor.id }]);
    await removeCachedDonor(client, donor.id);
    expect(client.getQueryData(donorKeys.all)).toEqual([]);
    expect(client.getQueryData(donorKeys.detail(donor.id))).toBeUndefined();
    expect(client.getQueryData(donorKeys.history(donor.id))).toBeUndefined();
    expect(client.getQueryState(["/api/donation-sources"])?.isInvalidated).toBe(true);
  });
});
