// Server side of the duplicate person rule in shared/identity.ts.
// One SQL query narrows the candidates on the normalised fields within the
// client type, then findDuplicate makes the decision.

import {
  findDuplicate,
  identityKeys,
  normaliseClientType,
  type DuplicateDecision,
  type IdentityField,
  type IdentityRecord,
} from "@shared/identity";

export type CandidateProbe = Record<IdentityField, string> & { clientType: string };
export type CandidateLookup = (probe: CandidateProbe) => Promise<IdentityRecord[]>;

// Each expression mirrors a normaliser in shared/identity.ts. A row comes back
// only when at least two of its normalised fields equal the probe's.
export const CANDIDATE_SQL = `
  SELECT id, name, identifier, email, phone, client_type AS "clientType"
    FROM clients
   WHERE coalesce(nullif(lower(btrim(regexp_replace(client_type, '\\s+', ' ', 'g'))), ''), 'student') = $1::text
     AND (CASE WHEN $2::text <> '' AND lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = $2::text THEN 1 ELSE 0 END
        + CASE WHEN $3::text <> '' AND lower(btrim(regexp_replace(identifier, '\\s+', ' ', 'g'))) = $3::text THEN 1 ELSE 0 END
        + CASE WHEN $4::text <> '' AND lower(regexp_replace(coalesce(email, ''), '^\\s+|\\s+$', '', 'g')) = $4::text THEN 1 ELSE 0 END
        + CASE WHEN $5::text <> '' AND regexp_replace(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), '^1(\\d{10})$', '\\1') = $5::text THEN 1 ELSE 0 END
         ) >= 2`;

export const sqlCandidateLookup: CandidateLookup = async (probe) => {
  const { pool } = await import("./pg");
  const { rows } = await pool.query(CANDIDATE_SQL, [
    probe.clientType,
    probe.name,
    probe.studentId,
    probe.email,
    probe.phone,
  ]);
  return rows;
};

// candidate is the record as it would be saved, before the stored record on
// an update so legacy duplicates stay editable.
export async function checkClientDuplicate(
  candidate: IdentityRecord,
  before: IdentityRecord | null = null,
  lookup: CandidateLookup = sqlCandidateLookup,
): Promise<DuplicateDecision<IdentityRecord>> {
  const keys = identityKeys(candidate);
  if (Object.values(keys).filter(Boolean).length < 2) return { duplicate: false };
  const rows = await lookup({ clientType: normaliseClientType(candidate.clientType), ...keys });
  return findDuplicate(candidate, rows, before);
}
