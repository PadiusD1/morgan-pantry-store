import type { QueryClient } from "@tanstack/react-query";

export interface DonorRecord {
  id: string;
  name: string;
  organization?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  status: string;
  totalDonations?: number;
  totalItems?: number;
  totalItemsDonated?: number;
  totalWeightDonated?: number;
  totalValueDonated?: number;
  lastDonation?: string | null;
  createdAt: string;
}

// Every donor query shares this prefix. With the app's infinite stale time,
// a successful donation must invalidate the history as well as the list.
export const donorKeys = {
  all: ["/api/donors"] as const,
  detail: (id: string) => ["/api/donors", id] as const,
  history: (id: string) => ["/api/donors", id, "history"] as const,
};

export async function invalidateDonorData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: donorKeys.all }),
    queryClient.invalidateQueries({ queryKey: ["/api/donation-sources"] }),
  ]);
}

/** Publish only a server-confirmed donor, preserving already-loaded totals. */
export async function cacheSavedDonor(queryClient: QueryClient, saved: DonorRecord): Promise<void> {
  // A list request started before the save must not overwrite the saved row.
  await queryClient.cancelQueries({ queryKey: donorKeys.all });
  queryClient.setQueryData<DonorRecord[]>(donorKeys.all, (old) => {
    const previous = old?.find((donor) => donor.id === saved.id);
    return [
      ...(old ?? []).filter((donor) => donor.id !== saved.id),
      { ...previous, ...saved },
    ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  });
  queryClient.setQueryData<DonorRecord>(donorKeys.detail(saved.id), (old) => ({ ...old, ...saved }));
  await invalidateDonorData(queryClient);
}

/** Remove a donor only after the server confirms deletion. */
export async function removeCachedDonor(queryClient: QueryClient, id: string): Promise<void> {
  await queryClient.cancelQueries({ queryKey: donorKeys.all });
  queryClient.setQueryData<DonorRecord[]>(donorKeys.all, (old) => old?.filter((donor) => donor.id !== id));
  queryClient.removeQueries({ queryKey: donorKeys.detail(id) });
  await invalidateDonorData(queryClient);
}
