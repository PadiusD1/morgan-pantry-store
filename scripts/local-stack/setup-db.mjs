// Local stack only. Creates the frc_stack database on the local cluster,
// applies the schema, and seeds synthetic data. Refuses any non localhost URL.
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
import { seed } from "./seed.mjs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const { DATABASE_URL, STACK_MIGRATION_0001, STACK_INDEXES, ADMIN_EMAIL, ADMIN_PASSWORD, VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD } = process.env;

function refuse(msg) {
  console.error(`setup refused because ${msg}`);
  process.exit(2);
}
if (Object.keys(process.env).some((k) => k.startsWith("UPSTASH") || k.startsWith("KV_REST_API"))) refuse("an UPSTASH or KV_REST_API variable is set");
const url = new URL(DATABASE_URL ?? "");
if (url.hostname !== "localhost") refuse("DATABASE_URL is not localhost");
const dbName = url.pathname.slice(1);
if (!/^[a-z_]+$/.test(dbName)) refuse("the database name is unexpected");

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const exists = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName])).rowCount > 0;
if (!exists) await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const db = new pg.Client({ connectionString: url.toString() });
await db.connect();

if (!exists) {
  const m0 = fs.readFileSync(path.join(REPO, "migrations", "0000_salty_flatman.sql"), "utf8");
  await db.query(m0.replaceAll("--> statement-breakpoint", ""));
  const listed = JSON.parse(fs.readFileSync(STACK_INDEXES, "utf8"));
  // Accept the prod-objects.json shape or the name and definition list.
  const indexes = listed
    .filter((o) => o.definition || o.k === "idx")
    .map((o) => ({ name: o.name ?? o.n, definition: o.definition ?? o.d }));
  const present = new Set((await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map((r) => r.indexname));
  let added = 0;
  for (const idx of indexes) {
    if (present.has(idx.name)) continue;
    await db.query(idx.definition);
    added += 1;
  }
  await db.query(fs.readFileSync(STACK_MIGRATION_0001, "utf8"));
  console.log(`schema applied, 0000 then ${added} production only indexes then 0001`);
  await seed(db);
}

// Fresh throwaway passwords on every start, printed once by start.sh.
for (const [email, password, name, role] of [
  [ADMIN_EMAIL, ADMIN_PASSWORD, "Local Admin", "admin"],
  [VOLUNTEER_EMAIL, VOLUNTEER_PASSWORD, "Local Volunteer", "volunteer"],
]) {
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, updated_at = now()`,
    [email, hash, name, role],
  );
}
await db.end();
