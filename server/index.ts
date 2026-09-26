/**
 * Local development / VM entry point.
 * Vercel uses api/index.ts instead — keep listen/vite concerns here only.
 */

import "dotenv/config";
import { createServer } from "http";
import { createApp, log } from "./app";
import { serveStatic } from "./static";
import { pool } from "./pg";

(async () => {
  const app = await createApp();
  const httpServer = createServer(app);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: process.env.FRC_LISTEN_HOST || "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });

  function shutdown(signal: string) {
    log(`${signal} received, shutting down gracefully...`);
    httpServer.close(() => {
      pool.end().finally(() => {
        log("Database pool closed, exiting.");
        process.exit(0);
      });
    });
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
