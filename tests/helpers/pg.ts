/**
 * Real Postgres harness for integration tests (files named *.pgtest.ts).
 *
 * Run with `npx vitest run --config vitest.pg.config.ts`. The plain config
 * never includes these files, so a unit test run cannot start Postgres.
 *
 * The server is PostgreSQL 17 on localhost only. Each test file gets a fresh
 * database with migrations/0000, the production only indexes and
 * migrations/0001 applied, and drops it afterwards.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

export const PG_PORT = Number(process.env.FRC_TEST_PG_PORT || 55417);
export const PG_USER = "frc";
// Where PostgreSQL 17 and the test cluster live. FRC_PG_BIN and FRC_PG_LIB
// name a PostgreSQL 17 install, FRC_TEST_PG_ROOT a folder holding an initdb
// cluster in pg17-data (user frc, trust auth). The defaults suit a Debian
// package install.
const PG_ROOT = process.env.FRC_PG_BIN || "/usr/lib/postgresql/17/bin";
const PG_LIB = process.env.FRC_PG_LIB || "";
const TEST_ROOT = process.env.FRC_TEST_PG_ROOT || path.join(os.homedir(), ".frc-pg-test");
const PG_DATA = path.join(TEST_ROOT, "pg17-data");
const PG_SOCK = path.join(TEST_ROOT, "sock");
const PG_LOG = path.join(TEST_ROOT, "pg17.log");

const REPO = path.resolve(import.meta.dirname, "..", "..");

export function localUrl(db: string): string {
  return `postgres://${PG_USER}@localhost:${PG_PORT}/${db}`;
}

/** Refuse to run anywhere near a real service, and force UTC. */
export function assertSafeEnv(): void {
  const upstash = Object.keys(process.env).filter((k) => k.startsWith("UPSTASH"));
  if (upstash.length > 0) {
    throw new Error("pg harness refused because an UPSTASH variable is set");
  }
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url !== "") {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      throw new Error("pg harness refused because DATABASE_URL does not parse");
    }
    if (host !== "localhost") {
      throw new Error("pg harness refused because DATABASE_URL is not localhost");
    }
  }
  process.env.TZ = "UTC";
}

function pgCtl(args: string[]): string {
  return execFileSync(path.join(PG_ROOT, "pg_ctl"), args, {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LD_LIBRARY_PATH: PG_LIB,
      TZ: "UTC",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function serverRunning(): boolean {
  try {
    pgCtl(["-D", PG_DATA, "status"]);
    return true;
  } catch {
    return false;
  }
}

/** Starts the server when it is down. Returns true when this call started it. */
export function startServer(): boolean {
  if (serverRunning()) return false;
  pgCtl([
    "-D", PG_DATA,
    "-l", PG_LOG,
    "-w",
    "-t", "60",
    "-o", `-p ${PG_PORT} -k ${PG_SOCK} -c listen_addresses=localhost`,
    "start",
  ]);
  return true;
}

export function stopServer(): void {
  if (serverRunning()) pgCtl(["-D", PG_DATA, "-w", "-m", "fast", "stop"]);
}

function readSql(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

export function migration0000(): string {
  return readSql("migrations/0000_salty_flatman.sql").replaceAll("--> statement-breakpoint", "");
}

export function migration0001(): string {
  return readSql("migrations/0001_release_one.sql");
}

export function prodOnlyIndexes(): { name: string; definition: string }[] {
  return JSON.parse(readSql("tests/fixtures/prod-only-indexes.json"));
}

export interface TestDb {
  name: string;
  url: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: localUrl("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Fresh database with 0000, the production only indexes, then 0001. */
export async function createTestDb(): Promise<TestDb> {
  assertSafeEnv();
  const name = `frc_t_${Date.now()}_${randomBytes(3).toString("hex")}`;
  await admin((c) => c.query(`CREATE DATABASE "${name}"`));
  const url = localUrl(name);
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  try {
    await setup.query(migration0000());
    for (const idx of prodOnlyIndexes()) {
      await setup.query(idx.definition);
    }
    await setup.query(migration0001());
  } finally {
    await setup.end();
  }
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  return {
    name,
    url,
    pool,
    drop: async () => {
      await pool.end();
      await admin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
