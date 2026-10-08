/**
 * Local-only host for the exact generated Vercel function and frontend.
 * No tsx, Vite dev server, .env loading, or production credentials are used.
 */
import { readFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";

const root = path.resolve(import.meta.dirname, "..", "..");

export function localDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("A local synthetic DATABASE_URL is required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "localhost" || url.search || url.hash) {
    throw new Error("Production tests require a literal localhost PostgreSQL URL without connection overrides.");
  }
  if (!url.pathname || url.pathname === "/") throw new Error("The synthetic database name is required.");
  return url;
}

export function assertProductionTestEnvironment(env) {
  if (env.FRC_E2E_SYNTHETIC !== "1") throw new Error("Set FRC_E2E_SYNTHETIC=1 only for an isolated test database.");
  if (env.NODE_ENV !== "production") throw new Error("Production browser tests must use NODE_ENV=production.");
  if (env.VERCEL !== undefined || env.VERCEL_ENV !== undefined) throw new Error("The test server cannot run on Vercel.");
  if (Object.keys(env).some((key) => key.startsWith("UPSTASH") || key.startsWith("KV_REST_API"))) {
    throw new Error("The test server refuses external Redis configuration.");
  }
  localDatabaseUrl(env.DATABASE_URL);
}

export function headerSourceMatches(source, pathname) {
  // Current rules are literal paths and /(.*). Keep literal filename dots
  // literal instead of accidentally widening the deployed header rules.
  if (typeof source !== "string" || !source.startsWith("/") || /[:?+\[\]{}]/.test(source)) {
    throw new Error(`Unsupported Vercel header matcher: ${source}`);
  }
  const pattern = source.split("(.*)").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`).test(pathname);
}

export async function startProductionTestServer({ port = Number(process.env.PORT || 5055) } = {}) {
  assertProductionTestEnvironment(process.env);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("The local test port is invalid.");
  const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
  const publicDir = path.resolve(root, config.outputDirectory);
  const entry = path.join(root, "api", "index.js");
  await Promise.all([access(entry), access(path.join(publicDir, "index.html"))]);
  for (const rule of config.headers || []) headerSourceMatches(rule.source, "/");

  // Production deliberately ignores the development barcode stub. Keep that
  // behavior intact, but block any attempted external provider request here.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("External network requests are disabled in the production test server.");
    }
    return originalFetch(input, init);
  };

  const { default: api } = await import(pathToFileURL(entry).href);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    for (const rule of config.headers || []) {
      if (headerSourceMatches(rule.source, req.path)) {
        for (const header of rule.headers) res.setHeader(header.key, header.value);
      }
    }
    next();
  });
  // Preserve the full /api/... URL expected by the bundled Express router.
  app.use((req, res, next) => {
    if (req.path !== "/api" && !req.path.startsWith("/api/")) return next();
    return api(req, res, (error) => {
      if (error) return next(error);
      if (!res.headersSent) res.status(404).json({ message: "API route not found" });
    });
  });
  app.use(express.static(publicDir, { index: false, redirect: false, dotfiles: "deny" }));
  app.use((req, res) => {
    if (req.method === "GET" || req.method === "HEAD") return res.sendFile(path.join(publicDir, "index.html"));
    return res.status(405).end();
  });
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, url } = await startProductionTestServer();
  console.log(`Production test bundle listening at ${url}`);
  process.send?.({ type: "ready", url });
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 5_000).unref();
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
