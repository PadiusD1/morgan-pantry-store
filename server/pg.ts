/**
 * Postgres connection layer (Supabase).
 *
 * - Single module-scope Pool, reused across warm serverless invocations.
 * - DATABASE_URL must point at the Supavisor transaction pooler (port 6543)
 *   in production; transaction mode forbids named prepared statements, which
 *   node-postgres does not use by default.
 * - Drizzle wraps the pool with the shared pg schema for typed queries.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  // TLS to Supabase. The Supavisor pooler presents a self-signed certificate
  // (not chained to a public CA), so strict verification fails the handshake
  // and takes the whole app offline — this is the documented default for
  // Supabase pooler connections. We therefore encrypt in transit but do not
  // verify the server cert by default. To harden (verify against Supabase's
  // downloaded CA), set PGSSL_REJECT_UNAUTHORIZED=true AND provide the CA via
  // PGSSL_CA. localhost stays exempt (no TLS).
  const reject = process.env.PGSSL_REJECT_UNAUTHORIZED === "true";
  const ssl = url.includes("localhost")
    ? undefined
    : {
        rejectUnauthorized: reject,
        ...(process.env.PGSSL_CA ? { ca: process.env.PGSSL_CA } : {}),
      };

  return new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

export const pool = createPool();

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/** Cheap health probe used by /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
