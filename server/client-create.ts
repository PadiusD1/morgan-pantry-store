// POST /api/clients as one idempotent unit of work. The duplicate refusal and
// the unique identifier answer stay inside, so a refusal rolls back and frees
// the key. Dependencies are injected so the tests need no database.

import { isClassification } from "@shared/checkout-identity";
import type { IdempotentResult } from "./idempotency";

export const CLASSIFICATION_MESSAGE = "Pick a classification from the list";

export type ClientCreateDeps<T extends { id?: string | null }> = {
  checkDuplicate: (data: any) => Promise<{ duplicate: false } | { duplicate: true; match: T }>;
  duplicateMessage: (match: T) => string;
  insert: (data: any) => Promise<unknown>;
  isUniqueViolation: (err: unknown) => boolean;
};

/** A classification is optional, and when given it must be one of the list. */
export function classificationProblem(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return isClassification(value) ? null : CLASSIFICATION_MESSAGE;
}

export async function createClientWork<T extends { id?: string | null }>(
  data: { identifier: string; classification?: unknown } & Record<string, unknown>,
  deps: ClientCreateDeps<T>,
): Promise<IdempotentResult> {
  const problem = classificationProblem(data.classification);
  if (problem) return { status: 400, body: { message: problem } };
  const dup = await deps.checkDuplicate(data);
  if (dup.duplicate) {
    return { status: 409, body: { message: deps.duplicateMessage(dup.match), duplicateOf: dup.match.id } };
  }
  try {
    return { status: 201, body: await deps.insert(data) };
  } catch (err) {
    if (deps.isUniqueViolation(err)) {
      return {
        status: 409,
        body: { message: `A client with identifier "${data.identifier}" already exists. Use a different identifier.` },
      };
    }
    throw err;
  }
}

/** The classification copied onto a check out, only a listed value is kept. */
export function transactionClassification(value: unknown): string | null {
  return isClassification(value) ? value : null;
}
