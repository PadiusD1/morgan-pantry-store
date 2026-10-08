import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
    throw new Error("E2E setup refuses a non-local target.");
  }
  const email = process.env.FRC_E2E_EMAIL;
  const password = process.env.FRC_E2E_PASSWORD;
  if (!email || !password) throw new Error("Start the synthetic local stack and set FRC_E2E_EMAIL and FRC_E2E_PASSWORD.");
  const authDirectory = process.env.FRC_E2E_AUTH_DIR || ".tmp/e2e-auth";
  await fs.mkdir(authDirectory, { recursive: true });
  const api = await request.newContext({ baseURL });
  const health = await api.get("/api/health");
  if (health.status() !== 200) throw new Error("The local database is not healthy.");
  const login = await api.post("/api/auth/login", { data: { email, password } });
  if (login.status() !== 200 || (await login.json()).user?.role !== "admin") {
    throw new Error("The local audit requires a synthetic admin account.");
  }
  await api.storageState({ path: path.join(authDirectory, "admin.json") });
  await api.dispose();
}
