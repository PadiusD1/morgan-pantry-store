import type { Express } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { pool } from "./pg";
import { claimRequestKey, runIdempotent, saveRequestKey, sendClaim } from "./idempotency";
import { drizzle } from "drizzle-orm/node-postgres";
import { clients as clientsTable, inventoryItems, stockAdjustments } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { classificationProblem, createClientWork, transactionClassification } from "./client-create";
import { CLASSIFICATIONS } from "@shared/checkout-identity";
import { lookupBarcode } from "./barcode-lookup";
import { checkClientDuplicate } from "./client-duplicates";
import { findOrCreateDonor } from "./donor-find-or-create";
import { attributeDonor, buildSourceOptions, normaliseDonorName } from "@shared/donation-source";
import { duplicateMessage } from "@shared/identity";
import { CSV_BOM, csvRow } from "@shared/csv";
import { easternDate, generatedValue, monthlyGeneratedLine, monthlyItemLine, monthlySubtotalLine } from "./monthly-csv";
import {
  insertInventoryItemSchema,
  insertClientSchema,
  insertTransactionSchema,
  insertTransactionItemSchema,
  insertHouseholdMemberSchema,
  insertItemGroupSchema,
  insertItemGroupItemSchema,
  insertDonorSchema,
} from "@shared/schema";
import {
  createFoodRequest,
  createRequestSchema,
  getRequestPayload,
  releaseRequestReservations,
  RequestRateLimitError,
} from "./request-service";
import { moveRequestStatus } from "./request-service";

const PICKUP_STATUSES = ["approved", "partially_approved", "ready_for_pickup"];
const OPEN_STATUSES = ["pending", "under_review", ...PICKUP_STATUSES];

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps driver failures in a DrizzleQueryError whose own `code` is
 * undefined — the Postgres SQLSTATE lives on the nested `cause`. Reading
 * `err.code` directly therefore never matches, and an expected duplicate
 * (a student who already self-registered, a barcode already in stock) escapes
 * as an opaque 500. Walk the cause chain instead.
 */
function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Settings keys the admin UI may write; everything else is rejected. */
const ALLOWED_SETTING_KEYS = new Set([
  "orgName",
  "orgAddress",
  "orgPhone",
  "orgEmail",
  "visitWarningDays",
  "maxHouseholdSize",
  "defaultDistributionNote",
  "maxRequestsPerDay",
  "requestExpirationHours",
]);

function actorName(req: { user?: { name?: string; email?: string } }): string {
  return req.user?.name || req.user?.email || "staff";
}

/**
 * Shape zod validation errors for an API response.
 * Only leaks the raw field errors outside production; in production the client
 * gets a bare `undefined` so validation internals aren't disclosed.
 */
function zodErrors(error: { flatten: () => { fieldErrors: unknown } }): unknown {
  return process.env.NODE_ENV !== "production"
    ? error.flatten().fieldErrors
    : undefined;
}

/** Map a raw `transactions` DB row to the camelCase shape the storage getter returns. */
function mapTransactionRow(row: any) {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    source: row.source,
    donor: row.donor,
    clientId: row.client_id,
    clientName: row.client_name,
    clientClassification: row.client_classification ?? null,
    donorId: row.donor_id,
    isEmergency: row.is_emergency,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    createdAt: row.created_at,
  };
}

/** Map a raw `transaction_items` DB row to the camelCase shape the storage getter returns. */
function mapTransactionItemRow(row: any) {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    inventoryItemId: row.inventory_item_id,
    name: row.name,
    quantity: row.quantity,
    weightPerUnitLbs: row.weight_per_unit_lbs,
    valuePerUnitUsd: row.value_per_unit_usd,
  };
}

/** Body validation for POST /api/requests/:id/approve */
const approveBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        approvedQuantity: z.number().int().min(0),
      }),
    )
    .optional(),
  adminNote: z.string().max(2000).nullish(),
});

/** Body validation for POST /api/requests/:id/fulfill */
const fulfillBodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        fulfilledQuantity: z.number().int().min(0),
      }),
    )
    .optional(),
});

async function getHydratedItemGroupItems(groupId: string) {
  const { rows } = await pool.query(
    `SELECT
       igi.id,
       igi.group_id,
       igi.inventory_item_id,
       igi.quantity,
       ii.name,
       ii.brand,
       ii.category
     FROM item_group_items igi
     LEFT JOIN inventory_items ii ON ii.id = igi.inventory_item_id
     WHERE igi.group_id = $1
     ORDER BY lower(ii.name), igi.id`,
    [groupId],
  );
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    inventoryItemId: row.inventory_item_id,
    name: row.name ?? "Missing item",
    brand: row.brand ?? null,
    category: row.category ?? null,
    quantity: row.quantity ?? 1,
    defaultQuantity: row.quantity ?? 1,
  }));
}

function parseItemGroupItems(rawItems: unknown, groupId: string) {
  if (!Array.isArray(rawItems)) return [];

  const parsed = [];
  for (const rawItem of rawItems as any[]) {
    const quantity = Number(rawItem.quantity ?? rawItem.defaultQuantity ?? 1);
    const itemResult = insertItemGroupItemSchema.safeParse({
      inventoryItemId: rawItem.inventoryItemId,
      groupId,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
    });
    if (!itemResult.success) {
      throw new Error("Invalid bundle item data");
    }
    parsed.push(itemResult.data);
  }
  return parsed;
}

export async function registerRoutes(app: Express): Promise<void> {
  // ─── Barcode Lookup ──────────────────────────────────────────────────

  app.get("/api/barcode-lookup/:code", async (req, res) => {
    const code = req.params.code?.trim();
    if (!code) return res.status(400).json({ message: "Barcode is required" });
    if (!/^[0-9]{6,14}$/.test(code)) {
      return res.status(400).json({ message: "Invalid barcode format" });
    }

    const existing = await storage.getInventoryItemByBarcode(code);
    if (existing) {
      return res.json({
        status: "exists",
        item: existing,
        logs: [{ api: "local-db", status: "success", latencyMs: 0 }],
      });
    }

    let result;
    try {
      result = await lookupBarcode(code);
    } catch (err) {
      console.error(`[barcode-lookup] Unexpected error for ${code}:`, err);
      return res.json({
        status: "not_found",
        barcode: code,
        logs: [{ api: "all", status: "error", latencyMs: 0, error: "lookup failed" }],
      });
    }

    if (result.found && result.product) {
      const p = result.product;

      // Race-safe: if another request already created this barcode, use existing.
      let item;
      try {
        item = await storage.createInventoryItem({
          name: p.name,
          brand: p.brand,
          category: p.category,
          barcode: code,
          quantity: 0,

          packageType: p.packageType,
          unitCount: p.unitCount,

          weightPerUnitLbs: String(p.weightPerUnitLbs),
          netWeightG: p.netWeightG,
          unitWeightG: p.unitWeightG,
          weightIsEstimated: p.weightIsEstimated,

          valuePerUnitUsd: String(p.valuePerUnitUsd),
          costCents: p.costCents,
          costIsEstimated: p.costIsEstimated,
          currency: p.currency,

          allergens: p.allergens,

          dataSourcesTried: p.dataSourcesTried,
          winningSource: p.winningSource,
          matchConfidence: p.matchConfidence,
          rawPayload: p.rawPayload,
        });
      } catch (err: any) {
        if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
          const existingItem = await storage.getInventoryItemByBarcode(code);
          if (existingItem) {
            return res.json({
              status: "exists",
              item: existingItem,
              logs: result.logs,
            });
          }
        }
        throw err;
      }

      if (p.packComponents && p.packComponents.length > 0) {
        for (const comp of p.packComponents) {
          await storage.createPackComponent({
            parentItemId: item.id,
            componentName: comp.name,
            componentBarcode: comp.barcode || null,
            quantity: comp.quantity,
            weightG: comp.weightG || null,
          });
        }
      }

      if (p.costCents) {
        await storage.createPriceHistory({
          inventoryItemId: item.id,
          costCents: p.costCents,
          currency: p.currency,
          source: p.winningSource,
        });
      }

      if (p.netWeightG) {
        await storage.createWeightHistory({
          inventoryItemId: item.id,
          netWeightG: p.netWeightG,
          source: p.winningSource,
          isEstimated: p.weightIsEstimated,
        });
      }

      return res.status(201).json({
        status: "created",
        item,
        product: p,
        logs: result.logs,
      });
    }

    return res.json({
      status: "not_found",
      barcode: code,
      logs: result.logs,
    });
  });

  // ─── Inventory Items ─────────────────────────────────────────────────

  app.get("/api/inventory", async (_req, res) => {
    const items = await storage.getInventoryItems();
    res.json(items);
  });

  app.get("/api/inventory/:id", async (req, res) => {
    const item = await storage.getInventoryItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json(item);
  });

  app.post("/api/inventory", async (req, res) => {
    const result = insertInventoryItemSchema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    await runIdempotent(req, res, async (client) => {
      const [item] = await drizzle(client).insert(inventoryItems).values(result.data).returning();
      return { status: 201, body: item };
    });
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    const result = insertInventoryItemSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    if (result.data.quantity !== undefined) {
      // An absolute count only lands on the count it was read from (PLAN.md defect 4).
      const expected = req.body?.expectedQuantity;
      if (typeof expected !== "number" || !Number.isInteger(expected)) {
        return res.status(400).json({ message: "This page is out of date. Reload and try again" });
      }
      const itemId = req.params.id;
      const changes = result.data;
      return runIdempotent(req, res, async (client) => {
        const locked = await client.query(
          `SELECT quantity FROM inventory_items WHERE id = $1 FOR UPDATE`,
          [itemId],
        );
        if (locked.rowCount === 0) return { status: 404, body: { message: "Not found" } };
        const before: number = locked.rows[0].quantity;
        if (before !== expected) {
          return {
            status: 409,
            body: { message: "The stock count changed. Reload and try again", quantity: before },
          };
        }
        const db = drizzle(client);
        const [item] = await db
          .update(inventoryItems)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(inventoryItems.id, itemId))
          .returning();
        if (item.quantity !== before) {
          await db.insert(stockAdjustments).values({
            inventoryItemId: itemId,
            delta: item.quantity - before,
            quantityBefore: before,
            quantityAfter: item.quantity,
            reason: "edit",
            userId: req.user?.id ?? null,
          });
        }
        return { status: 200, body: item };
      });
    }
    const updated = await storage.updateInventoryItem(
      req.params.id,
      result.data,
    );
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  const adjustSchema = z.object({
    delta: z.number().int().refine((n) => n !== 0),
    reason: z.string().max(200).nullish(),
  });

  // A plus or minus travels as a difference, applied under the row lock, and
  // leaves a stock_adjustments row, never a transaction (PLAN.md item 33).
  app.post("/api/inventory/:id/adjust", async (req, res) => {
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(parsed.error) });
    }
    const { delta, reason } = parsed.data;
    const itemId = req.params.id;
    await runIdempotent(req, res, async (client) => {
      const locked = await client.query(
        `SELECT quantity FROM inventory_items WHERE id = $1 FOR UPDATE`,
        [itemId],
      );
      if (locked.rowCount === 0) return { status: 404, body: { message: "Not found" } };
      const before: number = locked.rows[0].quantity;
      if (before + delta < 0) {
        return {
          status: 409,
          body: { message: "Stock can not go below zero", quantity: before },
        };
      }
      const db = drizzle(client);
      const [item] = await db
        .update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} + ${delta}`, updatedAt: new Date() })
        .where(eq(inventoryItems.id, itemId))
        .returning();
      await db.insert(stockAdjustments).values({
        inventoryItemId: itemId,
        delta,
        quantityBefore: before,
        quantityAfter: item.quantity,
        reason: reason ?? null,
        userId: req.user?.id ?? null,
      });
      return { status: 200, body: item };
    });
  });

  // ─── Clients ─────────────────────────────────────────────────────────

  app.get("/api/clients", async (req, res) => {
    const clients = await storage.getClients();
    const typeFilter = typeof req.query.type === "string" ? req.query.type : null;
    if (typeFilter === "partner") {
      return res.json(clients.filter((c: any) => c.clientType === "partner"));
    }
    if (typeFilter === "student") {
      return res.json(
        clients.filter((c: any) => !c.clientType || c.clientType === "student"),
      );
    }
    res.json(clients);
  });

  app.get("/api/clients/:id", async (req, res) => {
    const client = await storage.getClient(req.params.id);
    if (!client) return res.status(404).json({ message: "Not found" });
    res.json(client);
  });

  app.post("/api/clients", async (req, res) => {
    const result = insertClientSchema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(result.error) });
    }

    // Check out sends an Idempotency-Key, so a retry returns the first answer.
    await runIdempotent(req, res, (client) =>
      createClientWork(result.data, {
        checkDuplicate: (data) => checkClientDuplicate(data),
        duplicateMessage,
        insert: async (data) => (await drizzle(client).insert(clientsTable).values(data).returning())[0],
        isUniqueViolation: (err) => pgErrorCode(err) === PG_UNIQUE_VIOLATION,
      }),
    );
  });

  app.patch("/api/clients/:id", async (req, res) => {
    const result = insertClientSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const classificationError = classificationProblem(result.data.classification);
    if (classificationError) return res.status(400).json({ message: classificationError });
    const before = await storage.getClient(req.params.id);
    if (!before) return res.status(404).json({ message: "Not found" });
    const dup = await checkClientDuplicate({ ...before, ...result.data, id: before.id }, before);
    if (dup.duplicate) {
      return res.status(409).json({ message: duplicateMessage(dup.match), duplicateOf: dup.match.id });
    }
    const updated = await storage.updateClient(req.params.id, result.data);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/clients/:id", async (req, res) => {
    const deleted = await storage.deleteClient(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  });

  // ─── Transactions ────────────────────────────────────────────────────

  app.get("/api/transactions", async (req, res) => {
    // Optional bounds; default behavior returns ALL transactions (newest first).
    const limitRaw =
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : null;
    const since = typeof req.query.since === "string" ? req.query.since : null;

    const conditions: string[] = [];
    const params: any[] = [];
    if (since) {
      params.push(since);
      conditions.push(`timestamp >= $${params.length}::timestamptz`);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    let limitClause = "";
    if (limit != null) {
      params.push(limit);
      limitClause = ` LIMIT $${params.length}`;
    }

    // Query 1: transactions. Query 2: every item for those transactions.
    // Stitch in JS — constant number of round-trips, never N+1.
    const txRows = (
      await pool.query(
        `SELECT * FROM transactions${where} ORDER BY timestamp DESC${limitClause}`,
        params,
      )
    ).rows;

    const itemsByTx = new Map<string, any[]>();
    if (txRows.length > 0) {
      const txIds = txRows.map((r) => r.id);
      const itemRows = (
        await pool.query(
          `SELECT * FROM transaction_items WHERE transaction_id = ANY($1::uuid[])`,
          [txIds],
        )
      ).rows;
      for (const ir of itemRows) {
        const mapped = mapTransactionItemRow(ir);
        const arr = itemsByTx.get(ir.transaction_id);
        if (arr) arr.push(mapped);
        else itemsByTx.set(ir.transaction_id, [mapped]);
      }
    }

    const withItems = txRows.map((r) => ({
      ...mapTransactionRow(r),
      items: itemsByTx.get(r.id) ?? [],
    }));
    res.json(withItems);
  });

  app.post("/api/transactions", async (req, res) => {
    const { items: rawItems, ...txBody } = req.body;

    if (typeof txBody.timestamp === "string") {
      txBody.timestamp = new Date(txBody.timestamp);
    }

    const txResult = insertTransactionSchema.safeParse(txBody);
    if (!txResult.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(txResult.error) });
    }

    // Generate the id up front so we can fully validate every item BEFORE
    // opening the DB transaction — validation failures never leave a half-write.
    const txId = randomUUID();
    const parsedItems: Array<z.infer<typeof insertTransactionItemSchema>> = [];
    if (Array.isArray(rawItems)) {
      for (const rawItem of rawItems) {
        const itemResult = insertTransactionItemSchema.safeParse({
          ...rawItem,
          transactionId: txId,
        });
        if (!itemResult.success) {
          return res
            .status(400)
            .json({ message: "Invalid item data", errors: zodErrors(itemResult.error) });
        }
        parsedItems.push(itemResult.data);
      }
    }

    const d = txResult.data;

    // Atomic: the transaction insert, its items, AND the inventory deltas all
    // commit together (or roll back together). The server is the single source
    // of truth for stock — IN adds, OUT subtracts (never below zero).
    let responsePayload: Record<string, unknown>;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const claim = await claimRequestKey(client, req);
      if (claim) {
        await client.query("ROLLBACK");
        return sendClaim(res, claim);
      }

      const txRow = (
        await client.query(
          `INSERT INTO transactions
             (id, type, timestamp, source, donor, client_id, client_name, donor_id, is_emergency, latitude, longitude, accuracy, client_classification)
           VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7, $8, COALESCE($9, false), $10, $11, $12, $13)
           RETURNING *`,
          [
            txId,
            d.type,
            (d as any).timestamp ?? null,
            (d as any).source ?? null,
            (d as any).donor ?? null,
            (d as any).clientId ?? null,
            (d as any).clientName ?? null,
            (d as any).donorId ?? null,
            (d as any).isEmergency ?? null,
            (d as any).latitude ?? null,
            (d as any).longitude ?? null,
            (d as any).accuracy ?? null,
            transactionClassification((d as any).clientClassification),
          ],
        )
      ).rows[0];

      const createdItems: Array<ReturnType<typeof mapTransactionItemRow>> = [];
      for (const it of parsedItems) {
        const insertedItem = (
          await client.query(
            `INSERT INTO transaction_items
               (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
              txId,
              it.inventoryItemId,
              it.name,
              it.quantity,
              it.weightPerUnitLbs,
              it.valuePerUnitUsd,
            ],
          )
        ).rows[0];
        createdItems.push(mapTransactionItemRow(insertedItem));

        if (d.type === "IN") {
          await client.query(
            `UPDATE inventory_items SET quantity = quantity + $1 WHERE id = $2`,
            [it.quantity, it.inventoryItemId],
          );
        } else if (d.type === "OUT") {
          await client.query(
            `UPDATE inventory_items SET quantity = GREATEST(0, quantity - $1) WHERE id = $2`,
            [it.quantity, it.inventoryItemId],
          );
        }
      }

      responsePayload = { ...mapTransactionRow(txRow), items: createdItems };
      await saveRequestKey(client, req, 201, responsePayload);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(responsePayload);
  });

  app.get("/api/transactions/:id/items", async (req, res) => {
    const items = await storage.getTransactionItems(req.params.id);
    res.json(items);
  });

  // ─── Household Members ─────────────────────────────────────────────

  app.get("/api/clients/:id/household", async (req, res) => {
    const client = await storage.getClient(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    const members = await storage.getHouseholdMembers(req.params.id);
    res.json(members);
  });

  app.post("/api/clients/:id/household", async (req, res) => {
    const client = await storage.getClient(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    const result = insertHouseholdMemberSchema.safeParse({
      ...req.body,
      clientId: req.params.id,
    });
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const member = await storage.createHouseholdMember(result.data);
    res.status(201).json(member);
  });

  app.delete("/api/household-members/:id", async (req, res) => {
    const deleted = await storage.deleteHouseholdMember(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  });

  // ─── Item Groups ───────────────────────────────────────────────────

  app.get("/api/item-groups", async (_req, res) => {
    const groups = await storage.getItemGroups();
    const withItems = await Promise.all(
      groups.map(async (g) => ({ ...g, items: await getHydratedItemGroupItems(g.id) })),
    );
    res.json(withItems);
  });

  app.get("/api/item-groups/:id", async (req, res) => {
    const group = await storage.getItemGroup(req.params.id);
    if (!group) return res.status(404).json({ message: "Not found" });
    res.json({ ...group, items: await getHydratedItemGroupItems(group.id) });
  });

  app.post("/api/item-groups", async (req, res) => {
    const { items: rawItems, ...groupBody } = req.body;
    const result = insertItemGroupSchema.safeParse(groupBody);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const group = await storage.createItemGroup(result.data);

    try {
      for (const item of parseItemGroupItems(rawItems, group.id)) {
        await storage.createItemGroupItem(item);
      }
    } catch (err: any) {
      await storage.deleteItemGroup(group.id);
      return res.status(400).json({ message: err.message || "Invalid bundle item data" });
    }

    res.status(201).json({ ...group, items: await getHydratedItemGroupItems(group.id) });
  });

  app.patch("/api/item-groups/:id", async (req, res) => {
    const { items: rawItems, ...groupBody } = req.body;
    const result = insertItemGroupSchema.partial().safeParse(groupBody);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const updated = await storage.updateItemGroup(req.params.id, result.data);
    if (!updated) return res.status(404).json({ message: "Not found" });

    if (Array.isArray(rawItems)) {
      let parsedItems;
      try {
        parsedItems = parseItemGroupItems(rawItems, updated.id);
      } catch (err: any) {
        return res.status(400).json({ message: err.message || "Invalid bundle item data" });
      }

      // Atomic bulk replace of the group's items
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM item_group_items WHERE group_id = $1", [updated.id]);
        for (const item of parsedItems) {
          await client.query(
            `INSERT INTO item_group_items (group_id, inventory_item_id, quantity)
             VALUES ($1, $2, $3)`,
            [item.groupId, item.inventoryItemId, item.quantity ?? 1],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    res.json({ ...updated, items: await getHydratedItemGroupItems(updated.id) });
  });

  app.delete("/api/item-groups/:id", async (req, res) => {
    const deleted = await storage.deleteItemGroup(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  });

  app.post("/api/item-groups/:id/items", async (req, res) => {
    const group = await storage.getItemGroup(req.params.id);
    if (!group) return res.status(404).json({ message: "Group not found" });
    const result = insertItemGroupItemSchema.safeParse({
      ...req.body,
      groupId: req.params.id,
    });
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const item = await storage.createItemGroupItem(result.data);
    const hydrated = (await getHydratedItemGroupItems(group.id)).find((i) => i.id === item.id) ?? item;
    res.status(201).json(hydrated);
  });

  app.delete("/api/item-group-items/:id", async (req, res) => {
    const deleted = await storage.deleteItemGroupItem(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  });

  // ─── Settings ──────────────────────────────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    const settings = await storage.getAllSettings();
    res.json(settings);
  });

  app.get("/api/settings/:key", async (req, res) => {
    const value = await storage.getSetting(req.params.key);
    if (value === undefined) return res.status(404).json({ message: "Not found" });
    res.json({ key: req.params.key, value });
  });

  app.put("/api/settings/:key", async (req, res) => {
    const { value } = req.body;
    if (!ALLOWED_SETTING_KEYS.has(req.params.key)) {
      return res.status(400).json({ message: `Unknown setting: ${req.params.key}` });
    }
    if (typeof value !== "string") {
      return res.status(400).json({ message: "value must be a string" });
    }
    await storage.setSetting(req.params.key, value);
    res.json({ key: req.params.key, value });
  });

  // ─── Dashboard Stats ──────────────────────────────────────────────

  app.get("/api/dashboard/stats", async (_req, res) => {
    const [items, transactions, clients] = await Promise.all([
      storage.getInventoryItems(),
      storage.getTransactions(),
      storage.getClients(),
    ]);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyOuts = transactions.filter(
      (t) => t.type === "OUT" && new Date(t.timestamp) >= weekAgo,
    );

    const categoryMap = new Map<string, number>();
    for (const item of items) {
      const cat = item.category || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.quantity);
    }

    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentTxIds = transactions
      .filter((t) => t.type === "OUT" && new Date(t.timestamp) >= monthAgo)
      .map((t) => t.id);

    const itemDistMap = new Map<string, { name: string; total: number }>();
    for (const txId of recentTxIds) {
      const txItems = await storage.getTransactionItems(txId);
      for (const ti of txItems) {
        const entry = itemDistMap.get(ti.inventoryItemId) || { name: ti.name, total: 0 };
        entry.total += ti.quantity;
        itemDistMap.set(ti.inventoryItemId, entry);
      }
    }
    const topItems = Array.from(itemDistMap.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    let pendingRequests = 0;
    let approvedReadyForPickup = 0;
    let todayRequests = 0;
    let expiredNoShowCount = 0;
    try {
      const [pending, ready, today, expired] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE status IN ('pending','under_review')`),
        pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE status IN ('approved','partially_approved','ready_for_pickup')`),
        pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at >= $1::timestamptz`, [todayStart]),
        pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE status IN ('expired','no_show') AND updated_at >= $1::timestamptz`, [weekAgo.toISOString()]),
      ]);
      pendingRequests = pending.rows[0]?.count ?? 0;
      approvedReadyForPickup = ready.rows[0]?.count ?? 0;
      todayRequests = today.rows[0]?.count ?? 0;
      expiredNoShowCount = expired.rows[0]?.count ?? 0;
    } catch {
      // stats are best-effort
    }

    res.json({
      weeklyVisits: weeklyOuts.length,
      categoryBreakdown: Array.from(categoryMap.entries()).map(([name, count]) => ({ name, count })),
      topDistributedItems: topItems,
      totalClients: clients.length,
      activeClients: clients.filter((c) => c.status === "active").length,
      pendingRequests,
      approvedReadyForPickup,
      todayRequests,
      expiredNoShowCount,
    });
  });

  // ─── 1. Public Inventory ─────────────────────────────────────────────

  app.get("/api/public/inventory", async (_req, res) => {
    const items = await storage.getInventoryItems();
    const available = items.filter((item: any) => {
      const reserved = item.reservedQuantity ?? 0;
      return item.quantity - reserved > 0;
    }).map((item: any) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity - (item.reservedQuantity ?? 0),
      allergens: item.allergens,
      reorderThreshold: item.reorderThreshold,
      weightPerUnitLbs: item.weightPerUnitLbs,
    }));
    res.json(available);
  });

  // ─── 2. Submit Request (staff / kiosk — identity typed on device) ────

  app.post("/api/requests", async (req, res) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors[0]?.message ?? "Invalid request data";
      const path = parsed.error.errors[0]?.path?.join(".");
      return res.status(400).json({ message: path ? `${path}: ${message}` : message });
    }
    try {
      const payload = await createFoodRequest(parsed.data, actorName(req));
      res.status(201).json(payload);
    } catch (err) {
      if (err instanceof RequestRateLimitError) {
        return res.status(429).json({ message: err.message });
      }
      throw err;
    }
  });

  // ─── 3. Lookup by Identifier (staff/kiosk history check) ─────────────

  app.get("/api/requests/lookup/:identifier", async (req, res) => {
    const rows = await storage.getRequestsByClientIdentifier(req.params.identifier);
    const withItems = await Promise.all(
      rows.map(async (r: any) => ({
        ...r,
        items: await storage.getRequestItems(r.id),
      })),
    );
    res.json(withItems);
  });

  // ─── 17. Analytics (MUST be before /api/requests/:id) ────────────────

  app.get("/api/requests/analytics", async (_req, res) => {
    try {
      const mostRequested = (await pool.query(`
        SELECT ri.item_name, ri.inventory_item_id, SUM(ri.requested_quantity)::int AS total_requested
        FROM request_items ri
        GROUP BY ri.inventory_item_id, ri.item_name
        ORDER BY total_requested DESC LIMIT 10
      `)).rows;

      const mostApproved = (await pool.query(`
        SELECT ri.item_name, ri.inventory_item_id, SUM(ri.approved_quantity)::int AS total_approved
        FROM request_items ri
        WHERE ri.approved_quantity > 0
        GROUP BY ri.inventory_item_id, ri.item_name
        ORDER BY total_approved DESC LIMIT 10
      `)).rows;

      const decidedRow = (await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('approved','partially_approved','completed'))::int AS approved_count,
          COUNT(*) FILTER (WHERE status = 'denied')::int AS denied_count,
          COUNT(*)::int AS total
        FROM requests WHERE status IN ('approved','partially_approved','completed','denied')
      `)).rows[0];
      const approvalRate = decidedRow?.total > 0 ? decidedRow.approved_count / decidedRow.total : 0;
      const denialRate = decidedRow?.total > 0 ? decidedRow.denied_count / decidedRow.total : 0;

      const noShowRow = (await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show_count,
          COUNT(*)::int AS total
        FROM requests WHERE status IN ('approved','partially_approved','completed','no_show','expired','ready_for_pickup')
      `)).rows[0];
      const noShowRate = noShowRow?.total > 0 ? noShowRow.no_show_count / noShowRow.total : 0;

      const avgDecisionRow = (await pool.query(`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600), 0)::float AS avg_hours
        FROM requests WHERE reviewed_at IS NOT NULL
      `)).rows[0];
      const avgDecisionTime = avgDecisionRow?.avg_hours ?? 0;

      const avgPickupRow = (await pool.query(`
        SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (fulfilled_at - reviewed_at)) / 3600), 0)::float AS avg_hours
        FROM requests WHERE fulfilled_at IS NOT NULL AND reviewed_at IS NOT NULL
      `)).rows[0];
      const avgPickupTime = avgPickupRow?.avg_hours ?? 0;

      const requestsByStatus = (await pool.query(`
        SELECT status, COUNT(*)::int AS count FROM requests GROUP BY status
      `)).rows;

      const topCategories = (await pool.query(`
        SELECT ri.item_category AS category, COUNT(*)::int AS count
        FROM request_items ri
        WHERE ri.item_category IS NOT NULL
        GROUP BY ri.item_category
        ORDER BY count DESC LIMIT 10
      `)).rows;

      const unmetDemand = (await pool.query(`
        SELECT ri.item_name, ri.inventory_item_id,
          (SUM(ri.requested_quantity) - SUM(COALESCE(ri.approved_quantity, 0)))::int AS unmet
        FROM request_items ri
        GROUP BY ri.inventory_item_id, ri.item_name
        HAVING SUM(ri.requested_quantity) - SUM(COALESCE(ri.approved_quantity, 0)) > 0
        ORDER BY unmet DESC LIMIT 10
      `)).rows;

      res.json({
        mostRequested,
        mostApproved,
        approvalRate,
        denialRate,
        noShowRate,
        avgDecisionTime,
        avgPickupTime,
        requestsByStatus,
        topCategories,
        unmetDemand,
      });
    } catch (err: any) {
      console.error("[requests/analytics] error:", err);
      res.json({
        mostRequested: [],
        mostApproved: [],
        approvalRate: 0,
        denialRate: 0,
        noShowRate: 0,
        avgDecisionTime: 0,
        avgPickupTime: 0,
        requestsByStatus: [],
        topCategories: [],
        unmetDemand: [],
      });
    }
  });

  // ─── 4. Admin List Requests ──────────────────────────────────────────

  app.get("/api/requests", async (req, res) => {
    // Auto-expire overdue requests
    try {
      const nowIso = new Date().toISOString();
      const expired = (await pool.query(
        `SELECT id FROM requests
         WHERE status IN ('approved','partially_approved','ready_for_pickup')
         AND pickup_deadline IS NOT NULL AND pickup_deadline < $1`,
        [nowIso],
      )).rows;

      for (const r of expired) {
        // Another request may have expired this row already, so skip it.
        if (!(await moveRequestStatus(r.id, "expired", PICKUP_STATUSES))) continue;
        await storage.createAuditLogEntry({
          requestId: r.id,
          action: "expired",
          details: "Auto-expired: pickup deadline passed",
          previousStatus: "approved",
          newStatus: "expired",
        });
      }
    } catch (err) {
      console.error("[requests] auto-expire error:", err);
    }

    const { status, dateFrom, dateTo, identifier, sort } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];

    if (status && typeof status === "string") {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (dateFrom && typeof dateFrom === "string") {
      params.push(dateFrom);
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (dateTo && typeof dateTo === "string") {
      params.push(dateTo);
      conditions.push(`created_at <= $${params.length}::timestamptz`);
    }
    if (identifier && typeof identifier === "string") {
      params.push(identifier);
      conditions.push(`client_identifier = $${params.length}`);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const order = sort === "oldest" ? "ASC" : "DESC";
    const { rows } = await pool.query(
      `SELECT id FROM requests${where} ORDER BY created_at ${order}`,
      params,
    );

    const withItems = await Promise.all(
      rows.map(async (r: any) => {
        const request = await storage.getRequest(r.id);
        return { ...request, items: await storage.getRequestItems(r.id) };
      }),
    );
    res.json(withItems);
  });

  // ─── 5. Request Detail ───────────────────────────────────────────────

  app.get("/api/requests/:id", async (req, res) => {
    const request = await getRequestPayload(req.params.id, { auditLog: true, clientHistory: true });
    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  });

  // ─── 6. Approve Request ──────────────────────────────────────────────

  app.post("/api/requests/:id/approve", async (req, res) => {
    try {
      const request = await storage.getRequest(req.params.id);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (!["pending", "under_review"].includes(request.status)) {
        return res.status(400).json({ message: `Cannot approve request with status '${request.status}'` });
      }

      const bodyResult = approveBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        return res
          .status(400)
          .json({ message: "Invalid data", errors: zodErrors(bodyResult.error) });
      }
      const { items: bodyItems, adminNote } = bodyResult.data;

      const requestItems = await storage.getRequestItems(req.params.id);
      const actor = actorName(req);

      const approvalMap = new Map<string, number>();
      if (Array.isArray(bodyItems)) {
        for (const bi of bodyItems) {
          approvalMap.set(bi.id, bi.approvedQuantity ?? 0);
        }
      }

      let isPartial = false;
      for (const ri of requestItems) {
        const approvedQty = approvalMap.has(ri.id) ? approvalMap.get(ri.id)! : ri.requestedQuantity;
        if (approvedQty < ri.requestedQuantity || approvedQty === 0) {
          isPartial = true;
          break;
        }
      }

      let expirationHours = 48;
      try {
        const setting = await storage.getSetting("requestExpirationHours");
        if (setting) expirationHours = parseInt(setting) || 48;
      } catch {
        // default stands
      }
      const deadline = new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString();
      const newStatus = isPartial ? "partially_approved" : "approved";

      // Atomic transaction: reserve inventory + update request + audit + notification.
      // The conditional UPDATE prevents TOCTOU double-approval oversells.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (const ri of requestItems) {
          const approvedQty = approvalMap.has(ri.id) ? approvalMap.get(ri.id)! : ri.requestedQuantity;

          if (approvedQty > 0) {
            const result = await client.query(
              `UPDATE inventory_items
               SET reserved_quantity = reserved_quantity + $1
               WHERE id = $2 AND (quantity - reserved_quantity) >= $1`,
              [approvedQty, ri.inventoryItemId],
            );

            if (result.rowCount === 0) {
              const invItem = (await client.query(
                "SELECT name, quantity, reserved_quantity FROM inventory_items WHERE id = $1",
                [ri.inventoryItemId],
              )).rows[0];
              if (!invItem) {
                throw new Error(`Inventory item ${ri.itemName} no longer exists`);
              }
              const available = invItem.quantity - (invItem.reserved_quantity || 0);
              throw new Error(`Insufficient stock for ${ri.itemName}. Available: ${available}, Requested: ${approvedQty}`);
            }

            await client.query(
              "UPDATE request_items SET approved_quantity = $1, reserved = true WHERE id = $2",
              [approvedQty, ri.id],
            );
          } else {
            await client.query(
              "UPDATE request_items SET approved_quantity = 0, reserved = false, denial_reason = $1 WHERE id = $2",
              ["Not approved", ri.id],
            );
          }
        }

        await client.query(
          `UPDATE requests SET status = $1, reviewed_at = now(), reviewed_by = $2, admin_note = $3, pickup_deadline = $4, updated_at = now()
           WHERE id = $5`,
          [newStatus, actor, adminNote || null, deadline, req.params.id],
        );

        await client.query(
          `INSERT INTO request_audit_log (request_id, action, details, actor, previous_status, new_status)
           VALUES ($1, 'approved', $2, $3, $4, $5)`,
          [req.params.id, isPartial ? "Partially approved" : "Fully approved", actor, request.status, newStatus],
        );

        await client.query(
          `INSERT INTO notifications (recipient_type, recipient_id, request_id, type, title, message)
           VALUES ('client', $1, $2, 'request_approved', 'Request Approved', $3)`,
          [
            request.clientIdentifier,
            req.params.id,
            isPartial
              ? "Your request has been partially approved. Please pick up by the deadline."
              : "Your request has been approved. Please pick up by the deadline.",
          ],
        );

        await client.query("COMMIT");
      } catch (err: any) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(409).json({ message: err.message || "Failed to reserve inventory" });
      }
      client.release();

      res.json(await getRequestPayload(req.params.id));
    } catch (err: any) {
      console.error("[approve] error:", err);
      res.status(500).json({ message: "Internal error approving request" });
    }
  });

  // ─── 7. Deny Request ─────────────────────────────────────────────────

  app.post("/api/requests/:id/deny", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["pending", "under_review"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot deny request with status '${request.status}'` });
    }

    const { adminNote } = req.body;
    if (!adminNote || typeof adminNote !== "string" || !adminNote.trim()) {
      return res.status(400).json({ message: "adminNote is required when denying a request" });
    }
    const actor = actorName(req);

    await storage.updateRequest(req.params.id, {
      status: "denied",
      adminNote: adminNote.trim(),
      reviewedAt: new Date(),
      reviewedBy: actor,
    });

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "denied",
      actor,
      details: adminNote.trim(),
      previousStatus: request.status,
      newStatus: "denied",
    });

    await storage.createNotification({
      requestId: req.params.id,
      recipientType: "client",
      recipientId: request.clientIdentifier,
      type: "request_denied",
      title: "Request Denied",
      message: `Your request has been denied. Reason: ${adminNote.trim()}`,
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 8. Fulfill Request ──────────────────────────────────────────────

  app.post("/api/requests/:id/fulfill", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot fulfill request with status '${request.status}'` });
    }

    const requestItems = (await storage.getRequestItems(req.params.id)).filter(
      (ri: any) => (ri.approvedQuantity ?? 0) > 0,
    );

    const bodyResult = fulfillBodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: zodErrors(bodyResult.error) });
    }
    const { items: bodyItems } = bodyResult.data;
    const fulfillMap = new Map<string, number>();
    if (Array.isArray(bodyItems)) {
      for (const bi of bodyItems) {
        fulfillMap.set(bi.id, bi.fulfilledQuantity);
      }
    }
    const actor = actorName(req);

    const client = await pool.connect();
    let txId: string;
    try {
      await client.query("BEGIN");

      const claimed = await client.query(
        `UPDATE requests SET status = 'completed', updated_at = now()
         WHERE id = $1 AND status = ANY($2) RETURNING id`,
        [req.params.id, PICKUP_STATUSES],
      );
      if (claimed.rowCount === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(409).json({ message: "This request was already changed" });
      }

      // The student's classification is copied onto the check out, only a listed value.
      const txResult = await client.query(
        `INSERT INTO transactions (type, timestamp, client_id, client_name, client_classification)
         VALUES ('OUT', now(), $1, $2,
           (SELECT classification FROM clients WHERE id = $1 AND classification = ANY($3::text[])))
         RETURNING id`,
        [request.clientId || null, request.clientName, CLASSIFICATIONS],
      );
      txId = txResult.rows[0].id;

      for (const ri of requestItems) {
        const approvedQty = ri.approvedQuantity ?? 0;
        const requestedFulfill = fulfillMap.has(ri.id) ? fulfillMap.get(ri.id)! : approvedQty;
        // Never distribute more than was approved, and never negative.
        const fulfilledQty = Math.max(0, Math.min(requestedFulfill, approvedQty));

        await client.query(
          "UPDATE inventory_items SET quantity = GREATEST(0, quantity - $1) WHERE id = $2",
          [fulfilledQty, ri.inventoryItemId],
        );
        await client.query(
          "UPDATE inventory_items SET reserved_quantity = GREATEST(0, reserved_quantity - $1) WHERE id = $2",
          [ri.approvedQuantity, ri.inventoryItemId],
        );
        await client.query(
          "UPDATE request_items SET fulfilled_quantity = $1, reserved = false WHERE id = $2",
          [fulfilledQty, ri.id],
        );

        const invItem = (await client.query(
          "SELECT weight_per_unit_lbs, value_per_unit_usd FROM inventory_items WHERE id = $1",
          [ri.inventoryItemId],
        )).rows[0];
        await client.query(
          `INSERT INTO transaction_items (transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [txId, ri.inventoryItemId, ri.itemName, fulfilledQty,
            invItem?.weight_per_unit_lbs || "0", invItem?.value_per_unit_usd || "0"],
        );
      }

      await client.query(
        `UPDATE requests SET status = 'completed', fulfilled_at = now(), transaction_id = $1, updated_at = now()
         WHERE id = $2`,
        [txId, req.params.id],
      );

      await client.query(
        `INSERT INTO request_audit_log (request_id, action, details, actor, previous_status, new_status)
         VALUES ($1, 'fulfilled', 'Request fulfilled and items distributed', $2, $3, 'completed')`,
        [req.params.id, actor, request.status],
      );

      await client.query(
        `INSERT INTO notifications (recipient_type, recipient_id, request_id, type, title, message)
         VALUES ('client', $1, $2, 'request_fulfilled', 'Request Completed', 'Your request has been fulfilled. Thank you!')`,
        [request.clientIdentifier, req.params.id],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    }
    client.release();

    const updated = await getRequestPayload(req.params.id) as Record<string, unknown>;
    const transaction = (await pool.query("SELECT * FROM transactions WHERE id = $1", [txId])).rows[0];
    res.json({ ...updated, transaction });
  });

  // ─── 9. Cancel Request ───────────────────────────────────────────────

  app.post("/api/requests/:id/cancel", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    const terminalStatuses = ["completed", "denied", "expired", "no_show", "cancelled"];
    if (terminalStatuses.includes(request.status)) {
      return res.status(400).json({ message: `Cannot cancel request with status '${request.status}'` });
    }

    if (!(await moveRequestStatus(req.params.id, "cancelled", OPEN_STATUSES))) {
      return res.status(409).json({ message: "This request was already changed" });
    }

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "cancelled",
      actor: actorName(req),
      details: "Request cancelled",
      previousStatus: request.status,
      newStatus: "cancelled",
    });

    await storage.createNotification({
      requestId: req.params.id,
      recipientType: "client",
      recipientId: request.clientIdentifier,
      type: "request_cancelled",
      title: "Request Cancelled",
      message: "Your request has been cancelled.",
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 10. No-Show ─────────────────────────────────────────────────────

  app.post("/api/requests/:id/no-show", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    const terminalStatuses = ["completed", "denied", "expired", "no_show", "cancelled"];
    if (terminalStatuses.includes(request.status)) {
      return res.status(400).json({ message: `Cannot mark no-show for request with status '${request.status}'` });
    }

    if (!(await moveRequestStatus(req.params.id, "no_show", OPEN_STATUSES))) {
      return res.status(409).json({ message: "This request was already changed" });
    }

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "no_show",
      actor: actorName(req),
      details: "Client did not pick up",
      previousStatus: request.status,
      newStatus: "no_show",
    });

    await storage.createNotification({
      requestId: req.params.id,
      recipientType: "client",
      recipientId: request.clientIdentifier,
      type: "request_no_show",
      title: "No-Show Recorded",
      message: "You were marked as a no-show for your request. Reserved items have been released.",
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 11. Extend Pickup Deadline ──────────────────────────────────────

  app.post("/api/requests/:id/extend", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot extend deadline for request with status '${request.status}'` });
    }

    const { newDeadline } = req.body;
    if (!newDeadline || typeof newDeadline !== "string") {
      return res.status(400).json({ message: "newDeadline (ISO string) is required" });
    }

    await storage.updateRequest(req.params.id, { pickupDeadline: newDeadline });

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "deadline_extended",
      actor: actorName(req),
      details: `Pickup deadline extended to ${newDeadline}`,
      previousStatus: request.status,
      newStatus: request.status,
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 12. Add Admin Note ──────────────────────────────────────────────

  app.post("/api/requests/:id/note", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    const { note } = req.body;
    if (!note || typeof note !== "string") {
      return res.status(400).json({ message: "note is required" });
    }

    await storage.updateRequest(req.params.id, { adminNote: note });

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "note_added",
      actor: actorName(req),
      details: note,
      previousStatus: request.status,
      newStatus: request.status,
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 13. Mark Under Review ───────────────────────────────────────────

  app.post("/api/requests/:id/review", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: `Cannot mark as under review from status '${request.status}'` });
    }

    await storage.updateRequest(req.params.id, { status: "under_review" });

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "review_started",
      actor: actorName(req),
      details: "Request marked as under review",
      previousStatus: "pending",
      newStatus: "under_review",
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 14. Mark Ready for Pickup ───────────────────────────────────────

  app.post("/api/requests/:id/ready", async (req, res) => {
    const request = await storage.getRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot mark as ready from status '${request.status}'` });
    }

    await storage.updateRequest(req.params.id, { status: "ready_for_pickup" });

    await storage.createAuditLogEntry({
      requestId: req.params.id,
      action: "ready_for_pickup",
      actor: actorName(req),
      details: "Items are ready for client pickup",
      previousStatus: request.status,
      newStatus: "ready_for_pickup",
    });

    await storage.createNotification({
      requestId: req.params.id,
      recipientType: "client",
      recipientId: request.clientIdentifier,
      type: "request_ready",
      title: "Ready for Pickup",
      message: "Your items are ready for pickup!",
    });

    res.json(await getRequestPayload(req.params.id));
  });

  // ─── 15. Get Notifications (staff view, by recipient) ────────────────

  app.get("/api/notifications/:recipientId", async (req, res) => {
    const notifications = await storage.getNotifications(req.params.recipientId);
    res.json(notifications);
  });

  // ─── 16. Mark Notification Read ──────────────────────────────────────

  app.post("/api/notifications/:id/read", async (req, res) => {
    await storage.markNotificationRead(req.params.id);
    res.json({ success: true });
  });

  // ─── Donor Management ─────────────────────────────────────────────

  async function donorTransactions(donorId: string, donorName: string) {
    const { rows } = await pool.query(
      `SELECT * FROM transactions
       WHERE type = 'IN' AND (donor_id = $1
         OR (donor_id IS NULL AND lower(btrim(regexp_replace(donor, '\\s+', ' ', 'g'))) = $2))
       ORDER BY timestamp DESC`,
      [donorId, normaliseDonorName(donorName)],
    );
    return rows;
  }

  async function transactionItemsFor(txId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM transaction_items WHERE transaction_id = $1",
      [txId],
    );
    return rows;
  }

  app.get("/api/donors", async (_req, res) => {
    const donors = await storage.getDonors();

    // Single aggregate query: one row per IN transaction with its item totals.
    // We match to donors in JS by donor_id OR donor name (the same OR the old
    // per-donor query used) — no nested donors×transactions×items round-trips.
    const aggRows = (
      await pool.query(
        `SELECT
           t.id        AS tx_id,
           t.donor_id  AS donor_id,
           t.donor     AS donor_name,
           t.timestamp AS ts,
           COALESCE(SUM(ti.quantity), 0)::int AS items,
           COALESCE(SUM(COALESCE(ti.weight_per_unit_lbs, 0) * ti.quantity), 0)::float AS weight,
           COALESCE(SUM(COALESCE(ti.value_per_unit_usd, 0) * ti.quantity), 0)::float AS value
         FROM transactions t
         LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
         WHERE t.type = 'IN'
         GROUP BY t.id, t.donor_id, t.donor, t.timestamp`,
      )
    ).rows;

    // Each row goes to one donor, by donor_id, or by a case blind name for old rows.
    const byDonor = new Map<string, any[]>();
    for (const r of aggRows) {
      const owner = attributeDonor({ donorId: r.donor_id, donor: r.donor_name }, donors as any[]);
      if (!owner) continue;
      const arr = byDonor.get(owner);
      if (arr) arr.push(r);
      else byDonor.set(owner, [r]);
    }

    const withStats = donors.map((d: any) => {
      const seen = new Set<string>();
      let totalItems = 0;
      let totalWeight = 0;
      let totalValue = 0;
      let totalDonations = 0;
      let lastTimestamp: any = null;

      const candidates = byDonor.get(d.id) ?? [];
      for (const r of candidates) {
        if (seen.has(r.tx_id)) continue; // dedupe when a tx matches by both id and name
        seen.add(r.tx_id);
        totalDonations += 1;
        totalItems += r.items || 0;
        totalWeight += r.weight || 0;
        totalValue += r.value || 0;
        if (r.ts && (!lastTimestamp || new Date(r.ts) > new Date(lastTimestamp))) {
          lastTimestamp = r.ts;
        }
      }

      return {
        ...d,
        totalDonations,
        totalItems,
        lastDonation: lastTimestamp,
        totalItemsDonated: totalItems,
        totalWeightDonated: Math.round(totalWeight * 100) / 100,
        totalValueDonated: Math.round(totalValue * 100) / 100,
        lastDonationDate: lastTimestamp,
      };
    });
    res.json(withStats);
  });

  // Who donated it, donors and partner organisations in one list for the picker.
  app.get("/api/donation-sources", async (_req, res) => {
    const [donors, clients] = await Promise.all([storage.getDonors(), storage.getClients()]);
    const partners = (clients as any[]).filter((c) => c.clientType === "partner");
    res.json(buildSourceOptions(donors as any[], partners));
  });

  app.get("/api/donors/:id/export", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = await donorTransactions(donor.id, donor.name);

    let totalItems = 0, totalWeight = 0, totalValue = 0;
    const lines: string[] = [];
    lines.push(csvRow([`Donor Report: ${donor.name}`]));
    if (donor.organization) lines.push(csvRow([`Organization: ${donor.organization}`]));
    lines.push(csvRow(["Generated", generatedValue(new Date())]));
    lines.push("");
    lines.push("Date,Items,Total Qty,Total Weight (lbs),Total Value ($)");
    for (const tx of txRows) {
      const items = await transactionItemsFor(tx.id);
      let qty = 0, wt = 0, val = 0;
      const names: string[] = [];
      for (const item of items) {
        qty += item.quantity || 0;
        wt += (parseFloat(item.weight_per_unit_lbs) || 0) * (item.quantity || 0);
        val += (parseFloat(item.value_per_unit_usd) || 0) * (item.quantity || 0);
        names.push(item.name);
      }
      totalItems += qty; totalWeight += wt; totalValue += val;
      const date = easternDate(tx.timestamp);
      lines.push(csvRow([date, names.join(", "), qty, Math.round(wt*100)/100, Math.round(val*100)/100]));
    }
    lines.push("");
    lines.push("Summary");
    lines.push(`Total Donations,${txRows.length}`);
    lines.push(`Total Items Donated,${totalItems}`);
    lines.push(`Total Weight,${Math.round(totalWeight*100)/100} lbs`);
    lines.push(`Total Value,$${Math.round(totalValue*100)/100}`);
    if (txRows.length > 0) {
      lines.push(`First Donation,${easternDate(txRows[txRows.length-1].timestamp)}`);
      lines.push(`Last Donation,${easternDate(txRows[0].timestamp)}`);
      lines.push(`Average Items Per Donation,${Math.round(totalItems/txRows.length*10)/10}`);
    }

    const csv = CSV_BOM + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="donor-${donor.name.replace(/[^a-z0-9]/gi, '-')}-report.csv"`);
    res.send(csv);
  });

  app.get("/api/donors/:id/history", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = await donorTransactions(donor.id, donor.name);

    const history = await Promise.all(txRows.map(async (tx: any) => {
      const rawItems = await transactionItemsFor(tx.id);
      const items = rawItems.map((item: any) => {
        const weightPerUnit = parseFloat(item.weight_per_unit_lbs) || 0;
        const valuePerUnit = parseFloat(item.value_per_unit_usd) || 0;
        const quantity = item.quantity || 0;
        return {
          id: item.id,
          inventoryItemId: item.inventory_item_id ?? null,
          name: item.name,
          quantity,
          weight: Math.round(weightPerUnit * quantity * 100) / 100,
          value: Math.round(valuePerUnit * quantity * 100) / 100,
        };
      });
      const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
      const totalWeight = Math.round(items.reduce((s, i) => s + i.weight, 0) * 100) / 100;
      const totalValue = Math.round(items.reduce((s, i) => s + i.value, 0) * 100) / 100;
      return {
        id: tx.id,
        type: tx.type,
        date: tx.timestamp,
        source: tx.source ?? null,
        donor: tx.donor ?? null,
        latitude: tx.latitude ?? null,
        longitude: tx.longitude ?? null,
        accuracy: tx.accuracy ?? null,
        items,
        totalQuantity,
        totalWeight,
        totalValue,
      };
    }));
    res.json(history);
  });

  app.get("/api/donors/:id", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = await donorTransactions(donor.id, donor.name);
    let totalItems = 0, totalWeight = 0, totalValue = 0;
    for (const tx of txRows) {
      const items = await transactionItemsFor(tx.id);
      for (const item of items) {
        totalItems += item.quantity || 0;
        totalWeight += (parseFloat(item.weight_per_unit_lbs) || 0) * (item.quantity || 0);
        totalValue += (parseFloat(item.value_per_unit_usd) || 0) * (item.quantity || 0);
      }
    }
    res.json({
      ...donor,
      totalDonations: txRows.length,
      totalItemsDonated: totalItems,
      totalWeightDonated: Math.round(totalWeight * 100) / 100,
      totalValueDonated: Math.round(totalValue * 100) / 100,
      lastDonationDate: txRows[0]?.timestamp ?? null,
      firstDonationDate: txRows.length > 0 ? txRows[txRows.length - 1].timestamp : null,
      averageDonationItems: txRows.length > 0 ? Math.round(totalItems / txRows.length * 10) / 10 : 0,
    });
  });

  app.post("/api/donors", async (req, res) => {
    const result = insertDonorSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    if (!result.data.name?.trim()) {
      return res.status(400).json({ message: "Donor name is required" });
    }
    await runIdempotent(req, res, async () => {
      const { donor, created } = await findOrCreateDonor(storage, result.data);
      return { status: created ? 201 : 200, body: donor };
    });
  });

  app.patch("/api/donors/:id", async (req, res) => {
    const result = insertDonorSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: zodErrors(result.error) });
    }
    const updated = await storage.updateDonor(req.params.id, result.data);
    if (!updated) return res.status(404).json({ message: "Donor not found" });
    res.json(updated);
  });

  app.delete("/api/donors/:id", async (req, res) => {
    const deleted = await storage.deleteDonor(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Donor not found" });
    res.json({ success: true });
  });

  // ─── Emergency Shop Appointment Reports ─────────────────────────────

  app.get("/api/reports/emergencies", async (_req, res) => {
    try {
      const perClient = (await pool.query(`
        SELECT
          COALESCE(t.client_id::text, '') AS client_id,
          COALESCE(c.name, t.client_name) AS client_name,
          COALESCE(c.identifier, '') AS client_identifier,
          COUNT(*)::int AS emergency_count,
          MAX(t.timestamp) AS last_emergency_at
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.type = 'OUT' AND t.is_emergency = true
        GROUP BY COALESCE(t.client_id::text, t.client_name), COALESCE(c.name, t.client_name), COALESCE(c.identifier, ''), COALESCE(t.client_id::text, '')
        ORDER BY emergency_count DESC, last_emergency_at DESC
      `)).rows;

      const totalEmergencies = (await pool.query(
        `SELECT COUNT(*)::int AS count FROM transactions WHERE type = 'OUT' AND is_emergency = true`,
      )).rows[0]?.count ?? 0;

      const flaggedStudents = perClient.filter((r) => r.emergency_count > 1);

      res.json({
        totalEmergencies,
        flaggedStudents,
        perClient,
      });
    } catch (err: any) {
      console.error("[reports/emergencies] error:", err);
      res.json({ totalEmergencies: 0, flaggedStudents: [], perClient: [] });
    }
  });

  // ─── Monthly Summary CSV ─────────────────────────────────────────────

  app.get("/api/reports/monthly-csv", async (req, res) => {
    try {
      const yearFilter = typeof req.query.year === "string" ? req.query.year : null;
      const includeEmergencyOnly = req.query.emergency === "1" || req.query.emergency === "true";

      const rows = (await pool.query(`
        SELECT
          t.id           AS tx_id,
          t.timestamp    AS ts,
          t.is_emergency AS is_emergency,
          t.client_name  AS client_name,
          ti.inventory_item_id AS inv_id,
          ti.name        AS item_name,
          ti.quantity    AS quantity,
          ti.weight_per_unit_lbs AS weight_per_unit,
          ti.value_per_unit_usd  AS value_per_unit,
          i.category     AS category
        FROM transactions t
        JOIN transaction_items ti ON ti.transaction_id = t.id
        LEFT JOIN inventory_items i ON i.id = ti.inventory_item_id
        WHERE t.type = 'OUT'
        ORDER BY t.timestamp ASC
      `)).rows;

      type ItemAgg = { quantity: number; costPerUnit: number; total: number };
      type CategoryAgg = { items: Map<string, ItemAgg>; total: number };
      type MonthAgg = { categories: Map<string, CategoryAgg>; total: number; emergencyCount: number };
      const yearMap = new Map<number, Map<number, MonthAgg>>();

      for (const r of rows) {
        if (includeEmergencyOnly && !r.is_emergency) continue;

        const ts = new Date(r.ts);
        if (Number.isNaN(ts.getTime())) continue;
        const year = ts.getFullYear();
        if (yearFilter && String(year) !== yearFilter) continue;
        const month = ts.getMonth() + 1;

        const qty = Number(r.quantity) || 0;
        const cost = parseFloat(r.value_per_unit) || 0;
        const lineTotal = qty * cost;
        const category = r.category || "Uncategorized";
        const itemName = r.item_name || "Unknown item";

        if (!yearMap.has(year)) yearMap.set(year, new Map());
        const monthsForYear = yearMap.get(year)!;
        if (!monthsForYear.has(month)) {
          monthsForYear.set(month, { categories: new Map(), total: 0, emergencyCount: 0 });
        }
        const monthAgg = monthsForYear.get(month)!;
        if (r.is_emergency) monthAgg.emergencyCount += 1;
        monthAgg.total += lineTotal;

        if (!monthAgg.categories.has(category)) {
          monthAgg.categories.set(category, { items: new Map(), total: 0 });
        }
        const catAgg = monthAgg.categories.get(category)!;
        catAgg.total += lineTotal;

        if (!catAgg.items.has(itemName)) {
          catAgg.items.set(itemName, { quantity: 0, costPerUnit: cost, total: 0 });
        }
        const itemAgg = catAgg.items.get(itemName)!;
        itemAgg.quantity += qty;
        if (cost > 0) itemAgg.costPerUnit = cost;
        itemAgg.total += lineTotal;
      }

      const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const lines: string[] = [];
      lines.push(`Morgan State FRC Monthly Summary${includeEmergencyOnly ? " (Emergency Shop Appointments only)" : ""}`);
      lines.push(monthlyGeneratedLine(new Date()));
      lines.push("");

      const sortedYears = Array.from(yearMap.keys()).sort();
      for (const year of sortedYears) {
        const months = yearMap.get(year)!;
        lines.push(`Year,${year}`);
        let yearTotal = 0;
        let yearEmergencies = 0;
        const sortedMonths = Array.from(months.keys()).sort((a, b) => a - b);
        for (const month of sortedMonths) {
          const monthAgg = months.get(month)!;
          yearTotal += monthAgg.total;
          yearEmergencies += monthAgg.emergencyCount;
          lines.push("");
          lines.push(`Month,${MONTH_NAMES[month - 1]} ${year}`);
          if (monthAgg.emergencyCount > 0) {
            lines.push(`Emergency Shop Appointments,${monthAgg.emergencyCount}`);
          }
          lines.push("Category,Item,Quantity,Cost per Unit,Line Total");
          const sortedCategories = Array.from(monthAgg.categories.keys()).sort();
          for (const category of sortedCategories) {
            const catAgg = monthAgg.categories.get(category)!;
            const sortedItems = Array.from(catAgg.items.entries()).sort((a, b) =>
              a[0].localeCompare(b[0]),
            );
            for (const [itemName, itemAgg] of sortedItems) {
              lines.push(monthlyItemLine(category, itemName, itemAgg.quantity, itemAgg.costPerUnit, itemAgg.total));
            }
            lines.push(monthlySubtotalLine(category, catAgg.total));
          }
          lines.push(`${MONTH_NAMES[month - 1]} ${year} total,,,,${monthAgg.total.toFixed(2)}`);
        }
        lines.push("");
        lines.push(`${year} GRAND TOTAL,,,,${yearTotal.toFixed(2)}`);
        if (yearEmergencies > 0) {
          lines.push(`${year} Emergency Shop Appointments,,,,${yearEmergencies}`);
        }
        lines.push("");
      }

      if (sortedYears.length === 0) {
        lines.push("No distribution records found for the selected filter.");
      }

      const csv = lines.join("\n");
      const filename = `frc-monthly-summary${yearFilter ? `-${yearFilter}` : ""}${includeEmergencyOnly ? "-emergencies" : ""}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err: any) {
      console.error("[reports/monthly-csv] error:", err);
      res.status(500).json({ message: "Failed to generate monthly summary" });
    }
  });
}
