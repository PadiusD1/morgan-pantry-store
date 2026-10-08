import type { Pool } from "pg";
import { normaliseDonorName } from "@shared/donation-source";

/**
 * A single database read for a donor's transactions and their item snapshots.
 * Joining items in bulk keeps report latency independent of donation count.
 * Legacy name matches exclude partner-linked transactions and select one
 * donor deterministically when historical duplicate names exist.
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
         AND $1 = (
           SELECT d.id FROM donors d
           WHERE lower(btrim(regexp_replace(d.name, '\\s+', ' ', 'g'))) = $2
           ORDER BY (d.status = 'active') DESC, d.created_at ASC, d.id ASC
           LIMIT 1
         )
       )
     )
     GROUP BY t.id
     ORDER BY t.timestamp DESC, t.id`,
    [donorId, normaliseDonorName(donorName)],
  );
  return rows;
}
