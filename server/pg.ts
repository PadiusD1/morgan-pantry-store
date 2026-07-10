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
  return new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
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
