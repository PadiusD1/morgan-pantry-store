import { apiRequest, saveErrorMessage } from "./queryClient";
import type { DonorRecord } from "./donor-cache";

export interface DonorForm {
  id?: string;
  name: string;
  organization: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  status: string;
}

export function donorSaveRequest(form: DonorForm) {
  const body = {
    name: form.name.trim(),
    // Null clears optional columns on PATCH. Undefined would disappear from
    // JSON and leave the old contact information in the database.
    organization: form.organization.trim() || null,
    contactName: form.contactName.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    notes: form.notes.trim() || null,
    status: form.status,
  };
  return form.id
    ? { method: "PATCH" as const, url: `/api/donors/${form.id}`, body }
    : { method: "POST" as const, url: "/api/donors", body };
}

export function confirmedDonor(value: unknown): DonorRecord {
  const donor = value as DonorRecord | null;
  if (!donor || typeof donor.id !== "string" || !donor.id || typeof donor.name !== "string") {
    throw new Error("The server did not return a saved donor. Your entries are kept.");
  }
  return donor;
}

export function donorErrorMessage(error: unknown, fallback: string): string {
  const sessionOrRetryMessage = saveErrorMessage(error, fallback);
  if (sessionOrRetryMessage !== fallback) return sessionOrRetryMessage;
  if (error instanceof Error && /^4(?:00|03|04|09|22): /.test(error.message)) {
    try {
      const body = JSON.parse(error.message.slice(error.message.indexOf(": ") + 2));
      if (typeof body.message === "string" && body.message.trim()) return body.message;
    } catch {
      // Non-JSON upstream errors keep the user-facing fallback.
    }
  }
  return fallback;
}

export async function saveDonorRecord(form: DonorForm, idempotencyKey: string) {
  const request = donorSaveRequest(form);
  const response = await apiRequest(
    request.method,
    request.url,
    request.body,
    request.method === "POST" ? { idempotencyKey } : undefined,
  );
  const donor = confirmedDonor(await response.json());
  // POST finds an existing same-name donor with HTTP 200. It does not update
  // that donor's other fields, so this must never be described as a creation.
  const outcome = form.id ? "updated" : response.status === 201 ? "created" : "existing";
  return { donor, outcome } as const;
}
