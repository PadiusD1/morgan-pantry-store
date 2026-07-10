import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { rawDb } from "./storage";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// CORS configuration
// Dev / LAN: allows any origin so kiosks, phones, and volunteers on the network can connect.
// Production: restrict via ALLOWED_ORIGINS env var (comma-separated), fall back to same-origin only.
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!isProduction) {
    // Dev / LAN mode: permissive
    res.header("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    // Production: only echo back allow-listed origins
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  } else if (!origin) {
    // Same-origin requests have no Origin header — allow them
    // (no header needed)
  }
  // else: untrusted origin, no CORS header — browser will block

  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  try {
    rawDb.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: "error", message: "Database unavailable" });
  }
});

(async () => {
  await registerRoutes(httpServer, app);

  // Global error handler — catches sync throws AND async rejections in Express 5.
  // Protects the server from crashes and returns safe error responses.
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Log full error server-side for ops visibility
    log(`ERROR ${req.method} ${req.path} ${status} :: ${err?.message || err}`, "error");
    if (status >= 500) {
      console.error("[stack]", err?.stack || err);
    }

    if (res.headersSent) {
      return next(err);
    }

    // Don't leak internals on 5xx — show generic message. User errors (4xx) can show their message.
    const message = status >= 500 ? "Internal server error" : (err.message || "Request failed");
    return res.status(status).json({ message });
  });

  // Last-resort process-level handlers so unhandled rejections never crash the server silently
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Graceful shutdown — flush SQLite WAL cleanly
  function shutdown(signal: string) {
    log(`${signal} received, shutting down gracefully...`);
    httpServer.close(() => {
      rawDb.close();
      log("Database closed, exiting.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
