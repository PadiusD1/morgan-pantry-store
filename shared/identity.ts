// Duplicate person rule, shared by the server routes and their tests.
// A candidate is refused when two identifying fields match the same
// existing person of the same client type.

export type IdentityRecord = {
  id?: string | null;
  name?: string | null;
  identifier?: string | null;
  email?: string | null;
  phone?: string | null;
  clientType?: string | null;
};

export type IdentityField = "name" | "studentId" | "email" | "phone";

export type DuplicateDecision<T extends IdentityRecord> =
  | { duplicate: false }
  | { duplicate: true; match: T; fields: IdentityField[] };

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalisePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normaliseName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normaliseClientType(value: string | null | undefined): string {
  return normaliseName(value) || "student";
}

// A name or the word Unknown stored as the identifier is not a student ID,
// because check out falls back to them when no ID is typed.
export function studentIdKey(record: IdentityRecord): string {
  const id = normaliseName(record.identifier);
  if (!id || id === "unknown" || id === normaliseName(record.name)) return "";
  return id;
}

export function identityKeys(record: IdentityRecord): Record<IdentityField, string> {
  return {
    name: normaliseName(record.name),
    studentId: studentIdKey(record),
    email: normaliseEmail(record.email),
    phone: normalisePhone(record.phone),
  };
}

export function matchingFields(a: IdentityRecord, b: IdentityRecord): IdentityField[] {
  const ka = identityKeys(a);
  const kb = identityKeys(b);
  return (Object.keys(ka) as IdentityField[]).filter((f) => ka[f] !== "" && ka[f] === kb[f]);
}

// candidate is the record as it would be saved. before is the stored record
// on an update, so a match that already existed (a legacy duplicate) is never
// counted and only a match the changed fields create refuses the save.
export function findDuplicate<T extends IdentityRecord>(
  candidate: IdentityRecord,
  existing: readonly T[],
  before?: IdentityRecord | null,
): DuplicateDecision<T> {
  const selfId = candidate.id ?? before?.id ?? null;
  const type = normaliseClientType(candidate.clientType);
  for (const person of existing) {
    if (selfId && person.id === selfId) continue;
    if (normaliseClientType(person.clientType) !== type) continue;
    const fields = matchingFields(candidate, person);
    if (fields.length < 2) continue;
    if (before && matchingFields(before, person).length >= 2) continue;
    return { duplicate: true, match: person, fields };
  }
  return { duplicate: false };
}

export function duplicateMessage(person: IdentityRecord): string {
  const name = (person.name ?? "").trim();
  return name ? `${name} is already in` : "This person is already in";
}

export const GENERIC_DUPLICATE_MESSAGE = "A person with these details is already in";
