// Local stack only. Creates the frc_stack database on the local cluster,
// applies the schema, and seeds synthetic data. Refuses any non localhost URL.
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

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

async function seed(c) {
  await c.query("BEGIN");
  const students = [
    ["Test Student One", "T0000001", "410-555-0101", "student.one@example.invalid", 1],
    ["Test Student Two", "T0000002", "410-555-0102", "student.two@example.invalid", 2],
    ["Test Student Three", "T0000003", "410-555-0103", null, 1],
    ["Test Student Four", "T0000004", null, "student.four@example.invalid", 3],
  ];
  for (const [name, identifier, phone, email, household] of students) {
    await c.query(
      "INSERT INTO clients (name, identifier, phone, email, household_size, client_type) VALUES ($1, $2, $3, $4, $5, 'student')",
      [name, identifier, phone, email, household],
    );
  }
  const partners = [];
  for (const [name, identifier, org] of [
    ["Test Partner Pantry", "PARTNER-TEST-1", "Test Community Pantry"],
    ["Test Partner Garden", "PARTNER-TEST-2", "Test Campus Garden"],
  ]) {
    const r = await c.query(
      `INSERT INTO clients (name, identifier, contact, phone, organization, partnership_type, client_type)
       VALUES ($1, $2, 'Test Contact', '410-555-0150', $3, 'Community Organization', 'partner') RETURNING id, name`,
      [name, identifier, org],
    );
    partners.push(r.rows[0]);
  }
  const donors = [];
  for (const [name, org] of [
    ["Test Donor Grocery", "Test Grocery Co"],
    ["Test Donor Church", "Test Fellowship Church"],
    ["Test Donor Alumni", null],
  ]) {
    const r = await c.query(
      "INSERT INTO donors (name, organization, phone) VALUES ($1, $2, '410-555-0170') RETURNING id, name",
      [name, org],
    );
    donors.push(r.rows[0]);
  }
  const items = [];
  const stock = [
    ["Test Canned Corn", "Canned Goods", 40, 10],
    ["Test Canned Green Beans", "Canned Goods", 6, 10],
    ["Test Peanut Butter 16 oz", "Protein", 18, 5],
    ["Test Pasta 1 lb", "Grains", 25, 8],
    ["Test White Rice 2 lb", "Grains", 3, 6],
    ["Test Oatmeal Canister", "Breakfast", 12, null],
    ["Test Cereal Box", "Breakfast", 9, 4],
    ["Test Tuna Can", "Protein", 30, 12],
    ["Test Apple Sauce Cups", "Snacks", 0, 5],
    ["Test Crackers Box", "Snacks", 14, null],
    ["Test Shampoo Bottle", "Personal Care", 7, 3],
    ["Test Toothpaste Tube", "Personal Care", 11, null],
  ];
  for (let i = 0; i < stock.length; i += 1) {
    const [name, category, quantity, threshold] = stock[i];
    const barcode = `20000002${String(i + 1).padStart(4, "0")}9`;
    const r = await c.query(
      `INSERT INTO inventory_items (name, brand, category, barcode, quantity, reorder_threshold, weight_per_unit_lbs, value_per_unit_usd)
       VALUES ($1, 'Test Brand', $2, $3, $4, $5, 1.0000, 2.50) RETURNING id, name`,
      [name, category, barcode, quantity, threshold],
    );
    items.push(r.rows[0]);
  }
  // Two check ins. A donor gift carries donor_id, a partner gift carries client_id.
  const checkIns = [
    { donorId: donors[0].id, donor: donors[0].name, clientId: null, clientName: null, lines: [[0, 12], [3, 6]] },
    { donorId: null, donor: partners[0].name, clientId: partners[0].id, clientName: partners[0].name, lines: [[7, 10]] },
  ];
  for (const ci of checkIns) {
    const t = await c.query(
      `INSERT INTO transactions (type, source, donor, donor_id, client_id, client_name)
       VALUES ('IN', 'Local stack seed', $1, $2, $3, $4) RETURNING id`,
      [ci.donor, ci.donorId, ci.clientId, ci.clientName],
    );
    for (const [idx, qty] of ci.lines) {
      await c.query(
        `INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
         VALUES ($1, $2, $3, $4, 1.0000, 2.50)`,
        [t.rows[0].id, items[idx].id, items[idx].name, qty],
      );
    }
  }
  await c.query("COMMIT");
  console.log(`seeded ${students.length} students, ${partners.length} partners, ${donors.length} donors, ${items.length} items, ${checkIns.length} check ins`);
}
