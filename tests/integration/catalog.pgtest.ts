import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";
let t: TestDb; let server: Server; let base: string;
beforeAll(async () => {
  t = await createTestDb(); process.env.DATABASE_URL = t.url;
  const express = (await import("express")).default;
  const { registerCatalogRoutes } = await import("../../server/catalog-routes");
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "00000000-0000-4000-8000-00000000000c", email: "", name: "Test", role: req.headers["x-test-role"] as "staff" ?? "staff", studentId: null }; next();
  });
  registerCatalogRoutes(app); server = app.listen(0); base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); const { pool } = await import("../../server/pg"); await pool.end(); await t?.drop(); });
async function patch(id: string, data: unknown, role = "staff") { return fetch(`${base}/api/inventory/${id}/catalog`, { method: "PATCH", headers: { "content-type": "application/json", "x-test-role": role }, body: JSON.stringify(data) }); }
it("saves only evidence-backed catalog fields without changing stock or discarding upstream provenance", async () => {
  const { rows: [item] } = await t.pool.query("INSERT INTO inventory_items (name, quantity, reserved_quantity, raw_payload) VALUES ('Catalog Rice', 10, 2, $1::jsonb) RETURNING id, updated_at", [JSON.stringify({ product: { code: "123" } })]);
  const data = { expectedUpdatedAt: item.updated_at.toISOString(), weightPerUnitLbs: 2, valuePerUnitUsd: 3.25, evidence: "Synthetic package label / price test 2026-10-15" };
  const response = await patch(item.id, data); expect(response.status).toBe(200); const saved = await response.json();
  expect(saved).toMatchObject({ quantity: 10, reservedQuantity: 2, weightPerUnitLbs: "2.0000", valuePerUnitUsd: "3.25", costIsEstimated: true });
  expect(saved.rawPayload.product).toEqual({ code: "123" }); expect(saved.rawPayload.frcCatalog.weightEvidence.source).toBe(data.evidence);
  expect((await patch(item.id, data)).status).toBe(409);
});
it("rejects incomplete, unsafe and unauthorized changes", async () => {
  const { rows: [item] } = await t.pool.query("INSERT INTO inventory_items (name) VALUES ('Catalog Validation') RETURNING id, updated_at");
  const data = { expectedUpdatedAt: item.updated_at.toISOString(), evidence: "Synthetic source" };
  for (const extra of [{}, { valuePerUnitUsd: 0 }, { valuePerUnitUsd: 1.005 }, { weightPerUnitLbs: 0.000001 }, { imageUrl: "https://evil.example/photo.jpg", imageSource: "bad" }, { valuePerUnitUsd: 3, quantity: 99 }]) {
    expect((await patch(item.id, { ...data, ...extra })).status).toBe(400);
  }
  expect((await patch(item.id, { ...data, valuePerUnitUsd: 3 }, "volunteer")).status).toBe(403);
  for (const route of ["/api/catalog/quality", "/api/catalog/quality.csv", "/api/reports/directory.csv?kind=donor"]) {
    expect((await fetch(base + route, { headers: { "x-test-role": "student" } })).status).toBe(403);
  }
});
it("exports the full separate registries without contact fields or student clients", async () => {
  await t.pool.query("INSERT INTO donors(name,email,notes) VALUES ('=DONOR', 'private@example.test', 'PRIVATE NOTE')");
  await t.pool.query("INSERT INTO clients(name,identifier,client_type) VALUES ('Partner Export','PARTNER-EXPORT','partner'), ('Student Private','STUDENT-EXPORT','student')");
  const donor = await (await fetch(base + "/api/reports/directory.csv?kind=donor")).text();
  expect(donor).toContain("'=DONOR"); expect(donor).not.toContain("private@example"); expect(donor).not.toContain("PRIVATE NOTE");
  const partner = await (await fetch(base + "/api/reports/directory.csv?kind=partner")).text();
  expect(partner).toContain("Partner Export"); expect(partner).not.toContain("Student Private");
});
