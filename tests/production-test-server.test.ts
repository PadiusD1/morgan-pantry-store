import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertProductionTestEnvironment, headerSourceMatches, localDatabaseUrl } from "../scripts/e2e/production-server.mjs";

const local = { NODE_ENV: "production", FRC_E2E_SYNTHETIC: "1", DATABASE_URL: "postgres://frc@localhost:55417/frc_e2e_example" };

describe("production test server isolation", () => {
  it("accepts only an explicit synthetic production-mode local database", () => {
    expect(() => assertProductionTestEnvironment(local)).not.toThrow();
    expect(() => assertProductionTestEnvironment({ ...local, FRC_E2E_SYNTHETIC: undefined })).toThrow("isolated test database");
    expect(() => assertProductionTestEnvironment({ ...local, NODE_ENV: "development" })).toThrow("NODE_ENV=production");
  });

  it("refuses remote databases and connection-string host overrides", () => {
    for (const url of [
      "postgres://frc@prod.example.com/frc_e2e",
      "postgres://frc@localhost.example.com/frc_e2e",
      "postgres://frc@localhost/frc_e2e?host=prod.example.com",
      "postgres://frc@localhost/frc_e2e?sslmode=require",
      "https://localhost/frc_e2e",
    ]) expect(() => localDatabaseUrl(url)).toThrow("literal localhost");
  });

  it("refuses deployed runtimes and both supported external Redis variable families", () => {
    for (const extra of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { UPSTASH_REDIS_REST_URL: "https://example.invalid" }, { KV_REST_API_URL: "https://example.invalid" }]) {
      expect(() => assertProductionTestEnvironment({ ...local, ...extra })).toThrow();
    }
  });
});

describe("Vercel header parity", () => {
  it("matches literal filenames exactly while supporting the deployed global rule", () => {
    expect(headerSourceMatches("/(.*)", "/reports")).toBe(true);
    expect(headerSourceMatches("/(.*)", "/api/health")).toBe(true);
    expect(headerSourceMatches("/manifest.webmanifest", "/manifest.webmanifest")).toBe(true);
    expect(headerSourceMatches("/manifest.webmanifest", "/manifestXwebmanifest")).toBe(false);
  });

  it("can apply every configured production header rule and fails unsupported patterns visibly", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    for (const rule of config.headers) expect(() => headerSourceMatches(rule.source, "/reports")).not.toThrow();
    expect(config.headers.flatMap((rule: { headers: { key: string }[] }) => rule.headers).some((header: { key: string }) => header.key.toLowerCase() === "content-security-policy")).toBe(true);
    expect(() => headerSourceMatches("/:path*", "/reports")).toThrow("Unsupported Vercel header matcher");
  });
});
