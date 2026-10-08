import { clientSaveRequest } from "./client-save";
import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "./api-types";

export type PartnerForm = {
  id?: string;
  name: string;
  identifier: string;
  organization: string;
  partnershipType: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: string;
  notes?: string;
};

export function partnerSaveRequest(form: PartnerForm) {
  // New entries always POST. Matching a typed identifier to an existing row
  // and PATCHing it would silently rename a different organization.
  return clientSaveRequest(form.id, {
    name: form.name.trim(),
    identifier: form.identifier.trim(),
    contact: form.contact?.trim() ?? "",
    phone: form.phone?.trim() ?? "",
    email: form.email?.trim() ?? "",
    address: form.address?.trim() ?? "",
    organization: form.organization.trim(),
    partnershipType: form.partnershipType,
    status: form.status,
    notes: form.notes?.trim() ?? "",
    clientType: "partner",
  });
}

export async function cacheSavedPartner(queryClient: QueryClient, value: unknown): Promise<ApiClient> {
  const saved = value as ApiClient | null;
  if (!saved || typeof saved.id !== "string" || !saved.id || typeof saved.name !== "string" || saved.clientType !== "partner") {
    throw new Error("The server did not return a saved partner.");
  }
  await queryClient.cancelQueries({ queryKey: ["/api/clients"] });
  queryClient.setQueryData<ApiClient[]>(["/api/clients"], (old) => [
    ...(old ?? []).filter((client) => client.id !== saved.id),
    saved,
  ]);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/donation-sources"] }),
  ]);
  return saved;
}
