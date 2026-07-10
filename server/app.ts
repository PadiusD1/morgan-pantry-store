/**
 * Express app factory — shared by the Vercel serverless entry (api/index.ts)
 * and the local dev server (server/index.ts).
 *
 * No createServer, no listen, no signal handlers here: on Vercel the platform
 * invokes the exported app per request.
 *
 * Middleware order matters:
 *   1. parsers + proxy trust
 *   2. authenticate()   — populates req.user from the session cookie
 *   3. apiGuard()       — the single access gate for every /api path
 *   4. auth routes      — public per the guard's allowlist
 *   5. portal routes    — student-scoped
 *   6. staff routes     — everything else
 */

import express, { type Request, Response, NextFunction, type Express } from "express";
import { registerRoutes } from "./routes";
import { registerPortalRoutes } from "./portal";
import { authenticate, apiGuard, registerAuthRoutes } from "./auth";
import { pingDatabase } from "./pg";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function createApp(): Promise<Express> {
  const app = express();

  // Vercel terminates TLS at the proxy; req.ip must come from x-forwarded-for
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Security headers on API responses (the static document also gets them via
  // vercel.json; this covers the /api function directly, defense in depth).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    next();
  });

  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false }));

  // Same-origin deployment: no cross-origin API access unless explicitly
  // allow-listed via ALLOWED_ORIGINS.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Only advertise CORS capabilities to allow-listed origins; a non-listed
    // cross-origin caller gets no ACAO/methods/headers and is blocked by the browser.
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Request logging — status/duration only; response bodies contain PII and
  // must never hit the logs.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        log(`${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`);
      }
    });
    next();
  });

  app.get("/api/health", async (_req, res) => {
    const ok = await pingDatabase();
    if (ok) return res.json({ status: "ok" });
    return res.status(503).json({ status: "error", message: "Database unavailable" });
  });

  app.use(authenticate());
  app.use(apiGuard());

  registerAuthRoutes(app);
  registerPortalRoutes(app);
  await registerRoutes(app);

  // Global error handler — catches sync throws AND async rejections in Express 5.
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    log(`ERROR ${req.method} ${req.path} ${status} :: ${err?.message || err}`, "error");
    if (status >= 500) {
      console.error("[stack]", err?.stack || err);
    }
    if (res.headersSent) {
      return next(err);
    }
    const message = status >= 500 ? "Internal server error" : (err.message || "Request failed");
    return res.status(status).json({ message });
  });

  return app;
}
