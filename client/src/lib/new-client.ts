import type { ClientRecord } from "./repository";

// The record a new person gets before the server answers. Every field the
// caller typed is carried, the classification included, so the POST body and
// the optimistic cache both hold it.
export function newClientRecord(
  partial: Partial<ClientRecord> & { name: string; identifier: string },
  id: string,
  now: string,
): ClientRecord {
  return {
    id,
    name: partial.name,
    identifier: partial.identifier,
    contact: partial.contact,
    phone: partial.phone,
    email: partial.email,
    classification: partial.classification,
    address: partial.address,
    dateOfBirth: partial.dateOfBirth,
    householdSize: partial.householdSize ?? 1,
    eligibleDate: partial.eligibleDate,
    certificationDate: partial.certificationDate,
    status: partial.status ?? "active",
    // Carry partner-specific + emergency fields through so the POST body
    // and the optimistic cache both reflect what the caller passed in.
    clientType: partial.clientType ?? "student",
    organization: partial.organization,
    partnershipType: partial.partnershipType,
    allergies: partial.allergies,
    notes: partial.notes,
    createdAt: now,
    updatedAt: now,
  };
}
