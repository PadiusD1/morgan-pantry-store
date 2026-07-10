/**
 * Authentication & authorization.
 *
 * - Stateless sessions: HS256 JWT in an HttpOnly cookie (serverless-safe,
 *   no session store needed).
 * - Passwords hashed with bcrypt.
 * - Student self-signup is restricted to @morgan.edu emails, enforced
 *   server-side. Staff/admin accounts are created by an admin (or seeded).
 * - One guard mounted on /api decides access tiers so individual route
 *   handlers stay unchanged:
 *     PUBLIC   -> health, auth endpoints, public inventory browse
 *     STUDENT  -> /api/portal/* only (own data, identity from session)
 *     STAFF    -> everything else (admin | staff | volunteer)
 *     ADMIN    -> settings writes, destructive deletes, user management
 */

import type { Express, NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const SESSION_COOKIE = "frc_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MORGAN_EMAIL_RE = /^[A-Za-z0-9._%+-]+@morgan\.edu$/i;
const BCRYPT_ROUNDS = 10;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "staff" | "volunteer" | "student";
  studentId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    studentId: user.studentId ?? null,
  };
}

function toSafeUser(user: User) {
  const { password: _password, ...safe } = user;
  return safe;
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

async function issueSession(res: Response, user: User): Promise<void> {
  const session = toSessionUser(user);
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(getSecret());
  res.append("Set-Cookie", sessionCookie(token, SESSION_TTL_SECONDS));
}

function clearSession(res: Response): void {
  res.append("Set-Cookie", sessionCookie("", 0));
}

// ─── Login rate limiting (per warm instance; primary abuse brake) ───────────

const attempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/** Populates req.user from the session cookie; never rejects. */
export function authenticate() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      try {
        const { payload } = await jwtVerify(token, getSecret());
        if (payload.sub && payload.email && payload.role) {
          req.user = {
            id: String(payload.sub),
            email: String(payload.email),
            name: String(payload.name ?? ""),
            role: payload.role as SessionUser["role"],
            studentId: (payload.studentId as string | null) ?? null,
          };
        }
      } catch {
        // invalid/expired token — treat as anonymous
      }
    }
    next();
  };
}

const STAFF_ROLES = new Set(["admin", "staff", "volunteer"]);

interface PathRule {
  method?: string;
  pattern: RegExp;
}

const PUBLIC_RULES: PathRule[] = [
  { method: "GET", pattern: /^\/api\/health$/ },
  { pattern: /^\/api\/auth\// },
  { method: "GET", pattern: /^\/api\/public\/inventory$/ },
];

const ADMIN_RULES: PathRule[] = [
  { method: "PUT", pattern: /^\/api\/settings\// },
  { method: "DELETE", pattern: /^\/api\/clients\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/donors\/[^/]+$/ },
  { pattern: /^\/api\/users(\/|$)/ },
];

function matches(rules: PathRule[], method: string, path: string): boolean {
  return rules.some(
    (r) => (!r.method || r.method === method) && r.pattern.test(path),
  );
}

/**
 * The single /api access gate. Mount AFTER auth routes are registered and
 * BEFORE portal/staff routes.
 */
export function apiGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (!path.startsWith("/api")) return next();
    if (matches(PUBLIC_RULES, req.method, path)) return next();

    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Sign in required" });
    }

    if (user.role === "student") {
      if (path.startsWith("/api/portal/")) return next();
      return res.status(403).json({ message: "Students can only access the student portal" });
    }

    if (!STAFF_ROLES.has(user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    if (matches(ADMIN_RULES, req.method, path) && user.role !== "admin") {
      return res.status(403).json({ message: "Administrator access required" });
    }

    return next();
  };
}

/** Route-level role check for handlers that need it explicitly. */
export function requireRole(...roles: SessionUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Sign in required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

// ─── Validation schemas ──────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .refine((e) => MORGAN_EMAIL_RE.test(e), {
      message: "A @morgan.edu email address is required",
    }),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().trim().min(2).max(120),
  studentId: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[A-Za-z0-9-]+$/, "Student ID may contain letters, numbers, and dashes only"),
  phone: z.string().trim().max(30).optional(),
});

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "staff", "volunteer", "student"]),
  studentId: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["admin", "staff", "volunteer", "student"]).optional(),
  password: z.string().min(8).max(200).optional(),
  studentId: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
});

// ─── Admin bootstrap ─────────────────────────────────────────────────────────

/**
 * Idempotent: if no admin account exists and ADMIN_EMAIL/ADMIN_PASSWORD env
 * vars are present, create the first admin. Runs lazily on login attempts so
 * a fresh deployment can bootstrap itself without a shell.
 */
let bootstrapChecked = false;
async function ensureAdminSeed(): Promise<void> {
  if (bootstrapChecked) return;
  bootstrapChecked = true;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await storage.getUserByEmail(email);
  if (existing) return;
  await storage.createUser({
    email,
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
    name: process.env.ADMIN_NAME?.trim() || "FRC Administrator",
    role: "admin",
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerAuthRoutes(app: Express): void {
  // Sign in (all roles)
  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Enter a valid email and password" });
    }
    const { email, password } = parsed.data;

    const ip = req.ip ?? "unknown";
    if (rateLimited(`login:${ip}`) || rateLimited(`login:${email}`)) {
      return res.status(429).json({ message: "Too many attempts. Try again in a few minutes." });
    }

    await ensureAdminSeed();

    const user = await storage.getUserByEmail(email);
    const hash = user?.password ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    await issueSession(res, user);
    return res.json({ user: toSafeUser(user) });
  });

  // Student self-signup (@morgan.edu enforced)
  app.post("/api/auth/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors[0]?.message ?? "Invalid signup details";
      return res.status(400).json({ message });
    }
    const { email, password, name, studentId, phone } = parsed.data;

    const ip = req.ip ?? "unknown";
    if (rateLimited(`signup:${ip}`)) {
      return res.status(429).json({ message: "Too many attempts. Try again in a few minutes." });
    }

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists. Sign in instead." });
    }

    const user = await storage.createUser({
      email,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name,
      role: "student",
      studentId,
      phone: phone ?? undefined,
    });

    // Keep the pantry's client roster in sync so staff see the student
    try {
      const client = await storage.getClientByIdentifier(studentId);
      if (!client) {
        await storage.createClient({
          name,
          identifier: studentId,
          email,
          phone: phone ?? undefined,
          clientType: "student",
        } as any);
      }
    } catch {
      // roster sync is best-effort; the account itself is what matters
    }

    await issueSession(res, user);
    return res.status(201).json({ user: toSafeUser(user) });
  });

  // Current session
  app.get("/api/auth/me", async (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not signed in" });
    const user = await storage.getUser(req.user.id);
    if (!user) {
      clearSession(res);
      return res.status(401).json({ message: "Account no longer exists" });
    }
    return res.json({ user: toSafeUser(user) });
  });

  // Sign out
  app.post("/api/auth/logout", (_req, res) => {
    clearSession(res);
    return res.json({ ok: true });
  });

  // ─── Admin user management ────────────────────────────────────────────
  // (guarded by ADMIN_RULES in apiGuard: /api/users*)

  app.get("/api/users", async (_req, res) => {
    const users = await storage.getUsers();
    return res.json(users.map(toSafeUser));
  });

  app.post("/api/users", async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid user" });
    }
    const existing = await storage.getUserByEmail(parsed.data.email);
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    const user = await storage.createUser({
      ...parsed.data,
      password: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS),
    });
    return res.status(201).json(toSafeUser(user));
  });

  app.patch("/api/users/:id", async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid update" });
    }
    const changes: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.password) {
      changes.password = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    }
    const user = await storage.updateUser(req.params.id, changes as any);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(toSafeUser(user));
  });

  app.delete("/api/users/:id", async (req, res) => {
    if (req.user && req.user.id === req.params.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const ok = await storage.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ message: "User not found" });
    return res.json({ ok: true });
  });
}

export { toSafeUser, BCRYPT_ROUNDS };
export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
