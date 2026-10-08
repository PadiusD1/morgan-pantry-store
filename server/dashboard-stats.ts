import { pool } from "./pg";

/** Aggregate in PostgreSQL instead of downloading history and querying each visit. */
export async function loadDashboardStats(now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [visits, categories, topItems, clients, requests] = await Promise.all([
    pool.query(`SELECT count(*)::int AS count FROM transactions WHERE type = 'OUT' AND timestamp >= $1`, [weekAgo]),
    pool.query(`SELECT COALESCE(NULLIF(category, ''), 'Uncategorized') AS name, sum(quantity)::int AS count
                FROM inventory_items GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT ti.inventory_item_id AS id,
                  (array_agg(ti.name ORDER BY t.timestamp DESC, t.id DESC))[1] AS name,
                  sum(ti.quantity)::int AS total
                FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
                WHERE t.type = 'OUT' AND t.timestamp >= $1
                GROUP BY ti.inventory_item_id ORDER BY total DESC, id LIMIT 10`, [monthAgo]),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM clients`),
    pool.query(`SELECT
                  count(*) FILTER (WHERE status IN ('pending', 'under_review'))::int AS pending,
                  count(*) FILTER (WHERE status IN ('approved', 'partially_approved', 'ready_for_pickup'))::int AS ready,
                  count(*) FILTER (WHERE created_at >= (date_trunc('day', $1::timestamptz AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
                    AND created_at < ((date_trunc('day', $1::timestamptz AT TIME ZONE 'America/New_York') + interval '1 day') AT TIME ZONE 'America/New_York'))::int AS today,
                  count(*) FILTER (WHERE status IN ('expired', 'no_show') AND updated_at >= $2)::int AS expired
                FROM requests`, [now.toISOString(), weekAgo]),
  ]);
  return {
    weeklyVisits: visits.rows[0].count,
    categoryBreakdown: categories.rows,
    topDistributedItems: topItems.rows,
    totalClients: clients.rows[0].total,
    activeClients: clients.rows[0].active,
    pendingRequests: requests.rows[0].pending,
    approvedReadyForPickup: requests.rows[0].ready,
    todayRequests: requests.rows[0].today,
    expiredNoShowCount: requests.rows[0].expired,
  };
}
