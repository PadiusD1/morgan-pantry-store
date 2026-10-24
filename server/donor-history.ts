import type { Pool } from "pg";
import { normaliseDonorName } from "@shared/donation-source";

/**
 * A single database read for a donor's transactions and their item snapshots.
 * Joining items in bulk keeps report latency independent of donation count.
 *
 * Legacy name matches exclude client-linked transactions, and a name shared by
 * more than one donor record matches none of them. This used to select one by
 * status and age, which credited an individual with food the pantry cannot
 * prove came from them. Those rows now stay unallocated and are counted
 * separately, so the gap is visible instead of being quietly assigned.
 */
export async function loadDonorHistory(
  db: Pick<Pool, "query">,
  donorId: string,
  donorName: string,
) {
  const { rows } = await db.query(
    `SELECT t.*, COALESCE(
       json_agg(ti ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]'
     ) AS line_items
     FROM transactions t
     LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
     WHERE t.type = 'IN' AND (
       t.donor_id = $1 OR (
         t.donor_id IS NULL AND t.client_id IS NULL
         AND lower(btrim(regexp_replace(t.donor, '\\s+', ' ', 'g'))) = $2
         AND 1 = (
           SELECT count(*) FROM (
             SELECT name FROM donors UNION ALL SELECT name FROM clients
           ) sources
           WHERE lower(btrim(regexp_replace(sources.name, '\\s+', ' ', 'g'))) = $2
         )
         AND EXISTS (
           SELECT 1 FROM donors d WHERE d.id = $1
             AND lower(btrim(regexp_replace(d.name, '\\s+', ' ', 'g'))) = $2
         )
       )
     )
     GROUP BY t.id
     ORDER BY t.timestamp DESC, t.id`,
    [donorId, normaliseDonorName(donorName)],
  );
  return rows;
}

/** Raw name-only evidence must survive directory edits even when ambiguous. */
export async function hasUnlinkedDonorHistory(db: Pick<Pool, "query">, donorName: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM transactions
       WHERE type = 'IN' AND donor_id IS NULL AND client_id IS NULL
         AND lower(btrim(regexp_replace(donor, '\\s+', ' ', 'g'))) = $1
     ) AS present`,
    [normaliseDonorName(donorName)],
  );
  return rows[0].present;
}
