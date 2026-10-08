/** Build first with npm run build:vercel. This runner owns only a fresh local test database. */
import fs from "node:fs/promises";
import path from "node:path";
import { fork, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import bcrypt from "bcryptjs";
import { localDatabaseUrl } from "./production-server.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
if (Object.keys(process.env).some((key) => key.startsWith("UPSTASH") || key.startsWith("KV_REST_API"))) {
  throw new Error("Production browser tests refuse external Redis configuration.");
}
if (process.env.DATABASE_URL) localDatabaseUrl(process.env.DATABASE_URL);
if (process.env.FRC_E2E_URL && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.FRC_E2E_URL).hostname)) {
  throw new Error("Production browser tests cannot target a remote app.");
}
const base = localDatabaseUrl(process.env.FRC_E2E_DATABASE_URL || `postgres://frc@localhost:${process.env.FRC_TEST_PG_PORT || 55417}/frc_e2e`);
if (base.pathname !== "/frc_e2e") throw new Error("FRC_E2E_DATABASE_URL must name the local frc_e2e test namespace.");
// setup-db.mjs deliberately accepts letter/underscore database names only.
const suffix = [...randomBytes(16)].map((byte) => String.fromCharCode(97 + byte % 26)).join("");
const dbName = `frc_e2e_${suffix}`;
const database = new URL(base);
database.pathname = `/${dbName}`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
const authDirectory = path.join(path.resolve(process.env.FRC_E2E_AUTH_DIR || path.join(root, ".tmp", "e2e-auth")), suffix);
const resultDirectory = path.join(path.resolve(process.env.FRC_E2E_RESULT_DIR || path.join(root, "test-results")), `production-${suffix}`);
await fs.mkdir(resultDirectory, { recursive: true });
const logPath = path.join(resultDirectory, "production-server.log");
const log = await fs.open(logPath, "w");
const email = "admin@local-stack.invalid";
const password = randomBytes(20).toString("hex");
const volunteerEmail = "volunteer@local-stack.invalid";
const volunteerPassword = randomBytes(20).toString("hex");
const staffEmail = "staff@local-stack.invalid";
const staffPassword = randomBytes(20).toString("hex");
const studentEmail = "student.one@morgan.edu";
const studentPassword = randomBytes(20).toString("hex");
const appEnv = {
  PATH: process.env.PATH || "",
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  NODE_ENV: "production", TZ: "UTC", PORT: process.env.FRC_E2E_PORT || "0",
  DATABASE_URL: database.toString(), FRC_E2E_SYNTHETIC: "1",
  SESSION_SECRET: randomBytes(32).toString("hex"), COOKIE_SECURE: "false",
};

async function runNode(script, args, env) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${path.basename(script)} exited with status ${code}.`);
}

let app;
let browserTests;
let ownsDatabase = false;
let cleaning = false;
async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(6_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  await terminate(browserTests);
  await terminate(app);
  await log.close();
  if (ownsDatabase) {
    const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000 });
    try {
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally { await admin.end(); }
  }
  await fs.rm(authDirectory, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { cleanup().finally(() => process.exit(1)); });
}

try {
  await Promise.all([fs.access(path.join(root, "api", "index.js")), fs.access(path.join(root, "dist", "public", "index.html"))]);
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000 });
  try {
    await admin.connect();
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (existing.rowCount) throw new Error("The randomly generated test database already exists; retry the run.");
    ownsDatabase = true;
  } finally { await admin.end(); }

  await runNode(path.join(root, "scripts", "local-stack", "setup-db.mjs"), [], {
    ...appEnv,
    STACK_MIGRATION_0001: path.join(root, "migrations", "0001_release_one.sql"),
    STACK_INDEXES: path.join(root, "tests", "fixtures", "prod-only-indexes.json"),
    ADMIN_EMAIL: email, ADMIN_PASSWORD: password,
    VOLUNTEER_EMAIL: volunteerEmail, VOLUNTEER_PASSWORD: volunteerPassword,
  });
  const connection = new pg.Client({ connectionString: database.toString(), connectionTimeoutMillis: 10_000 });
  try {
    await connection.connect();
    for (const [userEmail, userPassword, name, role, studentId] of [
      [staffEmail, staffPassword, "Local Staff", "staff", null],
      [studentEmail, studentPassword, "Test Student One", "student", "T0000001"],
    ]) {
      await connection.query("INSERT INTO users (email, password, name, role, student_id) VALUES ($1, $2, $3, $4, $5)", [userEmail, await bcrypt.hash(userPassword, 10), name, role, studentId]);
    }
  } finally { await connection.end(); }

  app = fork(path.join(root, "scripts", "e2e", "production-server.mjs"), [], {
    cwd: root, env: appEnv, stdio: ["ignore", log.fd, log.fd, "ipc"],
  });
  const appUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Production test server did not start within 45 seconds.")), 45_000);
    app.once("error", (error) => { clearTimeout(timeout); reject(error); });
    app.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Production test server exited before ready (${code}).`)); });
    app.on("message", (message) => {
      if (message?.type === "ready" && typeof message.url === "string") {
        clearTimeout(timeout);
        resolve(message.url);
      }
    });
  });
  console.log(`Testing the compiled Vercel bundle at ${appUrl} using isolated PostgreSQL data.`);
  browserTests = spawn(process.execPath, [path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], {
    cwd: root, stdio: "inherit", env: {
      ...process.env, NODE_ENV: "production", DATABASE_URL: database.toString(),
      FRC_E2E_PRODUCTION: "1", FRC_E2E_URL: appUrl,
      FRC_E2E_AUTH_DIR: authDirectory, FRC_E2E_RESULT_DIR: resultDirectory,
      FRC_E2E_EMAIL: email, FRC_E2E_PASSWORD: password,
      FRC_E2E_VOLUNTEER_EMAIL: volunteerEmail, FRC_E2E_VOLUNTEER_PASSWORD: volunteerPassword,
      FRC_E2E_STAFF_EMAIL: staffEmail, FRC_E2E_STAFF_PASSWORD: staffPassword,
      FRC_E2E_STUDENT_EMAIL: studentEmail, FRC_E2E_STUDENT_PASSWORD: studentPassword,
    },
  });
  const [code] = await once(browserTests, "exit");
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  try { console.error(await fs.readFile(logPath, "utf8")); } catch { /* Startup may fail before opening the server log. */ }
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log(`Production test evidence: ${resultDirectory}`);
}
