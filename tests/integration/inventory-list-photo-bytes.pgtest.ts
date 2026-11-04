import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

/**
 * Inventory lists are refetched every 30 seconds on every open staff screen and
 * on the public request page. Uploaded product photos live inline in
 * raw_payload as base64, so reading whole rows for a list moved every photo
 * across the database connection on every poll, which is the Supabase egress
 * the free plan ran out of. These tests pin that a list read never receives
 * photo bytes while every list still shows exactly the photos it showed before.
 */

const STAFF = "00000000-0000-4000-8000-0000000000aa";
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(120_000, 7)]);
const UPLOAD = `data:image/png;base64,${PNG.toString("base64")}`;
const REMOTE = "https://images.openfoodfacts.org/images/products/synthetic/front.jpg";

let t: TestDb;
let server: Server;
let base: string;
const ids: Record<string, string> = {};

const cases: Record<string, unknown> = {
  upload: { frcPhoto: { dataUrl: UPLOAD, description: "Synthetic tin", source: "Staff-supplied product photo" } },
  remote: { product: { image_front_url: REMOTE } },
  both: { frcPhoto: { dataUrl: UPLOAD, description: "Both" }, product: { image_url: REMOTE } },
  none: { product: { brands: "Synthetic" } },
  wrongType: { frcPhoto: { dataUrl: "data:image/gif;base64,R0lGOD", description: "gif" } },
  overlong: { frcPhoto: { dataUrl: `data:image/png;base64,${"A".repeat(250_001)}`, description: "too big" } },
  numericDataUrl: { frcPhoto: { dataUrl: 42 } },
  scalarPhoto: { frcPhoto: "not an object", product: { image_url: REMOTE } },
  arrayPhoto: { frcPhoto: ["data:image/png;base64,AAAA"] },
  arrayPayload: [{ frcPhoto: { dataUrl: "data:image/png;base64,AAAA" } }],
  stringPayload: "legacy text payload",
  nullPayload: null,
  history: {
    frcPhoto: { dataUrl: UPLOAD, description: "with history" },
    frcMeasurementHistory: [{ at: "2026-10-01T00:00:00.000Z", history: { reason: "Synthetic review", mode: "missing_only", counts: { rows: 2 } } }],
  },
};

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  await t.pool.query("INSERT INTO users (id, email, name, role) VALUES ($1, 'staff@example.test', 'Synthetic Staff', 'staff')", [STAFF]).catch(() => undefined);
  for (const [name, payload] of Object.entries(cases)) {
    const row = await t.pool.query(
      "INSERT INTO inventory_items (name, quantity, raw_payload) VALUES ($1, 5, $2::jsonb) RETURNING id",
      [`Synthetic ${name}`, JSON.stringify(payload)],
    );
    ids[name] = row.rows[0].id;
  }
  const express = (await import("express")).default;
  const { registerRoutes } = await import("../../server/routes");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    if (req.get("x-test-user")) req.user = { id: STAFF, email: "", name: "Synthetic Staff", role: "staff", studentId: null };
    next();
  });
  const { registerProductPhotoRoutes } = await import("../../server/product-photo");
  const { registerInventoryQualityRoutes } = await import("../../server/inventory-quality");
  registerProductPhotoRoutes(app);
  registerInventoryQualityRoutes(app);
  await registerRoutes(app);
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const { pool } = await import("../../server/pg");
  await pool.end();
  await t?.drop();
});

describe("inventory list photo bytes", () => {
  it("never receives inline photo bytes from the database for a list", async () => {
    const { storage } = await import("../../server/storage");
    const list = await storage.getInventoryItems();
    expect(list).toHaveLength(Object.keys(cases).length);
    const wire = JSON.stringify(list);
    expect(wire).not.toContain(PNG.toString("base64").slice(0, 64));
    expect(wire).not.toContain("A".repeat(1000));
    expect(wire.length).toBeLessThan(20_000);
  });

  it("keeps every list photo and staff payload identical to the full row helper", async () => {
    const { storage } = await import("../../server/storage");
    const { productPhotoPath, inventoryPhotoMetadata } = await import("@shared/product-photo");
    const list = await storage.getInventoryItems();
    for (const [name, id] of Object.entries(ids)) {
      const listed = list.find((item) => item.id === id)!;
      const full = (await storage.getInventoryItem(id))!;
      expect([name, productPhotoPath(listed)]).toEqual([name, productPhotoPath(full)]);
      expect([name, inventoryPhotoMetadata(listed)]).toEqual([name, inventoryPhotoMetadata(full)]);
    }
    const shown = Object.entries(ids).filter(([, id]) => productPhotoPath(list.find((item) => item.id === id)!)).map(([name]) => name).sort();
    expect(shown).toEqual(["both", "history", "remote", "scalarPhoto", "upload"]);
  });

  it("serves staff, public and quality lists without photo bytes and with the same photos", async () => {
    const staff = await fetch(`${base}/api/inventory`, { headers: { "x-test-user": STAFF } });
    const pub = await fetch(`${base}/api/public/inventory`);
    const quality = await fetch(`${base}/api/inventory/quality`, { headers: { "x-test-user": STAFF } });
    for (const res of [staff, pub, quality]) expect(res.status).toBe(200);
    const [staffBody, pubBody, qualityBody] = await Promise.all([staff.text(), pub.text(), quality.text()]);
    for (const body of [staffBody, pubBody, qualityBody]) expect(body).not.toContain(PNG.toString("base64").slice(0, 64));
    const withPhoto = (rows: Array<{ id: string; imageUrl: string | null }>) => rows.filter((row) => row.imageUrl).map((row) => row.id).sort();
    const expected = ["both", "history", "remote", "scalarPhoto", "upload"].map((name) => ids[name]).sort();
    expect(withPhoto(JSON.parse(staffBody))).toEqual(expected);
    expect(withPhoto(JSON.parse(pubBody))).toEqual(expected);
    expect(withPhoto(JSON.parse(qualityBody).items)).toEqual(expected);
    expect(JSON.parse(pubBody)[0]).not.toHaveProperty("rawPayload");
    const staffRows = JSON.parse(staffBody);
    for (const row of staffRows) expect(row).not.toHaveProperty("hasUploadedPhoto");
    expect(staffRows.find((row: { id: string }) => row.id === ids.upload).rawPayload.frcPhoto).toEqual({ description: "Synthetic tin", source: "Staff-supplied product photo" });
    const history = JSON.parse(qualityBody).items.find((row: { id: string }) => row.id === ids.history);
    expect(history.measurementHistory).toEqual([{ at: "2026-10-01T00:00:00.000Z", reason: "Synthetic review", history: { mode: "missing_only", counts: { rows: 2 } } }]);
  });

  it("still serves the actual uploaded bytes from the single photo route", async () => {
    const res = await fetch(`${base}/api/public/inventory/${ids.upload}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await fetch(`${base}/api/public/inventory/${ids.none}/photo`)).status).toBe(404);
    expect((await fetch(`${base}/api/public/inventory/not-a-uuid/photo`)).status).toBe(404);
  });

  it("applies the same upload rule in SQL as productPhotoSource", async () => {
    const { MAX_UPLOAD_DATA_URL_LENGTH, UPLOAD_DATA_URL_PATTERN, UPLOAD_DATA_URL_SQL_PATTERN } = await import("@shared/product-photo");
    const head = "data:image/png;base64,";
    const inputs = [UPLOAD, `${UPLOAD}
`, `
${UPLOAD}`, "data:image/jpeg;base64,AAAA", "data:image/webp;base64,AA==", "data:image/gif;base64,AAAA",
      "data:image/png;base64,AA===", "data:image/png;base64,", "DATA:image/png;base64,AAAA", "data:image/png;base64,AA AA",
      head + "A".repeat(MAX_UPLOAD_DATA_URL_LENGTH - head.length), head + "A".repeat(MAX_UPLOAD_DATA_URL_LENGTH - head.length + 1)];
    for (const input of inputs) {
      const js = UPLOAD_DATA_URL_PATTERN.test(input) && input.length <= MAX_UPLOAD_DATA_URL_LENGTH;
      const { rows } = await t.pool.query("SELECT char_length($1::text) <= $2 AND $1::text ~ $3 AS ok", [input, MAX_UPLOAD_DATA_URL_LENGTH, UPLOAD_DATA_URL_SQL_PATTERN]);
      expect([input.slice(0, 40), input.length, rows[0].ok]).toEqual([input.slice(0, 40), input.length, js]);
    }
  });

  it("keeps a student photo link stable while stock changes and lets it be cached", async () => {
    const reviewed = { frcPhoto: { dataUrl: UPLOAD, description: "Reviewed tin", reviewedAt: "2026-11-02T15:00:00.000Z" } };
    const insert = async (name: string, payload: unknown) => (await t.pool.query(
      "INSERT INTO inventory_items (name, quantity, raw_payload) VALUES ($1, 9, $2::jsonb) RETURNING id", [name, JSON.stringify(payload)])).rows[0].id as string;
    const uploadId = await insert("Synthetic stable upload", reviewed);
    const remoteId = await insert("Synthetic stable remote", cases.remote);
    const links = async () => {
      const rows = await (await fetch(`${base}/api/public/inventory`)).json() as Array<{ id: string; imageUrl: string | null }>;
      return Object.fromEntries(rows.filter((row) => row.id === uploadId || row.id === remoteId).map((row) => [row.id, row.imageUrl]));
    };
    const before = await links();
    // A student taking an item changes quantity and updated_at, never the photo.
    await t.pool.query("UPDATE inventory_items SET quantity = quantity - 1, updated_at = now() + interval '1 minute' WHERE id = ANY($1::uuid[])", [[uploadId, remoteId]]);
    expect(await links()).toEqual(before);
    const res = await fetch(`${base}${before[uploadId]}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, s-maxage=31536000, immutable");
    const stale = await fetch(`${base}/api/public/inventory/${uploadId}/photo?v=old`);
    expect(stale.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    // Replacing the photo gives a new link, so nobody keeps the old picture.
    const { updated_at } = (await t.pool.query("SELECT updated_at FROM inventory_items WHERE id = $1", [uploadId])).rows[0];
    const put = await fetch(`${base}/api/inventory/${uploadId}/photo`, { method: "PUT", headers: { "content-type": "application/json", "x-test-user": "staff" },
      body: JSON.stringify({ dataUrl: UPLOAD, description: "Replacement", expectedUpdatedAt: new Date(updated_at).toISOString() }) });
    expect(put.status).toBe(200);
    const saved = await put.json();
    const after = await links();
    expect(after[uploadId]).not.toBe(before[uploadId]);
    expect(saved.imageUrl).toBe(after[uploadId]);
    expect(after[remoteId]).toBe(before[remoteId]);
  });
});
