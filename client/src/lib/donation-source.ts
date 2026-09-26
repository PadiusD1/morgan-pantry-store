import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { sourceFields, type SourceFields, type SourceOption } from "@shared/donation-source";

export type { SourceOption, SourceFields };

/** Donors and partners in one list, from the server. */
export function useDonationSources() {
  return useQuery<SourceOption[]>({ queryKey: ["/api/donation-sources"] });
}

/** A pick from the list, or a new donor name typed inline. */
export type DonorPick = { option?: SourceOption | null; newName?: string };

export type PostDonor = (name: string, idempotencyKey: string) => Promise<{ id: string; name: string }>;

/**
 * The fields recordInbound sends. A new name is found or created on the server
 * first, with its own key derived from the save's key so a retry sends the same.
 */
export async function pickFields(
  pick: DonorPick | null | undefined,
  saveKey: string,
  postDonor: PostDonor,
): Promise<SourceFields> {
  const newName = pick?.newName?.trim();
  if (newName) {
    const donor = await postDonor(newName, `${saveKey}:donor`);
    return { donor: donor.name, donorId: donor.id };
  }
  return sourceFields(pick?.option);
}

/** POST /api/donors, find or create by name on the server, with its Idempotency Key. */
export const postDonor: PostDonor = async (name, idempotencyKey) => {
  const res = await apiRequest("POST", "/api/donors", { name, status: "active" }, { idempotencyKey });
  return res.json();
};
