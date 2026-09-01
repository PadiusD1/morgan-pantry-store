/**
 * End-to-end audit of a deployed Food Resource Center instance.
 *
 * Drives a real deployment over HTTP the way staff and students do, then
 * removes every row it created and proves the database is byte-for-byte back
 * to the counts it started with.
 *
 * SAFETY CONTRACT — read before changing anything in here.
 *
 *  1. Nothing about a deployment is hardcoded. The target URL, the database
 *     and the admin credentials all come from the environment, so this file
 *     names no host, no project and no secret.
 *  2. It refuses to run without an explicit opt-in (--yes or FRC_AUDIT_CONFIRM=1),
 *     because it writes to whatever DATABASE_URL points at.
 *  3. Before it creates anything beyond a single probe item, it proves that
 *     FRC_AUDIT_URL and DATABASE_URL are the SAME system by reading that item
 *     back out of the database by id. If they disagree it aborts AND skips
 *     teardown, so this file can never delete from a database it did not write
 *     to. It prints the one row it made so a person can remove it.
 *  4. Teardown deletes ONLY ids this run recorded. There is no unscoped DELETE
 *     and no blanket UPDATE anywhere in this file. If a future edit needs one,
 *     it is a bug.
 *  5. It never deletes a transaction it did not create. The probe item is
 *     visible in the staff picker while the audit runs, so a real check-out
 *     could include it; that transaction holds real line items for real food.
 *     If one is found referencing the probe item, teardown rolls back and says
 *     so rather than erasing distribution history.
 *  6. The final baseline comparison is a report, never a repair. If rows are
 *     left over the audit FAILS and says which table drifted. It must never
 *     "clean up" by widening a delete.
 *
 * Usage:
 *   DATABASE_URL=...  FRC_AUDIT_URL=https://your-deployment  \
 *   ADMIN_EMAIL=...   ADMIN_PASSWORD=...                     \
 *   node scripts/frc-audit.mjs --yes
 *
 * Exits non-zero if any check fails or if any audit row survives teardown.
 */

import "dotenv/config";
import pg from "pg";

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE = (process.env.FRC_AUDIT_URL ?? "").replace(/\/+$/, "");
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ADMIN_EMAIL = process.env.FRC_AUDIT_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD =
  process.env.FRC_AUDIT_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "";

const confirmed =
  process.argv.includes("--yes") || process.env.FRC_AUDIT_CONFIRM === "1";

const missing = [
  ["FRC_AUDIT_URL", BASE],
  ["DATABASE_URL", DATABASE_URL],
  ["ADMIN_EMAIL (or FRC_AUDIT_ADMIN_EMAIL)", ADMIN_EMAIL],
  ["ADMIN_PASSWORD (or FRC_AUDIT_ADMIN_PASSWORD)", ADMIN_PASSWORD],
].filter(([, v]) => !v);

if (missing.length) {
  console.error("Missing required configuration:");
  for (const [name] of missing) console.error(`  - ${name}`);
  console.error("\nSee the usage block at the top of this file.");
  process.exit(2);
}

if (!confirmed) {
  console.error(
    [
      "Refusing to run without an explicit opt-in.",
      "",
      "This audit signs up a student, creates an inventory item, moves stock and",
      "files a request against the deployment at:",
      `  ${BASE}`,
      "and against the database in DATABASE_URL. It removes everything it creates,",
      "but it is still a write against a live system.",
      "",
      "Re-run with --yes (or set FRC_AUDIT_CONFIRM=1) if that is what you want.",
    ].join("\n"),
  );
  process.exit(2);
}

// Mirrors server/pg.ts: the Supavisor pooler presents a self-signed
// certificate, so we encrypt in transit but do not verify by default. Set
// PGSSL_REJECT_UNAUTHORIZED=true (with PGSSL_CA) to harden. localhost is exempt.
const ssl = DATABASE_URL.includes("localhost")
  ? undefined
  : {
      rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true",
      ...(process.env.PGSSL_CA ? { ca: process.env.PGSSL_CA } : {}),
    };

// ─── Test identifiers, all namespaced so they are recognisable in a log ──────

const STAMP = Date.now();
const STUDENT_EMAIL = `frc-audit-${STAMP}@morgan.edu`;
const STUDENT_PASSWORD = `FrcAudit!${STAMP}`;
const STUDENT_ID = `FRCAUDIT${String(STAMP).slice(-6)}`;
const ITEM_NAME = `FRC AUDIT PROBE ${STAMP}`;

// Every id this run creates. Teardown deletes these and nothing else.
const created = {
  userIds: [],
  clientIds: [],
  itemIds: [],
  requestIds: [],
  transactionIds: [],
};

// ─── Reporting ───────────────────────────────────────────────────────────────

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// ─── Minimal cookie-jar HTTP client ──────────────────────────────────────────

function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const cookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) store.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    clear: () => store.clear(),
  };
}

async function call(session, method, path, body) {
  const headers = { accept: "application/json" };
  const cookie = session.header();
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    headers,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  session.absorb(res);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const anon = jar();
const student = jar();
const admin = jar();

// ─── Database helpers ────────────────────────────────────────────────────────

const db = new pg.Client({
  connectionString: DATABASE_URL,
  ssl,
  connectionTimeoutMillis: 20_000,
});

const COUNTED_TABLES = [
  "clients",
  "donors",
  "household_members",
  "inventory_items",
  "item_group_items",
  "item_groups",
  "notifications",
  "price_history",
  "request_audit_log",
  "request_items",
  "requests",
  "settings",
  "transaction_items",
  "transactions",
  "users",
  "weight_history",
];

async function snapshot() {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    const { rows } = await db.query(`select count(*)::int as c from "${table}"`);
    counts[table] = rows[0].c;
  }
  return counts;
}

// ─── Teardown: tracked ids only ──────────────────────────────────────────────

/**
 * Every statement below is keyed on an id this run recorded.
 *
 * Transactions are the subtle case. Fulfilment creates a transaction server
 * side whose id the API never returns to us, but the app records it on the
 * request (server/routes.ts sets requests.transaction_id), so we recover it
 * from OUR request rather than by searching for transactions that touched our
 * probe item. That distinction matters: the probe item is visible in the staff
 * picker and the public catalogue while the audit runs, so a real walk-up
 * check-out could include it. Such a transaction carries real line items for
 * real food, and deleting it would erase distribution history while leaving
 * the stock decrements it caused in place. We therefore refuse to touch any
 * transaction we did not create, and say so loudly instead.
 */
async function teardown() {
  section("Teardown (scoped to this run's rows only)");

  const { itemIds, requestIds, userIds, clientIds } = created;
  const txIds = new Set(created.transactionIds);

  // Only this run's own requests can hand us a fulfilment transaction.
  if (requestIds.length) {
    const { rows } = await db.query(
      "select transaction_id from requests where id = any($1::uuid[]) and transaction_id is not null",
      [requestIds],
    );
    for (const row of rows) txIds.add(row.transaction_id);
  }
  const transactionIds = [...txIds];

  const steps = [
    ["notifications (by request)", "delete from notifications where request_id = any($1::uuid[])", requestIds],
    // notifications.recipient_id is TEXT and holds the client IDENTIFIER, not a
    // user uuid, so this is keyed on the student id this run invented.
    ["notifications (by recipient)", "delete from notifications where recipient_id = any($1::text[])", userIds.length ? [STUDENT_ID] : []],
    ["request_audit_log", "delete from request_audit_log where request_id = any($1::uuid[])", requestIds],
    ["request_items", "delete from request_items where request_id = any($1::uuid[])", requestIds],
    ["requests", "delete from requests where id = any($1::uuid[])", requestIds],
    ["transaction_items", "delete from transaction_items where transaction_id = any($1::uuid[])", transactionIds],
    ["transactions", "delete from transactions where id = any($1::uuid[])", transactionIds],
    ["price_history", "delete from price_history where inventory_item_id = any($1::uuid[])", itemIds],
    ["weight_history", "delete from weight_history where inventory_item_id = any($1::uuid[])", itemIds],
    ["item_group_items", "delete from item_group_items where inventory_item_id = any($1::uuid[])", itemIds],
    ["household_members", "delete from household_members where client_id = any($1::uuid[])", clientIds],
    ["clients", "delete from clients where id = any($1::uuid[])", clientIds],
    ["users", "delete from users where id = any($1::uuid[])", userIds],
    ["inventory_items", "delete from inventory_items where id = any($1::uuid[])", itemIds],
  ];

  await db.query("BEGIN");
  try {
    for (const [label, sql, ids] of steps) {
      if (!ids.length) continue;
      if (label === "inventory_items") {
        // A transaction we did not create still references the probe item.
        // Deleting the item would mean deleting someone's real check-out, so
        // stop and hand it to a person instead.
        const { rows } = await db.query(
          `select distinct ti.transaction_id
             from transaction_items ti
            where ti.inventory_item_id = any($1::uuid[])
              and ti.transaction_id <> all($2::uuid[])`,
          [ids, transactionIds],
        );
        if (rows.length) {
          throw new Error(
            `refusing to delete the probe item: transaction(s) this run did not create ` +
              `reference it (${rows.map((r) => r.transaction_id).join(", ")}). ` +
              `Nothing further was deleted. Remove the audit item by hand once those ` +
              `real transactions have been reviewed.`,
          );
        }
      }
      const res = await db.query(sql, [ids]);
      if (res.rowCount) console.log(`  removed ${String(res.rowCount).padStart(3)}  ${label}`);
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// ─── The audit ───────────────────────────────────────────────────────────────

let baseline;
let connected = false;
// Set once the probe item proves the API and the database are one system.
// Teardown only runs when this is true.
let sameSystem = false;

try {
  await db.connect();
  connected = true;
  baseline = await snapshot();
  console.log(`Auditing ${BASE}`);
  console.log(`Baseline: ${JSON.stringify(baseline)}`);

  // A. Public surface and guards ---------------------------------------------
  section("Public surface and auth guards");

  let res = await call(anon, "GET", "/api/health");
  check("health reports ok", res.status === 200 && res.data?.status === "ok", `status ${res.status}`);

  res = await call(anon, "GET", "/api/public/inventory");
  const publicList = Array.isArray(res.data) ? res.data : null;
  check("public inventory is reachable unauthenticated", res.status === 200 && publicList !== null, `status ${res.status}`);
  check(
    "public list offers only in-stock items",
    publicList !== null && publicList.every((i) => i.quantity > 0),
    `${publicList?.length ?? "?"} listed`,
  );
  {
    const { rows } = await db.query(
      "select count(*)::int as c from inventory_items where quantity - coalesce(reserved_quantity, 0) > 0",
    );
    check(
      "public list matches the in-stock rows in the database",
      publicList !== null && publicList.length === rows[0].c,
      `api ${publicList?.length} vs db ${rows[0].c}`,
    );
  }
  {
    const fields = publicList ? [...new Set(publicList.flatMap((i) => Object.keys(i)))] : [];
    const leaked = fields.filter((f) => /cost|value|rawPayload|winningSource|dataSources/i.test(f));
    check("public list leaks no cost, value or sourcing internals", leaked.length === 0, leaked.join(", "));
  }

  for (const path of ["/api/clients", "/api/inventory", "/api/dashboard/stats", "/api/users", "/api/transactions"]) {
    res = await call(anon, "GET", path);
    check(`unauthenticated ${path} is refused`, res.status === 401, `status ${res.status}`);
  }
  res = await call(anon, "GET", "/api/portal/requests");
  check("unauthenticated portal is refused", res.status === 401, `status ${res.status}`);

  {
    const doc = await fetch(`${BASE}/`);
    const header = (k) => doc.headers.get(k) ?? "";
    check("HSTS is set", /max-age=\d+/.test(header("strict-transport-security")));
    check("CSP is set", header("content-security-policy").length > 20);
    check("X-Content-Type-Options is nosniff", header("x-content-type-options") === "nosniff");
    check("X-Frame-Options is set", /DENY|SAMEORIGIN/i.test(header("x-frame-options")));
  }

  // B. Admin session and the same-system proof --------------------------------
  section("Admin session");

  res = await call(admin, "POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login succeeds", res.status === 200 && res.data?.user?.role === "admin", `status ${res.status}`);
  if (res.status !== 200) throw new Error("cannot continue without an admin session");

  res = await call(admin, "POST", "/api/auth/login", { email: ADMIN_EMAIL, password: `wrong-${STAMP}` });
  check("a wrong admin password is refused", res.status === 401 || res.status === 400, `status ${res.status}`);

  res = await call(admin, "POST", "/api/inventory", {
    name: ITEM_NAME,
    category: "Canned",
    quantity: 0,
    weightPerUnitLbs: "1.0000",
    valuePerUnitUsd: "2.00",
  });
  check("admin can create an inventory item", res.status === 200 || res.status === 201, `status ${res.status}`);
  const itemId = res.data?.id;
  if (!itemId) throw new Error("inventory item was not created; nothing to audit");
  created.itemIds.push(itemId);

  // The whole safety model rests on this: if the deployment we are driving is
  // not backed by the database we are about to clean up, stop before creating
  // anything else, and do not let teardown run against that database.
  {
    const { rows } = await db.query("select id from inventory_items where id = $1", [itemId]);
    sameSystem = rows.length === 1;
    check("FRC_AUDIT_URL and DATABASE_URL are the same system", sameSystem);
    if (!sameSystem) {
      // The app has no delete-inventory route, so this row cannot be removed
      // programmatically, and the database we are holding is not the one it
      // landed in. Name it precisely so a person can remove it, and make sure
      // teardown does not run against the wrong database.
      throw new Error(
        [
          "FRC_AUDIT_URL and DATABASE_URL are not the same system: the item created",
          "through the API is not present in the database this script connected to.",
          "Teardown is SKIPPED so nothing is deleted from the wrong database.",
          "",
          "One row was created and must be removed by hand from the deployment at",
          `  ${BASE}`,
          `  inventory item id: ${itemId}`,
          `  name:              ${ITEM_NAME}`,
        ].join("\n"),
      );
    }
  }

  // C. Stock integrity --------------------------------------------------------
  section("Stock integrity");

  const line = (quantity) => ({
    inventoryItemId: itemId,
    name: ITEM_NAME,
    quantity,
    weightPerUnitLbs: "1.0000",
    valuePerUnitUsd: "2.00",
  });

  res = await call(admin, "POST", "/api/transactions", {
    type: "IN",
    source: "FRC audit",
    isEmergency: false,
    items: [line(24)],
  });
  check("check-in of 24 is accepted", res.status === 200 || res.status === 201, `status ${res.status}`);
  if (res.data?.id) created.transactionIds.push(res.data.id);

  res = await call(admin, "GET", `/api/inventory/${itemId}`);
  check("a new item's first check-in records 24 on hand, not 0", res.data?.quantity === 24, `quantity ${res.data?.quantity}`);

  res = await call(admin, "POST", "/api/transactions", {
    type: "OUT",
    source: "FRC audit",
    isEmergency: false,
    items: [line(100)],
  });
  check("an over-checkout is accepted by the server", res.status === 200 || res.status === 201, `status ${res.status}`);
  if (res.data?.id) created.transactionIds.push(res.data.id);

  res = await call(admin, "GET", `/api/inventory/${itemId}`);
  check("an over-checkout floors stock at 0 and never inflates it", res.data?.quantity === 0, `quantity ${res.data?.quantity}`);

  res = await call(admin, "POST", "/api/transactions", {
    type: "IN",
    source: "FRC audit restock",
    isEmergency: false,
    items: [line(10)],
  });
  if (res.data?.id) created.transactionIds.push(res.data.id);

  // D. Student signup rules and least privilege -------------------------------
  section("Student signup and least privilege");

  res = await call(student, "POST", "/api/auth/signup", {
    email: `frc-audit-${STAMP}@gmail.com`,
    password: STUDENT_PASSWORD,
    name: "FRC Audit Probe",
    studentId: STUDENT_ID,
  });
  check("a non morgan.edu signup is rejected", res.status === 400, `status ${res.status}`);

  res = await call(student, "POST", "/api/auth/signup", {
    email: `frc-audit-short-${STAMP}@morgan.edu`,
    password: "abc",
    name: "FRC Audit Probe",
    studentId: STUDENT_ID,
  });
  check("a short password is rejected", res.status === 400, `status ${res.status}`);

  student.clear();
  res = await call(student, "POST", "/api/auth/signup", {
    email: STUDENT_EMAIL,
    password: STUDENT_PASSWORD,
    name: "FRC Audit Probe",
    studentId: STUDENT_ID,
  });
  check("a valid morgan.edu signup succeeds", res.status === 200 || res.status === 201, `status ${res.status}`);
  if (res.data?.user?.id) created.userIds.push(res.data.user.id);

  // Signup also syncs a roster row; record it so teardown removes it too.
  {
    const { rows } = await db.query("select id from clients where identifier = $1", [STUDENT_ID]);
    for (const row of rows) created.clientIds.push(row.id);
    check("signup syncs the student onto the client roster", rows.length === 1, `${rows.length} roster rows`);
  }

  res = await call(student, "GET", "/api/auth/me");
  check("the student session carries the student role", res.status === 200 && res.data?.user?.role === "student", `status ${res.status}`);

  for (const path of ["/api/clients", "/api/inventory", "/api/dashboard/stats", "/api/users", "/api/donors", "/api/transactions"]) {
    res = await call(student, "GET", path);
    check(`a student is blocked from staff ${path}`, res.status === 403, `status ${res.status}`);
  }
  res = await call(student, "GET", "/api/portal/me/summary");
  check("a student can read their own portal summary", res.status === 200, `status ${res.status}`);

  // E. Duplicate roster entry -------------------------------------------------
  section("Duplicate roster entry");

  // Regression guard. Drizzle hides the Postgres SQLSTATE behind `cause`, which
  // once turned this everyday collision into an opaque 500 for staff.
  res = await call(admin, "POST", "/api/clients", { name: "FRC Audit Duplicate", identifier: STUDENT_ID });
  check(
    "re-adding an existing student ID returns 409, never 500",
    res.status === 409 && /already exists/i.test(String(res.data?.message)),
    `status ${res.status}`,
  );
  if (res.status === 201 && res.data?.id) created.clientIds.push(res.data.id);

  // F. Request lifecycle ------------------------------------------------------
  section("Request lifecycle");

  res = await call(student, "POST", "/api/portal/requests", {
    reason: "FRC audit probe request",
    items: [{ inventoryItemId: itemId, itemName: ITEM_NAME, itemCategory: "Canned", requestedQuantity: 2 }],
  });
  check("a student can submit a request", res.status === 200 || res.status === 201, `status ${res.status}`);
  const requestId = res.data?.id ?? res.data?.request?.id ?? null;
  if (requestId) created.requestIds.push(requestId);

  res = await call(student, "GET", "/api/portal/requests");
  {
    const list = Array.isArray(res.data) ? res.data : (res.data?.requests ?? []);
    check("the request appears in the student's own list", list.some((r) => r.id === requestId));
  }

  if (requestId) {
    res = await call(admin, "POST", `/api/requests/${requestId}/approve`, {});
    check("staff can approve the request", res.status === 200 || res.status === 201, `status ${res.status}`);

    res = await call(admin, "POST", `/api/requests/${requestId}/fulfill`, {});
    check("staff can fulfil the request", res.status === 200 || res.status === 201, `status ${res.status}`);

    res = await call(admin, "GET", `/api/requests/${requestId}`);
    check("the request ends in a completed state", /complet|fulfil/i.test(String(res.data?.status)), `status ${res.data?.status}`);
  }

  // G. Remaining staff surfaces ----------------------------------------------
  section("Remaining staff surfaces");

  for (const path of [
    "/api/dashboard/stats",
    "/api/donors",
    "/api/item-groups",
    "/api/settings",
    "/api/users",
    "/api/transactions",
    "/api/requests/analytics",
    "/api/reports/emergencies",
    "/api/reports/monthly-csv",
  ]) {
    res = await call(admin, "GET", path);
    check(`admin ${path} responds`, res.status === 200, `status ${res.status}`);
  }

  res = await call(admin, "PUT", "/api/settings/notARealSettingKey", { value: "x" });
  check("an unknown settings key is rejected", res.status === 400, `status ${res.status}`);

  res = await call(admin, "POST", "/api/auth/logout", {});
  check("logout succeeds", res.status === 200 || res.status === 204, `status ${res.status}`);
  res = await call(admin, "GET", "/api/dashboard/stats");
  check("the session is dead after logout", res.status === 401, `status ${res.status}`);
} catch (err) {
  failures.push(`audit aborted: ${err.message}`);
  console.error(`\nAUDIT ABORTED: ${err.message}`);
} finally {
  // Teardown runs even when the audit throws, so a mid-run failure does not
  // strand rows in a live database.
  if (connected && sameSystem) {
    try {
      await teardown();

      if (baseline) {
        const after = await snapshot();
        const drift = COUNTED_TABLES.filter((t) => baseline[t] !== after[t]);
        check(
          "the database is back to its pre-audit baseline",
          drift.length === 0,
          drift.map((t) => `${t}: ${baseline[t]} -> ${after[t]}`).join("; "),
        );
      }
    } catch (err) {
      failures.push(`teardown failed: ${err.message}`);
      console.error(`\nTEARDOWN FAILED: ${err.message}`);
      console.error("Audit rows may remain. Ids created this run:");
      console.error(JSON.stringify(created, null, 2));
    }
  } else if (connected) {
    console.error(
      "\nTeardown SKIPPED: the deployment and the database are not the same system.",
    );
    console.error("Nothing was deleted. Rows created this run, to remove by hand:");
    console.error(JSON.stringify(created, null, 2));
  }
  try {
    await db.end();
  } catch {
    /* already closed */
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`RESULT: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
