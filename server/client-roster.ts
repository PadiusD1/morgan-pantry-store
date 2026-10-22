/**
 * Keeping the pantry's client roster in step with a student account signup.
 *
 * This is the third writer of the shared `clients` table, after the staff
 * create route and the staff edit route, and it used to read and insert without
 * the identity queue. A student signing up on a phone while a staff member
 * registered them at the desk could therefore produce two records for one
 * person. It now takes the same queue as the other two writers, re-reads inside
 * it, and stays best effort: the account is what the signup promised, and a
 * roster row that cannot be added is reported rather than allowed to fail the
 * signup.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { eq } from "drizzle-orm";
import { clients as clientsTable, type InsertClient } from "@shared/schema";
import { candidateLookupOn, checkClientDuplicate } from "./client-duplicates";
import { CLIENT_IDENTITY_SCOPE, lockIdentityScope } from "./identity-lock";
import { pool } from "./pg";

export type RosterOutcome = "created" | "already-present" | "duplicate-person" | "failed";

export async function syncRosterClient(data: InsertClient): Promise<RosterOutcome> {
  let client: PoolClient | undefined;
  try {
    // Pool acquisition is part of best-effort roster sync too. Signup has
    // already saved the account, so even a pool timeout must not reject it.
    client = await pool.connect();
    await client.query("BEGIN");
    await lockIdentityScope(client, CLIENT_IDENTITY_SCOPE);
    const db = drizzle(client);

    // Re-read under the queue. A row inserted by another writer a moment ago
    // is visible here, which is the whole point of holding the lock first.
    const [byIdentifier] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.identifier, data.identifier));
    if (byIdentifier) {
      await client.query("ROLLBACK");
      return "already-present";
    }

    const duplicate = await checkClientDuplicate(
      { ...data, id: null },
      null,
      candidateLookupOn(client),
    );
    if (duplicate.duplicate) {
      await client.query("ROLLBACK");
      return "duplicate-person";
    }

    await db.insert(clientsTable).values(data);
    await client.query("COMMIT");
    return "created";
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return "failed";
  } finally {
    client?.release();
  }
}
