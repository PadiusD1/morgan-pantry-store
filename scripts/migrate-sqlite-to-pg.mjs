/**
 * One-shot data migration: data/app.db (SQLite) -> Supabase Postgres.
 *
 * Transforms per the storage audit:
 *  - booleans INTEGER 0/1        -> boolean
 *  - allergens JSON TEXT         -> text[]
 *  - jsonb JSON TEXT             -> jsonb objects
 *  - ISO TEXT timestamps         -> timestamptz
 *  - '' uuids                    -> NULL
 *  - enum values validated       -> defaults / skipped with a warning
 *
 * Also seeds the first admin user from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Idempotent: every insert is ON CONFLICT DO NOTHING.
 *
 * Usage: node scripts/migrate-sqlite-to-pg.mjs
 */

import "dotenv/config";
import Database from "better-sqlite3";
import pg from "pg";
import bcrypt from "bcryptjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlite = new Database(path.join(root, "data", "app.db"), { readonly: true });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const warnings = [];

const asBool = (v) => v === 1 || v === true || v === "1";
const asUuid = (v) => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const asTs = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const asTsRequired = (v) => asTs(v) ?? new Date().toISOString();
const asDate = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const asNumeric = (v, fallback = "0") => {
  if (v === null || v === undefined || v === "") return fallback;
  return Number.isFinite(parseFloat(v)) ? String(v) : fallback;
};
const asJsonArray = (v) => {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};
const asJson = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return JSON.stringify(v);
  try {
    JSON.parse(v);
    return v; // already valid JSON text
  } catch {
    return null;
  }
};
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

async function insertRows(table, columns, rows, castOverrides = {}) {
  if (rows.length === 0) {
    console.log(`${table}: 0 rows`);
    return;
  }
  let inserted = 0;
  for (const row of rows) {
    const placeholders = columns.map((c, i) => {
      const cast = castOverrides[c] ? `::${castOverrides[c]}` : "";
      return `$${i + 1}${cast}`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`;
    try {
      const r = await pool.query(sql, columns.map((c) => row[c]));
      inserted += r.rowCount ?? 0;
    } catch (err) {
      warnings.push(`${table} row skipped (${row.id ?? row.key ?? "?"}): ${err.message}`);
    }
  }
  console.log(`${table}: ${inserted}/${rows.length} rows`);
}

const all = (sql) => {
  try {
    return sqlite.prepare(sql).all();
  } catch (err) {
    warnings.push(`sqlite read failed: ${sql} :: ${err.message}`);
    return [];
  }
};

// ─── Extract + transform ─────────────────────────────────────────────────────

const donors = all("SELECT * FROM donors").map((r) => ({
  id: asUuid(r.id),
  name: r.name,
  organization: r.organization ?? null,
  contact_name: r.contact_name ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  address: r.address ?? null,
  notes: r.notes ?? null,
  status: r.status || "active",
  created_at: asTsRequired(r.created_at),
  updated_at: asTsRequired(r.updated_at),
}));

const inventoryItems = all("SELECT * FROM inventory_items").map((r) => ({
  id: asUuid(r.id),
  name: r.name,
  brand: r.brand ?? null,
  category: r.category || "Uncategorized",
  barcode: r.barcode || null,
  quantity: r.quantity ?? 0,
  package_type: oneOf(r.package_type, ["single", "multi_pack", "variety_pack", "case"], "single"),
  unit_count: r.unit_count ?? 1,
  weight_per_unit_lbs: asNumeric(r.weight_per_unit_lbs),
  net_weight_g: r.net_weight_g ?? null,
  unit_weight_g: r.unit_weight_g ?? null,
  weight_is_estimated: asBool(r.weight_is_estimated),
  value_per_unit_usd: asNumeric(r.value_per_unit_usd),
  cost_cents: r.cost_cents ?? null,
  cost_is_estimated: asBool(r.cost_is_estimated),
  currency: r.currency || "USD",
  reserved_quantity: r.reserved_quantity ?? 0,
  reorder_threshold: r.reorder_threshold ?? null,
  allergens: asJsonArray(r.allergens),
  expiration_date: asDate(r.expiration_date),
  data_sources_tried: asJson(r.data_sources_tried),
  winning_source: r.winning_source ?? null,
  match_confidence: r.match_confidence ?? null,
  raw_payload: asJson(r.raw_payload),
  created_at: asTsRequired(r.created_at),
  updated_at: asTsRequired(r.updated_at),
}));

const clients = all("SELECT * FROM clients").map((r) => ({
  id: asUuid(r.id),
  name: r.name,
  identifier: r.identifier,
  contact: r.contact ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  address: r.address ?? null,
  date_of_birth: asDate(r.date_of_birth),
  household_size: r.household_size ?? 1,
  eligible_date: asDate(r.eligible_date),
  certification_date: asDate(r.certification_date),
  status: r.status || "active",
  client_type: oneOf(r.client_type, ["student", "partner"], "student"),
  organization: r.organization ?? null,
  partnership_type: r.partnership_type ?? null,
  allergies: asJsonArray(r.allergies),
  notes: r.notes ?? null,
  created_at: asTsRequired(r.created_at),
  updated_at: asTsRequired(r.updated_at),
}));

const householdMembers = all("SELECT * FROM household_members").map((r) => ({
  id: asUuid(r.id),
  client_id: asUuid(r.client_id),
  name: r.name,
  relationship: r.relationship ?? null,
  date_of_birth: asDate(r.date_of_birth),
  allergies: asJsonArray(r.allergies),
  notes: r.notes ?? null,
  created_at: asTsRequired(r.created_at),
}));

const itemGroups = all("SELECT * FROM item_groups").map((r) => ({
  id: asUuid(r.id),
  name: r.name,
  description: r.description ?? null,
  is_active: asBool(r.is_active),
  created_at: asTsRequired(r.created_at),
  updated_at: asTsRequired(r.updated_at),
}));

const itemGroupItems = all("SELECT * FROM item_group_items").map((r) => ({
  id: asUuid(r.id),
  group_id: asUuid(r.group_id),
  inventory_item_id: asUuid(r.inventory_item_id),
  quantity: r.quantity ?? 1,
}));

const transactions = all("SELECT * FROM transactions")
  .filter((r) => {
    if (r.type === "IN" || r.type === "OUT") return true;
    warnings.push(`transactions ${r.id}: invalid type '${r.type}' — skipped (with its items)`);
    return false;
  })
  .map((r) => ({
    id: asUuid(r.id),
    type: r.type,
    timestamp: asTsRequired(r.timestamp),
    source: r.source ?? null,
    donor: r.donor ?? null,
    client_id: asUuid(r.client_id),
    client_name: r.client_name ?? null,
    donor_id: asUuid(r.donor_id),
    is_emergency: asBool(r.is_emergency),
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    accuracy: r.accuracy ?? null,
    created_at: asTsRequired(r.created_at),
  }));
const validTxIds = new Set(transactions.map((t) => t.id));

const transactionItems = all("SELECT * FROM transaction_items")
  .filter((r) => validTxIds.has(r.transaction_id))
  .map((r) => ({
    id: asUuid(r.id),
    transaction_id: asUuid(r.transaction_id),
    inventory_item_id: asUuid(r.inventory_item_id),
    name: r.name,
    quantity: r.quantity ?? 0,
    weight_per_unit_lbs: asNumeric(r.weight_per_unit_lbs),
    value_per_unit_usd: asNumeric(r.value_per_unit_usd),
  }));

const packComponents = all("SELECT * FROM pack_components").map((r) => ({
  id: asUuid(r.id),
  parent_item_id: asUuid(r.parent_item_id),
  component_name: r.component_name,
  component_barcode: r.component_barcode ?? null,
  quantity: r.quantity ?? 1,
  weight_g: r.weight_g ?? null,
}));

const priceHistory = all("SELECT * FROM price_history").map((r) => ({
  id: asUuid(r.id),
  inventory_item_id: asUuid(r.inventory_item_id),
  cost_cents: r.cost_cents ?? 0,
  currency: r.currency || "USD",
  source: r.source ?? null,
  recorded_at: asTsRequired(r.recorded_at),
}));

const weightHistory = all("SELECT * FROM weight_history").map((r) => ({
  id: asUuid(r.id),
  inventory_item_id: asUuid(r.inventory_item_id),
  net_weight_g: r.net_weight_g ?? 0,
  source: r.source ?? null,
  is_estimated: asBool(r.is_estimated),
  recorded_at: asTsRequired(r.recorded_at),
}));

const requests = all("SELECT * FROM requests").map((r) => ({
  id: asUuid(r.id),
  client_id: asUuid(r.client_id),
  user_id: null,
  client_name: r.client_name,
  client_identifier: r.client_identifier,
  client_email: r.client_email ?? null,
  client_phone: r.client_phone ?? null,
  reason: r.reason,
  student_note: r.student_note ?? null,
  status: r.status || "pending",
  admin_note: r.admin_note ?? null,
  reviewed_by: r.reviewed_by ?? null,
  reviewed_at: asTs(r.reviewed_at),
  pickup_deadline: r.pickup_deadline ?? null,
  fulfilled_at: asTs(r.fulfilled_at),
  cancelled_at: asTs(r.cancelled_at),
  transaction_id: asUuid(r.transaction_id),
  created_at: asTsRequired(r.created_at),
  updated_at: asTsRequired(r.updated_at),
}));

const requestItems = all("SELECT * FROM request_items").map((r) => ({
  id: asUuid(r.id),
  request_id: asUuid(r.request_id),
  inventory_item_id: asUuid(r.inventory_item_id),
  item_name: r.item_name,
  item_category: r.item_category ?? null,
  requested_quantity: r.requested_quantity ?? 0,
  approved_quantity: r.approved_quantity ?? null,
  fulfilled_quantity: r.fulfilled_quantity ?? null,
  reserved: asBool(r.reserved),
  denial_reason: r.denial_reason ?? null,
}));

const requestAuditLog = all("SELECT * FROM request_audit_log").map((r) => ({
  id: asUuid(r.id),
  request_id: asUuid(r.request_id),
  action: r.action,
  actor: r.actor ?? null,
  details: r.details ?? null,
  previous_status: r.previous_status ?? null,
  new_status: r.new_status ?? null,
  created_at: asTsRequired(r.created_at),
}));

const notifications = all("SELECT * FROM notifications").map((r) => ({
  id: asUuid(r.id),
  request_id: asUuid(r.request_id),
  recipient_type: r.recipient_type,
  recipient_id: r.recipient_id,
  type: r.type,
  title: r.title,
  message: r.message,
  read: asBool(r.read),
  created_at: asTsRequired(r.created_at),
}));

const settings = all("SELECT * FROM settings").map((r) => ({
  key: r.key,
  value: String(r.value ?? ""),
}));

// ─── Load (FK order) ─────────────────────────────────────────────────────────

const jsonbCast = { data_sources_tried: "jsonb", raw_payload: "jsonb" };

(async () => {
  await insertRows("donors", Object.keys(donors[0] ?? { id: 1 }), donors);
  await insertRows("inventory_items", Object.keys(inventoryItems[0] ?? { id: 1 }), inventoryItems, jsonbCast);
  await insertRows("clients", Object.keys(clients[0] ?? { id: 1 }), clients);
  await insertRows("household_members", Object.keys(householdMembers[0] ?? { id: 1 }), householdMembers);
  await insertRows("item_groups", Object.keys(itemGroups[0] ?? { id: 1 }), itemGroups);
  await insertRows("item_group_items", Object.keys(itemGroupItems[0] ?? { id: 1 }), itemGroupItems);
  await insertRows("transactions", Object.keys(transactions[0] ?? { id: 1 }), transactions);
  await insertRows("transaction_items", Object.keys(transactionItems[0] ?? { id: 1 }), transactionItems);
  await insertRows("pack_components", Object.keys(packComponents[0] ?? { id: 1 }), packComponents);
  await insertRows("price_history", Object.keys(priceHistory[0] ?? { id: 1 }), priceHistory);
  await insertRows("weight_history", Object.keys(weightHistory[0] ?? { id: 1 }), weightHistory);
  await insertRows("requests", Object.keys(requests[0] ?? { id: 1 }), requests);
  await insertRows("request_items", Object.keys(requestItems[0] ?? { id: 1 }), requestItems);
  await insertRows("request_audit_log", Object.keys(requestAuditLog[0] ?? { id: 1 }), requestAuditLog);
  await insertRows("notifications", Object.keys(notifications[0] ?? { id: 1 }), notifications);
  await insertRows("settings", ["key", "value"], settings);

  // Seed the first admin
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const hash = await bcrypt.hash(adminPassword, 10);
    const r = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO NOTHING`,
      [adminEmail, hash, process.env.ADMIN_NAME || "FRC Administrator"],
    );
    console.log(`admin seed: ${r.rowCount ? "created" : "already exists"} (${adminEmail})`);
  }

  if (warnings.length) {
    console.log(`\n${warnings.length} warnings:`);
    for (const w of warnings.slice(0, 30)) console.log("  -", w);
  }

  const counts = await pool.query(`
    SELECT relname AS table, n_live_tup AS rows
    FROM pg_stat_user_tables ORDER BY relname`);
  console.log("\nfinal row counts:");
  for (const row of counts.rows) console.log(`  ${row.table}: ${row.rows}`);

  await pool.end();
  sqlite.close();
})();
