/**
 * SQLite Database Initialization
 *
 * - Creates the data directory if it doesn't exist
 * - Opens (or creates) the SQLite database file
 * - Runs table migrations via CREATE TABLE IF NOT EXISTS
 * - Enables WAL mode for better concurrent read performance
 * - Enables foreign keys
 *
 * Database location: ./data/app.db (portable — travels with the project folder)
 */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";

// ─── Database File Path ─────────────────────────────────────────────────────
// Database lives inside the project at ./data/app.db so it's portable —
// zip the whole folder and the data goes with it.

function getProjectRoot(): string {
  // Bundled production runs from dist/. Development runs from the project root.
  return typeof __dirname === "string" ? path.resolve(__dirname, "..") : process.cwd();
}

function getDbPath(): string {
  const configuredPath = process.env.DB_PATH || process.env.DATABASE_PATH;
  return configuredPath
    ? path.resolve(configuredPath)
    : path.join(getProjectRoot(), "data", "app.db");
}

export const DB_PATH = getDbPath();
export const DB_DIR = path.dirname(DB_PATH);

// ─── Table DDL ──────────────────────────────────────────────────────────────

const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    username          TEXT NOT NULL UNIQUE,
    password          TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'volunteer',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_items (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    brand                 TEXT,
    category              TEXT NOT NULL DEFAULT 'Uncategorized',
    barcode               TEXT UNIQUE,
    quantity              INTEGER NOT NULL DEFAULT 0,

    package_type          TEXT DEFAULT 'single',
    unit_count            INTEGER DEFAULT 1,

    weight_per_unit_lbs   TEXT NOT NULL DEFAULT '0',
    net_weight_g          REAL,
    unit_weight_g         REAL,
    weight_is_estimated   INTEGER NOT NULL DEFAULT 0,

    value_per_unit_usd    TEXT NOT NULL DEFAULT '0',
    cost_cents            INTEGER,
    cost_is_estimated     INTEGER NOT NULL DEFAULT 0,
    currency              TEXT DEFAULT 'USD',

    reorder_threshold     INTEGER,
    allergens             TEXT NOT NULL DEFAULT '[]',
    expiration_date       TEXT,

    data_sources_tried    TEXT,
    winning_source        TEXT,
    match_confidence      REAL,
    raw_payload           TEXT,

    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    identifier        TEXT NOT NULL UNIQUE,
    contact           TEXT,
    allergies         TEXT NOT NULL DEFAULT '[]',
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                TEXT PRIMARY KEY,
    type              TEXT NOT NULL,
    timestamp         TEXT NOT NULL,
    source            TEXT,
    donor             TEXT,
    client_id         TEXT,
    client_name       TEXT,
    latitude          REAL,
    longitude         REAL,
    accuracy          REAL,
    created_at        TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS transaction_items (
    id                    TEXT PRIMARY KEY,
    transaction_id        TEXT NOT NULL,
    inventory_item_id     TEXT NOT NULL,
    name                  TEXT NOT NULL,
    quantity              INTEGER NOT NULL,
    weight_per_unit_lbs   TEXT NOT NULL,
    value_per_unit_usd    TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
  );

  CREATE TABLE IF NOT EXISTS pack_components (
    id                  TEXT PRIMARY KEY,
    parent_item_id      TEXT NOT NULL,
    component_name      TEXT NOT NULL,
    component_barcode   TEXT,
    quantity            INTEGER NOT NULL DEFAULT 1,
    weight_g            REAL,
    FOREIGN KEY (parent_item_id) REFERENCES inventory_items(id)
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id                  TEXT PRIMARY KEY,
    inventory_item_id   TEXT NOT NULL,
    cost_cents          INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    source              TEXT,
    recorded_at         TEXT NOT NULL,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
  );

  CREATE TABLE IF NOT EXISTS weight_history (
    id                  TEXT PRIMARY KEY,
    inventory_item_id   TEXT NOT NULL,
    net_weight_g        REAL NOT NULL,
    source              TEXT,
    is_estimated        INTEGER NOT NULL DEFAULT 0,
    recorded_at         TEXT NOT NULL,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
  );

  -- ─── PantrySoft-inspired: Household Members ──────────────────────────────
  CREATE TABLE IF NOT EXISTS household_members (
    id                  TEXT PRIMARY KEY,
    client_id           TEXT NOT NULL,
    name                TEXT NOT NULL,
    relationship        TEXT,
    date_of_birth       TEXT,
    allergies           TEXT NOT NULL DEFAULT '[]',
    notes               TEXT,
    created_at          TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  -- ─── PantrySoft-inspired: Item Groups (pre-built distribution bundles) ───
  CREATE TABLE IF NOT EXISTS item_groups (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_group_items (
    id                  TEXT PRIMARY KEY,
    group_id            TEXT NOT NULL,
    inventory_item_id   TEXT NOT NULL,
    quantity            INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (group_id) REFERENCES item_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
  );

  -- ─── PantrySoft-inspired: Organization Settings ──────────────────────────
  CREATE TABLE IF NOT EXISTS settings (
    key                 TEXT PRIMARY KEY,
    value               TEXT NOT NULL
  );

  -- ─── Request Management System ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS requests (
    id                  TEXT PRIMARY KEY,
    client_id           TEXT,
    client_name         TEXT NOT NULL,
    client_identifier   TEXT NOT NULL,
    client_email        TEXT,
    client_phone        TEXT,
    reason              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    admin_note          TEXT,
    reviewed_by         TEXT,
    reviewed_at         TEXT,
    pickup_deadline     TEXT,
    fulfilled_at        TEXT,
    cancelled_at        TEXT,
    transaction_id      TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
  );

  CREATE TABLE IF NOT EXISTS request_items (
    id                    TEXT PRIMARY KEY,
    request_id            TEXT NOT NULL,
    inventory_item_id     TEXT NOT NULL,
    item_name             TEXT NOT NULL,
    item_category         TEXT,
    requested_quantity    INTEGER NOT NULL,
    approved_quantity     INTEGER,
    fulfilled_quantity    INTEGER,
    reserved              INTEGER NOT NULL DEFAULT 0,
    denial_reason         TEXT,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
  );

  CREATE TABLE IF NOT EXISTS request_audit_log (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL,
    action          TEXT NOT NULL,
    actor           TEXT,
    details         TEXT,
    previous_status TEXT,
    new_status      TEXT,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    request_id      TEXT,
    recipient_type  TEXT NOT NULL,
    recipient_id    TEXT NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    read            INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
  );

  -- ─── Donor Management ──────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS donors (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    organization    TEXT,
    contact_name    TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
`;

// ─── Client column migrations (add PantrySoft CRM fields) ───────────────

const CLIENT_MIGRATIONS = [
  "ALTER TABLE clients ADD COLUMN phone TEXT",
  "ALTER TABLE clients ADD COLUMN email TEXT",
  "ALTER TABLE clients ADD COLUMN address TEXT",
  "ALTER TABLE clients ADD COLUMN date_of_birth TEXT",
  "ALTER TABLE clients ADD COLUMN household_size INTEGER DEFAULT 1",
  "ALTER TABLE clients ADD COLUMN eligible_date TEXT",
  "ALTER TABLE clients ADD COLUMN certification_date TEXT",
  "ALTER TABLE clients ADD COLUMN status TEXT DEFAULT 'active'",
  // Partners Hub: distinguish student clients from partner organizations
  "ALTER TABLE clients ADD COLUMN client_type TEXT NOT NULL DEFAULT 'student'",
  "ALTER TABLE clients ADD COLUMN organization TEXT",
  "ALTER TABLE clients ADD COLUMN partnership_type TEXT",
];

// ─── Transaction column migrations (Emergency Shop Appointment flag) ────

const TRANSACTION_MIGRATIONS = [
  "ALTER TABLE transactions ADD COLUMN is_emergency INTEGER NOT NULL DEFAULT 0",
];

// ─── Request column migrations (student-submitted note) ─────────────────

const REQUEST_TABLE_MIGRATIONS = [
  "ALTER TABLE requests ADD COLUMN student_note TEXT",
];

// ─── Initialize ─────────────────────────────────────────────────────────────

export function initDatabase(): Database.Database {
  // 1. Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`[sqlite] Created data directory: ${DB_DIR}`);
  }

  // 2. Open (or create) the database file
  const db = new Database(DB_PATH);
  console.log(`[sqlite] Database opened: ${DB_PATH}`);

  // 3. Performance & safety pragmas
  db.pragma("journal_mode = WAL"); // Write-Ahead Logging for concurrency
  db.pragma("foreign_keys = ON"); // Enforce FK constraints
  db.pragma("busy_timeout = 5000"); // Wait up to 5s if locked

  // 4. Run migrations
  db.exec(MIGRATIONS);
  console.log(`[sqlite] Migrations complete (16 tables)`);

  // 5. Run ALTER TABLE migrations (safe: ignores "duplicate column" errors)
  for (const sql of CLIENT_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      // "duplicate column name" means column already exists — safe to ignore
      if (!err.message?.includes("duplicate column")) {
        console.warn(`[sqlite] Migration warning: ${err.message}`);
      }
    }
  }
  console.log(`[sqlite] Client column migrations complete`);

  // 6. Run request system ALTER TABLE migrations
  const REQUEST_MIGRATIONS = [
    "ALTER TABLE inventory_items ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0",
  ];

  for (const sql of REQUEST_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      if (!err.message?.includes("duplicate column")) {
        console.warn(`[sqlite] Migration warning: ${err.message}`);
      }
    }
  }
  console.log(`[sqlite] Request system migrations complete`);

  // 6b. Transaction ALTER TABLE migrations (Emergency flag)
  for (const sql of TRANSACTION_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      if (!err.message?.includes("duplicate column")) {
        console.warn(`[sqlite] Migration warning: ${err.message}`);
      }
    }
  }
  console.log(`[sqlite] Transaction migrations complete`);

  // 6c. Request column ALTER TABLE migrations (student note)
  for (const sql of REQUEST_TABLE_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      if (!err.message?.includes("duplicate column")) {
        console.warn(`[sqlite] Migration warning: ${err.message}`);
      }
    }
  }
  console.log(`[sqlite] Request column migrations complete`);

  // 7. Donor system migrations
  const DONOR_MIGRATIONS = [
    "ALTER TABLE transactions ADD COLUMN donor_id TEXT",
  ];
  for (const sql of DONOR_MIGRATIONS) {
    try { db.exec(sql); } catch (err: any) {
      if (!err.message?.includes("duplicate column")) console.warn(`[sqlite] Migration warning: ${err.message}`);
    }
  }

  // 8. Auto-create donor profiles from existing transaction donor names
  try {
    const uniqueDonors = db.prepare(`
      SELECT DISTINCT donor FROM transactions WHERE donor IS NOT NULL AND donor != '' AND donor_id IS NULL
    `).all() as any[];
    for (const row of uniqueDonors) {
      const existing = db.prepare("SELECT id FROM donors WHERE name = ?").get(row.donor) as any;
      if (!existing) {
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare("INSERT INTO donors (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)").run(id, row.donor, now, now);
        db.prepare("UPDATE transactions SET donor_id = ? WHERE donor = ? AND donor_id IS NULL").run(id, row.donor);
      } else {
        db.prepare("UPDATE transactions SET donor_id = ? WHERE donor = ? AND donor_id IS NULL").run(existing.id, row.donor);
      }
    }
  } catch {}
  console.log(`[sqlite] Donor system migrations complete`);

  // 9. Performance indexes — speed up frequent queries (idempotent)
  const INDEXES = [
    // Requests: filtered by status, identifier, and created_at on every admin list view
    "CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)",
    "CREATE INDEX IF NOT EXISTS idx_requests_client_identifier ON requests(client_identifier)",
    "CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_requests_pickup_deadline ON requests(pickup_deadline)",
    // Request items: joined on request_id and inventory_item_id
    "CREATE INDEX IF NOT EXISTS idx_request_items_request_id ON request_items(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_request_items_inventory_item_id ON request_items(inventory_item_id)",
    // Transactions: filtered by type, client, donor, timestamp (dashboard, reports)
    "CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_donor_id ON transactions(donor_id)",
    "CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)",
    // Transaction items: joined on transaction_id and inventory_item_id
    "CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id)",
    "CREATE INDEX IF NOT EXISTS idx_transaction_items_inventory_item_id ON transaction_items(inventory_item_id)",
    // Inventory: category filter is common in UI
    "CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category)",
    // Clients: split surface between students and partners
    "CREATE INDEX IF NOT EXISTS idx_clients_client_type ON clients(client_type)",
    // Emergency Shop Appointments: filtered/grouped on every emergency report
    "CREATE INDEX IF NOT EXISTS idx_transactions_is_emergency ON transactions(is_emergency)",
    // Audit log: always joined on request_id
    "CREATE INDEX IF NOT EXISTS idx_request_audit_log_request_id ON request_audit_log(request_id)",
    // Notifications: queried by recipient
    "CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_request_id ON notifications(request_id)",
  ];
  for (const sql of INDEXES) {
    try {
      db.exec(sql);
    } catch (err: any) {
      console.warn(`[sqlite] Index warning: ${err.message}`);
    }
  }
  console.log(`[sqlite] Performance indexes created (${INDEXES.length})`);

  return db;
}
