/** One transaction-scoped queue for the shared source directory.
 *
 * Donors, partner clients and student clients all participate in legacy name
 * attribution. Separate queues allowed a cross-kind rename/delete to change
 * the candidate set while another mutation checked historical ownership.
 * Every create/edit/delete and signup roster sync takes this same queue after
 * its idempotency claim (when present), before reading or changing identities.
 * There are no nested domain locks. Commit/rollback releases the queue.
 */
type Queryable = { query(text: string, values: unknown[]): Promise<unknown> };
export const SOURCE_IDENTITY_SCOPE = "frc:source-identity";
// Domain names remain descriptive at call sites; both protect the same set.
export const CLIENT_IDENTITY_SCOPE = SOURCE_IDENTITY_SCOPE;
export const DONOR_IDENTITY_SCOPE = SOURCE_IDENTITY_SCOPE;

export async function lockIdentityScope(client: Queryable, scope: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scope]);
}
