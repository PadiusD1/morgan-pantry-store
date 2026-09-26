// Check out identity, item 13. Separate student ID and email inputs, a
// classification, the lookup of a returning student and the client payload.
// Pure functions, shared by the check out page, the server and the tests.

import { normaliseEmail, normaliseName } from "./identity";

export const CLASSIFICATIONS = [
  "Freshman",
  "Sophomore",
  "Junior",
  "Senior",
  "Graduate",
  "Faculty or staff",
  "Other",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export function isClassification(value: unknown): value is Classification {
  return typeof value === "string" && (CLASSIFICATIONS as readonly string[]).includes(value);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID_PATTERN = /^[A-Za-z0-9]{3,20}$/;

export type IdentityInputs = {
  studentId?: string | null;
  email?: string | null;
  classification?: string | null;
};

export type IdentityErrors = Partial<Record<"studentId" | "email" | "classification", string>>;

/** Each input is checked on its own, an empty input is allowed. */
export function validateIdentityInputs(inputs: IdentityInputs): IdentityErrors {
  const errors: IdentityErrors = {};
  const studentId = (inputs.studentId ?? "").trim();
  const email = (inputs.email ?? "").trim();
  const classification = (inputs.classification ?? "").trim();
  if (studentId) {
    if (studentId.includes("@")) {
      errors.studentId = "Put the email in the email box";
    } else if (!STUDENT_ID_PATTERN.test(studentId)) {
      errors.studentId = "Student ID must be 3 to 20 letters or numbers";
    }
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address";
  }
  if (classification && !isClassification(classification)) {
    errors.classification = "Pick a classification from the list";
  }
  return errors;
}

export type LookupClient = {
  id: string;
  name?: string | null;
  identifier?: string | null;
  email?: string | null;
  clientType?: string | null;
  classification?: string | null;
};

/**
 * Finds a returning student. Legacy rows hold an email or a name in
 * identifier, so the order is the student ID against identifier, then the
 * email against the email column, then the email against identifier.
 * Partners are never matched.
 */
export function findReturningClient<T extends LookupClient>(
  clients: readonly T[],
  inputs: { studentId?: string | null; email?: string | null },
): T | undefined {
  const students = clients.filter((c) => !c.clientType || c.clientType === "student");
  const studentId = normaliseName(inputs.studentId);
  const email = normaliseEmail(inputs.email);
  if (studentId) {
    const byId = students.find((c) => normaliseName(c.identifier) === studentId);
    if (byId) return byId;
  }
  if (email) {
    const byEmail = students.find((c) => normaliseEmail(c.email) === email);
    if (byEmail) return byEmail;
    const byLegacyIdentifier = students.find((c) => normaliseEmail(c.identifier) === email);
    if (byLegacyIdentifier) return byLegacyIdentifier;
  }
  return undefined;
}

export const GENERATED_ID_PREFIX = "FRC";

/**
 * A unique identifier for a record saved with no student ID, never the name
 * or the word Unknown. `random` returns a UUID and is injected by the tests.
 */
export function generateIdentifier(
  taken: Iterable<string | null | undefined> = [],
  random: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const used = new Set<string>();
  for (const t of taken) if (t) used.add(normaliseName(t));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = GENERATED_ID_PREFIX + random().replace(/[^0-9a-f]/gi, "").slice(0, 10).toUpperCase();
    if (candidate.length > GENERATED_ID_PREFIX.length && !used.has(normaliseName(candidate))) return candidate;
  }
  throw new Error("Could not generate a unique identifier");
}

export function isGeneratedIdentifier(value: string | null | undefined): boolean {
  return new RegExp(`^${GENERATED_ID_PREFIX}[0-9A-F]{10}$`).test((value ?? "").trim());
}

/**
 * Splits a stored record into the two inputs. A legacy identifier that holds
 * an email fills the email box, and a name, Unknown or a generated identifier
 * leaves the student ID box empty.
 */
export function inputsFromClient(client: LookupClient): { studentId: string; email: string } {
  const identifier = (client.identifier ?? "").trim();
  const legacyEmail = identifier.includes("@") ? identifier : "";
  const isRealId =
    identifier !== "" &&
    !legacyEmail &&
    normaliseName(identifier) !== "unknown" &&
    normaliseName(identifier) !== normaliseName(client.name) &&
    !isGeneratedIdentifier(identifier);
  return {
    studentId: isRealId ? identifier : "",
    email: (client.email ?? "").trim() || legacyEmail,
  };
}

export type CheckoutClientPayload = {
  id?: string;
  name: string;
  identifier: string;
  email?: string;
  classification?: Classification;
  contact?: string;
};

/**
 * The client part of a check out. A typed student ID wins, a returning
 * record keeps its identifier, a new record with no ID gets a generated one.
 * Pass the save key as `random` so a retry of the same save regenerates the
 * same identifier and the retried create matches the first one.
 */
export function buildCheckoutClient(input: {
  existing?: LookupClient | null;
  name: string;
  studentId?: string | null;
  email?: string | null;
  classification?: string | null;
  contact?: string | null;
  takenIdentifiers?: Iterable<string | null | undefined>;
  random?: () => string;
}): CheckoutClientPayload {
  const studentId = (input.studentId ?? "").trim();
  const email = (input.email ?? "").trim();
  const classification = (input.classification ?? "").trim() || (input.existing?.classification ?? "").trim();
  const contact = (input.contact ?? "").trim();
  const existingIdentifier = (input.existing?.identifier ?? "").trim();
  const identifier =
    studentId ||
    existingIdentifier ||
    generateIdentifier(input.takenIdentifiers ?? [], input.random);
  const payload: CheckoutClientPayload = {
    name: input.name.trim(),
    identifier,
  };
  if (input.existing?.id) payload.id = input.existing.id;
  if (email) payload.email = email;
  if (isClassification(classification)) payload.classification = classification;
  if (contact) payload.contact = contact;
  return payload;
}
