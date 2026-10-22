import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pg";

/**
 * Two staff saving the same item at the same moment, on real PostgreSQL.
 *
 * Both of these were reproduced before they were fixed. One left a reviewed
 * measurement's provenance attached to the other person's figure. The other
 * made one product into two inventory rows with two separate stock counts,
 * because the two scanners read the same tin as its UPC-A and its EAN-13 form
 * and the unique index is on the exact text.
 */

vi.mock("../../server/barcode-lookup", () => ({ lookupBarcode: vi.fn() }));

const STAFF = "00000000-0000-4000-8000-00000000000e";

// 012345678905 and 0012345678905 are the same trade item.
const UPC_A = "012345678905";
const EAN_13 = "0012345678905";

let t: TestDb;
let server: Server;
let base: string;

beforeAll(async () => {
  t = await createTestDb();
  process.env.DATABASE_URL = t.url;
  const express = (await import("express")).default;
  const { registerRoutes } = await import("../../server/routes");
  const { registerInventoryQualityRoutes } = await import("../../server/inventory-quality");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: STAFF, email: "", name: "Test Staff Two", role: "staff", studentId: null };
    next();
  });
  registerInventoryQualityRoutes(app);
  await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ message: String(err?.message ?? err) });
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const { pool } = await import("../../server/pg");
  await pool.end();
  await t?.drop();
});

function send(method: string, path: string, body: unknown, key?: string) {
  return fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function makeItem(over: Record<string, unknown> = {}) {
  const res = await send(
    "POST",
    "/api/inventory",
    {
      name: `Synthetic Race Item ${randomUUID().slice(0, 8)}`,
      category: "Test",
      quantity: 4,
      weightPerUnitLbs: "1.0000",
      valuePerUnitUsd: "1.00",
      ...over,
    },
    randomUUID(),
  );
  expect(res.status).toBe(201);
  return res.json();
}

describe("a reviewed measurement and a plain edit racing", () => {
  it("does not leave the review's provenance attached to the other figure", async () => {
    const item = await makeItem();

    // One staff member records a reviewed weight with its source. The other
    // saves the ordinary edit form, which carries the weight it read before
    // the review existed and no source at all.
    const [review, plainEdit] = await Promise.all([
      send("PATCH", `/api/inventory/${item.id}/measurements`, {
        expectedUpdatedAt: new Date(item.updatedAt).toISOString(),
        weightPerUnitLbs: 3,
        weightSource: "Pantry scale, synthetic test, 21 October 2026",
        weightIsEstimated: false,
      }),
      send("PATCH", `/api/inventory/${item.id}`, { weightPerUnitLbs: "2.0000" }),
    ]);

    const stored = (
      await t.pool.query(
        "SELECT weight_per_unit_lbs::float AS w, raw_payload -> 'frcMeasurementReview' AS review FROM inventory_items WHERE id = $1",
        [item.id],
      )
    ).rows[0];

    // Whichever order they landed in, the stored weight and the stored
    // provenance describe the same figure.
    if (review.status === 200) {
      // The review won, so the plain edit was refused rather than overwriting it.
      expect(plainEdit.status).toBe(409);
      expect(stored.w).toBe(3);
      expect(stored.review).not.toBeNull();
    } else {
      // The plain edit landed first and there was no review to protect.
      expect(plainEdit.status).toBe(200);
      expect(stored.w).toBe(2);
    }
  });

  it("refuses to move a reviewed weight through the plain edit form", async () => {
    const item = await makeItem();
    const reviewed = await send("PATCH", `/api/inventory/${item.id}/measurements`, {
      expectedUpdatedAt: new Date(item.updatedAt).toISOString(),
      weightPerUnitLbs: 3,
      weightSource: "Pantry scale, synthetic test, 21 October 2026",
      weightIsEstimated: false,
    });
    expect(reviewed.status).toBe(200);

    const refused = await send("PATCH", `/api/inventory/${item.id}`, { weightPerUnitLbs: "2.0000" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toMatch(/Complete item weights/);
  });

  it("still saves an unrelated edit of a reviewed item, and leaves the figure alone", async () => {
    const item = await makeItem();
    await send("PATCH", `/api/inventory/${item.id}/measurements`, {
      expectedUpdatedAt: new Date(item.updatedAt).toISOString(),
      weightPerUnitLbs: 3,
      weightSource: "Pantry scale, synthetic test, 21 October 2026",
      weightIsEstimated: false,
    });

    // The ordinary form sends every field it holds, including the unchanged
    // measurements, so this must pass rather than trip the guard.
    const renamed = await send("PATCH", `/api/inventory/${item.id}`, {
      name: "Synthetic Renamed Item",
      category: "Renamed Category",
      reorderThreshold: 7,
      weightPerUnitLbs: "3.0000",
      valuePerUnitUsd: "1.00",
    });
    expect(renamed.status).toBe(200);
    const saved = await renamed.json();
    expect(saved.name).toBe("Synthetic Renamed Item");
    expect(saved.reorderThreshold).toBe(7);
    expect(Number(saved.weightPerUnitLbs)).toBe(3);
    const review = (
      await t.pool.query("SELECT raw_payload -> 'frcMeasurementReview' AS review FROM inventory_items WHERE id = $1", [
        item.id,
      ])
    ).rows[0].review;
    expect(review).not.toBeNull();
  });

  it("still applies a counted stock change with its expected count", async () => {
    const item = await makeItem();
    const res = await send(
      "PATCH",
      `/api/inventory/${item.id}`,
      { quantity: 9, expectedQuantity: 4 },
      randomUUID(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).quantity).toBe(9);
    const adjustments = (
      await t.pool.query("SELECT delta FROM stock_adjustments WHERE inventory_item_id = $1", [item.id])
    ).rows;
    expect(adjustments.map((row) => row.delta)).toEqual([5]);
  });

  it("refuses a counted stock change read from a stale count", async () => {
    const item = await makeItem();
    const res = await send(
      "PATCH",
      `/api/inventory/${item.id}`,
      { quantity: 9, expectedQuantity: 3 },
      randomUUID(),
    );
    expect(res.status).toBe(409);
  });
});

describe("two scanners reading the same trade item", () => {
  it("creates one row for the UPC-A and EAN-13 renderings of one GTIN", async () => {
    const [first, second] = await Promise.all([
      send("POST", "/api/inventory", {
        name: "Synthetic Same Tin A", category: "Test", quantity: 0, barcode: UPC_A,
        weightPerUnitLbs: "1.0000", valuePerUnitUsd: "1.00",
      }, randomUUID()),
      send("POST", "/api/inventory", {
        name: "Synthetic Same Tin B", category: "Test", quantity: 0, barcode: EAN_13,
        weightPerUnitLbs: "1.0000", valuePerUnitUsd: "1.00",
      }, randomUUID()),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rows = (
      await t.pool.query("SELECT count(*)::int AS n FROM inventory_items WHERE barcode = ANY($1)", [[UPC_A, EAN_13]])
    ).rows[0].n;
    expect(rows).toBe(1);

    // The refusal names the saved item, so staff receive stock against it
    // rather than being left with a dead end.
    const refusal = first.status === 409 ? first : second;
    const body = await refusal.json();
    expect(body.existingId).toBeTruthy();
    expect(body.message).toMatch(/already saved as/);
  });

  it("keeps two genuinely different barcodes as two items", async () => {
    // 036000291452 is a different valid UPC-A.
    const [first, second] = await Promise.all([
      send("POST", "/api/inventory", {
        name: "Synthetic Distinct One", category: "Test", quantity: 0, barcode: "036000291452",
        weightPerUnitLbs: "1.0000", valuePerUnitUsd: "1.00",
      }, randomUUID()),
      send("POST", "/api/inventory", {
        name: "Synthetic Distinct Two", category: "Test", quantity: 0, barcode: "038000356216",
        weightPerUnitLbs: "1.0000", valuePerUnitUsd: "1.00",
      }, randomUUID()),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it("keeps a legacy identifier distinct from a GTIN that shares its digits", async () => {
    const legacy = await send("POST", "/api/inventory", {
      name: "Synthetic Legacy Identifier", category: "Test", quantity: 0, barcode: `SKU-${UPC_A}`,
      weightPerUnitLbs: "1.0000", valuePerUnitUsd: "1.00",
    }, randomUUID());
    expect(legacy.status).toBe(201);
    const rows = (
      await t.pool.query("SELECT count(*)::int AS n FROM inventory_items WHERE barcode = $1", [`SKU-${UPC_A}`])
    ).rows[0].n;
    expect(rows).toBe(1);
  });

  it("lets an item with no barcode save without waiting on any queue", async () => {
    const [first, second] = await Promise.all([makeItem({ barcode: null }), makeItem({ barcode: null })]);
    expect(first.id).not.toBe(second.id);
  });
});


describe("inventory edit integrity at the HTTP boundary", () => {
  it("rejects clearing provenance followed by overwriting a reviewed measurement", async () => {
    const item = await makeItem();
    const review = await send("PATCH", `/api/inventory/${item.id}/measurements`, {
      expectedUpdatedAt: new Date(item.updatedAt).toISOString(), weightPerUnitLbs: 3,
      weightSource: "Synthetic scale measurement", weightIsEstimated: false,
    });
    expect(review.status).toBe(200);
    const original = await (await fetch(`${base}/api/inventory/${item.id}`)).json();
    for (const patch of [
      { rawPayload: null }, { rawPayload: {} }, { netWeightG: 12 },
      { unitWeightG: 12 }, { unitCount: 12 }, { packageType: "multi_pack" },
      { weightIsEstimated: true }, { costCents: 123 }, { costIsEstimated: true },
      { currency: "EUR" }, { winningSource: "forged" }, { matchConfidence: 0.2 },
      { dataSourcesTried: ["forged"] }, { weightPerUnitLbs: "2.0000" },
      { valuePerUnitUsd: "2.00" },
    ]) {
      const response = await send("PATCH", `/api/inventory/${item.id}`, { ...patch, name: "Must not partially save" });
      expect(response.status, JSON.stringify(patch)).toBe(409);
    }
    const current = await (await fetch(`${base}/api/inventory/${item.id}`)).json();
    expect(current.rawPayload).toEqual(original.rawPayload);
    expect(Number(current.weightPerUnitLbs)).toBe(3);
    expect(current.name).toBe(item.name);
    const unchanged = await send("PATCH", `/api/inventory/${item.id}`, {
      rawPayload: original.rawPayload, weightPerUnitLbs: original.weightPerUnitLbs,
      netWeightG: original.netWeightG, unitWeightG: original.unitWeightG,
      unitCount: original.unitCount, weightIsEstimated: original.weightIsEstimated,
      name: "Allowed unrelated edit",
    });
    expect(unchanged.status).toBe(200);
    expect((await unchanged.json()).rawPayload).toEqual(original.rawPayload);
  });

  it("protects provider evidence before any staff review", async () => {
    const item = await makeItem({ rawPayload: { providerEvidence: "original" }, netWeightG: 453.592 });
    for (const patch of [{ rawPayload: null }, { netWeightG: 1 }, { unitCount: 24 }, { weightPerUnitLbs: "2.0000" }]) {
      expect((await send("PATCH", `/api/inventory/${item.id}`, patch)).status).toBe(409);
    }
  });

  it("refuses equivalent barcode assignment through PATCH", async () => {
    const owner = await makeItem({ barcode: "049000028911" });
    const other = await makeItem();
    const response = await send("PATCH", `/api/inventory/${other.id}`, { barcode: "0049000028911" }, randomUUID());
    expect(response.status).toBe(409);
    expect((await response.json()).existingId).toBe(owner.id);
    expect((await (await fetch(`${base}/api/inventory/${other.id}`)).json()).barcode).toBeNull();
    expect((await send("PATCH", `/api/inventory/${owner.id.toUpperCase()}`, { barcode: "0049000028911" }, randomUUID())).status).toBe(200);
  });

  it("serializes two PATCH saves and create against PATCH for one canonical barcode", async () => {
    const first = await makeItem(), second = await makeItem();
    const results = await Promise.all([
      send("PATCH", `/api/inventory/${first.id}`, { barcode: "036000291469" }, randomUUID()),
      send("PATCH", `/api/inventory/${second.id}`, { barcode: "0036000291469" }, randomUUID()),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const other = await makeItem();
    const mixed = await Promise.all([
      send("PATCH", `/api/inventory/${other.id}`, { barcode: "036000291476" }, randomUUID()),
      send("POST", "/api/inventory", { name: "Synthetic concurrent create", category: "Test", barcode: "0036000291476" }, randomUUID()),
    ]);
    expect(mixed.filter(r => r.status === 409)).toHaveLength(1);
    expect(mixed.filter(r => r.status === 200 || r.status === 201)).toHaveLength(1);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM inventory_items WHERE barcode=ANY($1)", [["036000291476", "0036000291476"]])).rows[0].n).toBe(1);
  });

  it("does not silently select one row from a preexisting ambiguous canonical group", async () => {
    await t.pool.query("INSERT INTO inventory_items(name,barcode) VALUES ('Synthetic legacy split A','036000291483'),('Synthetic legacy split B','0036000291483')");
    for (const code of ["036000291483", "0036000291483", "00036000291483"]) {
      const response = await fetch(`${base}/api/barcode-lookup/${code}`);
      expect(response.status).toBe(409);
      expect((await response.json()).message).toMatch(/multiple inventory items/i);
    }
  });
});


it("records each barcode field's source rather than the description winner", async () => {
  const { lookupBarcode } = await import("../../server/barcode-lookup");
  vi.mocked(lookupBarcode).mockResolvedValueOnce({ found: true, logs: [], product: {
    name: "Synthetic sourced package", brand: null, category: "Test", barcode: "036000291490", gtin: "00036000291490",
    packageType: "single", unitCount: 1, packComponents: [], netWeightG: 453.59237,
    unitWeightG: 453.59237, weightPerUnitLbs: 1, weightIsEstimated: false,
    costCents: 250, currency: "USD", valuePerUnitUsd: 2.5, costIsEstimated: false,
    allergens: [], dataSourcesTried: [], matchConfidence: 1, winningSource: "description-provider", rawPayload: {}, priceReview: [],
    weightProvenance: { basis: "provider_net_quantity", confidence: "observed", source: "weight-provider", observedAt: "2026-10-21", packageBasis: "whole_package", note: null },
    priceProvenance: { confidence: "observed", source: "price-provider", retailer: "Synthetic Store", currency: "USD", observedAt: "2026-10-21", fetchedAt: "2026-10-21", locationId: null, note: null },
  } });
  const response = await fetch(`${base}/api/barcode-lookup/036000291490`);
  expect(response.status).toBe(201);
  const { item } = await response.json();
  expect((await t.pool.query("SELECT source FROM price_history WHERE inventory_item_id=$1", [item.id])).rows).toEqual([{ source: "price-provider" }]);
  expect((await t.pool.query("SELECT source FROM weight_history WHERE inventory_item_id=$1", [item.id])).rows).toEqual([{ source: "weight-provider" }]);
});


it("advances the inventory version even when the previous version is ahead of the clock", async () => {
  const item = await makeItem();
  await t.pool.query("UPDATE inventory_items SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=$1", [item.id]);
  const edit = await send("PATCH", `/api/inventory/${item.id}`, { name: "Synthetic version advance" }, randomUUID());
  expect(edit.status).toBe(200);
  const saved = await edit.json();
  expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(new Date("2099-01-01T00:00:00.000Z").getTime());
  const stale = await send("PATCH", `/api/inventory/${item.id}/measurements`, {
    expectedUpdatedAt: "2099-01-01T00:00:00.000Z", weightPerUnitLbs: 2,
    weightSource: "Synthetic stale version", weightIsEstimated: false,
  });
  expect(stale.status).toBe(409);
});
