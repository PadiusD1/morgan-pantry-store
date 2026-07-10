import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage, rawDb } from "./storage";
import { lookupBarcode } from "./barcode-lookup";
import {
  insertInventoryItemSchema,
  insertClientSchema,
  insertTransactionSchema,
  insertTransactionItemSchema,
  insertHouseholdMemberSchema,
  insertItemGroupSchema,
  insertItemGroupItemSchema,
} from "@shared/schema";

function mapRequestRow(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    clientId: row.client_id ?? null,
    clientName: row.client_name,
    clientIdentifier: row.client_identifier,
    clientEmail: row.client_email ?? null,
    clientPhone: row.client_phone ?? null,
    reason: row.reason,
    studentNote: row.student_note ?? null,
    status: row.status,
    adminNote: row.admin_note ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    pickupDeadline: row.pickup_deadline ?? null,
    fulfilledAt: row.fulfilled_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    transactionId: row.transaction_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRequestItemRow(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    requestId: row.request_id,
    inventoryItemId: row.inventory_item_id,
    itemName: row.item_name,
    itemCategory: row.item_category ?? null,
    requestedQuantity: row.requested_quantity,
    approvedQuantity: row.approved_quantity ?? null,
    fulfilledQuantity: row.fulfilled_quantity ?? null,
    reserved: row.reserved === 1 || row.reserved === true,
    denialReason: row.denial_reason ?? null,
  };
}

function mapAuditLogRow(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    actor: row.actor ?? null,
    details: row.details ?? null,
    previousStatus: row.previous_status ?? null,
    newStatus: row.new_status ?? null,
    createdAt: row.created_at,
  };
}

function mapNotificationRow(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    requestId: row.request_id ?? null,
    recipientType: row.recipient_type,
    recipientId: row.recipient_id,
    type: row.type,
    title: row.title,
    message: row.message,
    read: row.read === 1 || row.read === true,
    createdAt: row.created_at,
  };
}

function getRequestItemsPayload(requestId: string) {
  return (rawDb.prepare("SELECT * FROM request_items WHERE request_id = ?").all(requestId) as any[])
    .map(mapRequestItemRow);
}

function getRequestPayload(requestId: string, options: { auditLog?: boolean; clientHistory?: boolean } = {}) {
  const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(requestId) as any;
  if (!request) return undefined;
  const payload: any = {
    ...mapRequestRow(request),
    items: getRequestItemsPayload(requestId),
  };
  if (options.auditLog) {
    payload.auditLog = (rawDb.prepare(
      "SELECT * FROM request_audit_log WHERE request_id = ? ORDER BY created_at ASC",
    ).all(requestId) as any[]).map(mapAuditLogRow);
  }
  if (options.clientHistory) {
    payload.clientHistory = (rawDb.prepare(
      "SELECT * FROM requests WHERE client_identifier = ? ORDER BY created_at DESC",
    ).all(request.client_identifier) as any[]).map(mapRequestRow);
  }
  return payload;
}

function getHydratedItemGroupItems(groupId: string) {
  return (rawDb.prepare(`
    SELECT
      igi.id,
      igi.group_id,
      igi.inventory_item_id,
      igi.quantity,
      ii.name,
      ii.brand,
      ii.category
    FROM item_group_items igi
    LEFT JOIN inventory_items ii ON ii.id = igi.inventory_item_id
    WHERE igi.group_id = ?
    ORDER BY ii.name COLLATE NOCASE, igi.id
  `).all(groupId) as any[]).map((row) => ({
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

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ─── Auto-backfill weight from item names ──────────────────────────
  // Items created before weight-from-name parsing may have 0 weight
  // despite having weight info in their name (e.g. "Fries - 5.25oz").
  // Also backfills transaction items that recorded 0 weight.
  (async () => {
    const items = await storage.getInventoryItems();
    const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*-?\s*(oz|lb|lbs|g|kg)/i;
    for (const item of items) {
      const needsInventoryFix =
        item.weightPerUnitLbs === "0" && !item.netWeightG && WEIGHT_RE.test(item.name);

      // Determine correct weight — either already set or parsed from name
      let lbs: number | null = null;
      let grams: number | null = null;

      if (item.weightPerUnitLbs !== "0" && parseFloat(item.weightPerUnitLbs) > 0) {
        lbs = parseFloat(item.weightPerUnitLbs);
      } else if (WEIGHT_RE.test(item.name)) {
        const match = item.name.match(WEIGHT_RE)!;
        const val = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        grams = 0;
        if (unit === "oz") grams = val * 28.3495;
        else if (unit === "lb" || unit === "lbs") grams = val * 453.592;
        else if (unit === "g") grams = val;
        else if (unit === "kg") grams = val * 1000;
        if (grams > 0) {
          lbs = Math.round((grams / 453.592) * 10000) / 10000;
        }
      }

      // Backfill inventory item if needed
      if (needsInventoryFix && grams && lbs) {
        await storage.updateInventoryItem(item.id, {
          netWeightG: grams,
          unitWeightG: grams,
          weightPerUnitLbs: String(lbs),
        });
        console.log(`[backfill] ${item.name}: set weight to ${grams.toFixed(1)}g / ${lbs}lbs`);
      }

      // Always fix transaction items that still have 0 weight for this item
      if (lbs && lbs > 0) {
        const updated = rawDb.prepare(
          `UPDATE transaction_items SET weight_per_unit_lbs = ? WHERE inventory_item_id = ? AND (weight_per_unit_lbs = '0' OR weight_per_unit_lbs = '0.0000')`,
        ).run(String(lbs), item.id);
        if (updated.changes > 0) {
          console.log(`[backfill] Fixed ${updated.changes} transaction item(s) for ${item.name}`);
        }
      }
    }
  })();

  // ─── Barcode Lookup ──────────────────────────────────────────────────

  app.get("/api/barcode-lookup/:code", async (req, res) => {
    const code = req.params.code?.trim();
    if (!code) return res.status(400).json({ message: "Barcode is required" });

    // 1. Check if item already exists in our database
    const existing = await storage.getInventoryItemByBarcode(code);
    if (existing) {
      // Duplicate update: fill in any missing enrichment fields
      const updates: Record<string, unknown> = {};
      if (!existing.brand && req.query.brand) updates.brand = req.query.brand;
      // Return as-is (client can trigger re-enrichment separately)
      return res.json({
        status: "exists",
        item: existing,
        logs: [{ api: "local-db", status: "success", latencyMs: 0 }],
      });
    }

    // 2. Query external APIs
    let result;
    try {
      result = await lookupBarcode(code);
    } catch (err) {
      console.error(`[barcode-lookup] Unexpected error for ${code}:`, err);
      return res.json({
        status: "not_found",
        barcode: code,
        logs: [{ api: "all", status: "error", latencyMs: 0, error: String(err) }],
      });
    }

    if (result.found && result.product) {
      const p = result.product;

      // 3. Auto-create the item in our database with enriched data
      //    Race-safe: if another request already created this barcode, use existing.
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
        // UNIQUE constraint on barcode — another concurrent request already created it
        if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.message?.includes("UNIQUE constraint")) {
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

      // 4. Create pack components if detected
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

      // 5. Record initial price history if we have cost data
      if (p.costCents) {
        await storage.createPriceHistory({
          inventoryItemId: item.id,
          costCents: p.costCents,
          currency: p.currency,
          source: p.winningSource,
        });
      }

      // 6. Record initial weight history if we have weight data
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

    // 7. No match found
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
        .json({ message: "Invalid data", errors: result.error.errors });
    }
    const item = await storage.createInventoryItem(result.data);
    res.status(201).json(item);
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    const result = insertInventoryItemSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: result.error.errors });
    }
    const updated = await storage.updateInventoryItem(
      req.params.id,
      result.data,
    );
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // ─── Clients ─────────────────────────────────────────────────────────

  app.get("/api/clients", async (req, res) => {
    const clients = await storage.getClients();
    const typeFilter = typeof req.query.type === "string" ? req.query.type : null;
    if (typeFilter === "partner") {
      return res.json(clients.filter((c: any) => c.clientType === "partner"));
    }
    if (typeFilter === "student") {
      // Treat NULL/unset client_type as 'student' for backward compatibility
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
        .json({ message: "Invalid data", errors: result.error.errors });
    }

    try {
      const client = await storage.createClient(result.data);
      res.status(201).json(client);
    } catch (err: any) {
      // UNIQUE constraint on identifier — return clear error instead of 500
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.message?.includes("UNIQUE constraint")) {
        return res.status(409).json({
          message: `A client with identifier "${result.data.identifier}" already exists. Use a different identifier.`,
        });
      }
      throw err;
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    const result = insertClientSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: result.error.errors });
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

  app.get("/api/transactions", async (_req, res) => {
    const transactions = await storage.getTransactions();
    const withItems = await Promise.all(
      transactions.map(async (tx) => {
        const items = await storage.getTransactionItems(tx.id);
        return { ...tx, items };
      }),
    );
    res.json(withItems);
  });

  app.post("/api/transactions", async (req, res) => {
    const { items: rawItems, ...txBody } = req.body;

    // Coerce ISO timestamp strings to Date objects for Drizzle schema validation
    if (typeof txBody.timestamp === "string") {
      txBody.timestamp = new Date(txBody.timestamp);
    }

    const txResult = insertTransactionSchema.safeParse(txBody);
    if (!txResult.success) {
      return res
        .status(400)
        .json({ message: "Invalid data", errors: txResult.error.errors });
    }

    const transaction = await storage.createTransaction(txResult.data);

    const createdItems = [];
    if (Array.isArray(rawItems)) {
      for (const rawItem of rawItems) {
        // For OUT transactions: auto-create missing inventory items
        // and auto-adjust insufficient quantities
        if (txResult.data.type === "OUT" && rawItem.inventoryItemId) {
          try {
            const invItem = await storage.getInventoryItem(rawItem.inventoryItemId);
            if (!invItem) {
              // Item doesn't exist — create it with enough quantity for the checkout
              await storage.createInventoryItem({
                name: rawItem.name || "Unknown Item",
                category: "Uncategorized",
                quantity: rawItem.quantity || 1,
                weightPerUnitLbs: rawItem.weightPerUnitLbs || "0",
                valuePerUnitUsd: rawItem.valuePerUnitUsd || "0",
              });
            } else if (invItem.quantity < (rawItem.quantity || 0)) {
              // Insufficient stock — bump inventory to match checkout amount
              await storage.updateInventoryItem(invItem.id, {
                quantity: rawItem.quantity,
              });
            }
          } catch {
            // Ignore auto-adjust errors (e.g. race conditions) — let the transaction continue
          }
        }

        const itemResult = insertTransactionItemSchema.safeParse({
          ...rawItem,
          transactionId: transaction.id,
        });
        if (!itemResult.success) {
          return res
            .status(400)
            .json({ message: "Invalid item data", errors: itemResult.error.errors });
        }
        const created = await storage.createTransactionItem(itemResult.data);
        createdItems.push(created);
      }
    }

    res.status(201).json({ ...transaction, items: createdItems });
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
      return res.status(400).json({ message: "Invalid data", errors: result.error.errors });
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
    const withItems = groups.map((g) => ({ ...g, items: getHydratedItemGroupItems(g.id) }));
    res.json(withItems);
  });

  app.get("/api/item-groups/:id", async (req, res) => {
    const group = await storage.getItemGroup(req.params.id);
    if (!group) return res.status(404).json({ message: "Not found" });
    res.json({ ...group, items: getHydratedItemGroupItems(group.id) });
  });

  app.post("/api/item-groups", async (req, res) => {
    const { items: rawItems, ...groupBody } = req.body;
    const result = insertItemGroupSchema.safeParse(groupBody);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: result.error.errors });
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

    res.status(201).json({ ...group, items: getHydratedItemGroupItems(group.id) });
  });

  app.patch("/api/item-groups/:id", async (req, res) => {
    const { items: rawItems, ...groupBody } = req.body;
    const result = insertItemGroupSchema.partial().safeParse(groupBody);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid data", errors: result.error.errors });
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

      const replaceItems = rawDb.transaction(() => {
        rawDb.prepare("DELETE FROM item_group_items WHERE group_id = ?").run(updated.id);
        const insertItem = rawDb.prepare(`
          INSERT INTO item_group_items (id, group_id, inventory_item_id, quantity)
          VALUES (?, ?, ?, ?)
        `);
        for (const item of parsedItems) {
          insertItem.run(randomUUID(), item.groupId, item.inventoryItemId, item.quantity ?? 1);
        }
      });
      replaceItems();
    }

    res.json({ ...updated, items: getHydratedItemGroupItems(updated.id) });
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
      return res.status(400).json({ message: "Invalid data", errors: result.error.errors });
    }
    const item = await storage.createItemGroupItem(result.data);
    const hydrated = getHydratedItemGroupItems(group.id).find((i) => i.id === item.id) ?? item;
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

    // Weekly trend: last 7 days of OUT transactions
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyOuts = transactions.filter(
      (t) => t.type === "OUT" && new Date(t.timestamp) >= weekAgo,
    );

    // Category breakdown
    const categoryMap = new Map<string, number>();
    for (const item of items) {
      const cat = item.category || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.quantity);
    }

    // Top distributed items (last 30 days)
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

    // Request metrics (additive — does not modify anything above)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgoIso = weekAgo.toISOString();
    let pendingRequests = 0;
    let approvedReadyForPickup = 0;
    let todayRequests = 0;
    let expiredNoShowCount = 0;
    try {
      pendingRequests = (rawDb.prepare("SELECT COUNT(*) as count FROM requests WHERE status IN ('pending','under_review')").get() as any)?.count ?? 0;
      approvedReadyForPickup = (rawDb.prepare("SELECT COUNT(*) as count FROM requests WHERE status IN ('approved','partially_approved','ready_for_pickup')").get() as any)?.count ?? 0;
      todayRequests = (rawDb.prepare("SELECT COUNT(*) as count FROM requests WHERE created_at >= ?").get(todayStart) as any)?.count ?? 0;
      expiredNoShowCount = (rawDb.prepare("SELECT COUNT(*) as count FROM requests WHERE status IN ('expired','no_show') AND updated_at >= ?").get(weekAgoIso) as any)?.count ?? 0;
    } catch {
      // requests table may not exist yet — ignore
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

  // ─── Request Management System ─────────────────────────────────────

  // Helper: ensure request tables exist (auto-migrate)
  (() => {
    try {
      rawDb.exec(`
        ALTER TABLE inventory_items ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0;
      `);
    } catch { /* column already exists */ }

    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id                  TEXT PRIMARY KEY,
        client_name         TEXT NOT NULL,
        client_identifier   TEXT NOT NULL,
        client_email        TEXT,
        client_phone        TEXT,
        client_id           TEXT,
        reason              TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        admin_note          TEXT,
        reviewed_at         TEXT,
        reviewed_by         TEXT,
        pickup_deadline     TEXT,
        fulfilled_at        TEXT,
        cancelled_at        TEXT,
        transaction_id      TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS request_items (
        id                  TEXT PRIMARY KEY,
        request_id          TEXT NOT NULL,
        inventory_item_id   TEXT NOT NULL,
        item_name           TEXT NOT NULL,
        item_category       TEXT,
        requested_quantity  INTEGER NOT NULL,
        approved_quantity   INTEGER,
        fulfilled_quantity  INTEGER,
        denial_reason       TEXT,
        reserved            INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES requests(id),
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
      );

      CREATE TABLE IF NOT EXISTS request_audit_log (
        id                  TEXT PRIMARY KEY,
        request_id          TEXT NOT NULL,
        action              TEXT NOT NULL,
        details             TEXT,
        actor        TEXT,
        previous_status     TEXT,
        new_status          TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES requests(id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id                  TEXT PRIMARY KEY,
        recipient_id        TEXT NOT NULL,
        request_id          TEXT,
        type                TEXT NOT NULL,
        title               TEXT NOT NULL,
        message             TEXT NOT NULL,
        read                INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL
      );
    `);
  })();

  // ─── 1. Public Inventory ─────────────────────────────────────────────

  app.get("/api/public/inventory", async (_req, res) => {
    const items = await storage.getInventoryItems();
    const available = items.filter((item: any) => {
      const reserved = (item as any).reservedQuantity ?? 0;
      return item.quantity - reserved > 0;
    }).map((item: any) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity - ((item as any).reservedQuantity ?? 0),
      allergens: item.allergens,
      reorderThreshold: item.reorderThreshold,
      weightPerUnitLbs: item.weightPerUnitLbs,
    }));
    res.json(available);
  });

  // ─── 2. Submit Request ───────────────────────────────────────────────

  app.post("/api/requests", async (req, res) => {
    const { clientName, clientIdentifier, clientEmail, clientPhone, clientId, reason, items, studentNote } = req.body;

    // Validate required fields
    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return res.status(400).json({ message: "clientName is required" });
    }
    if (!clientIdentifier || typeof clientIdentifier !== "string" || !clientIdentifier.trim()) {
      return res.status(400).json({ message: "clientIdentifier is required" });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ message: "reason is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items array is required and must not be empty" });
    }
    for (const item of items) {
      if (!item.inventoryItemId || !item.itemName || !item.requestedQuantity || item.requestedQuantity < 1) {
        return res.status(400).json({ message: "Each item must have inventoryItemId, itemName, and requestedQuantity >= 1" });
      }
    }

    // Rate limit check
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayIso = todayMidnight.toISOString();
    const countRow = rawDb.prepare(
      "SELECT COUNT(*) as count FROM requests WHERE client_identifier = ? AND created_at >= ?"
    ).get(clientIdentifier.trim(), todayIso) as any;
    const todayCount = countRow?.count ?? 0;

    let maxRequestsPerDay = 5;
    try {
      const setting = await storage.getSetting("maxRequestsPerDay");
      if (setting) maxRequestsPerDay = parseInt(setting) || 5;
    } catch {}

    if (todayCount >= maxRequestsPerDay) {
      return res.status(429).json({ message: `Rate limit exceeded. Maximum ${maxRequestsPerDay} requests per day.` });
    }

    const now = new Date().toISOString();
    const requestId = randomUUID();

    // Create request
    rawDb.prepare(`
      INSERT INTO requests (id, client_name, client_identifier, client_email, client_phone, client_id, reason, student_note, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      requestId,
      clientName.trim(),
      clientIdentifier.trim(),
      clientEmail || null,
      clientPhone || null,
      clientId || null,
      reason.trim(),
      typeof studentNote === "string" && studentNote.trim() ? studentNote.trim() : null,
      now,
      now,
    );

    // Create request items
    for (const item of items) {
      const itemId = randomUUID();
      rawDb.prepare(`
        INSERT INTO request_items (id, request_id, inventory_item_id, item_name, item_category, requested_quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(itemId, requestId, item.inventoryItemId, item.itemName, item.itemCategory || null, item.requestedQuantity);
    }

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, previous_status, new_status, created_at)
      VALUES (?, ?, 'created', 'Request submitted', NULL, 'pending', ?)
    `).run(auditId, requestId, now);

    // Notification for requester
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_submitted', 'Request Submitted', 'Your request has been submitted and is pending review.', ?)
    `).run(notifId, 'client', clientIdentifier.trim(), requestId, now);

    res.status(201).json(getRequestPayload(requestId));
  });

  // ─── 3. Public Lookup by Identifier ──────────────────────────────────

  app.get("/api/requests/lookup/:identifier", async (req, res) => {
    const rows = rawDb.prepare(
      "SELECT * FROM requests WHERE client_identifier = ? ORDER BY created_at DESC"
    ).all(req.params.identifier) as any[];
    const withItems = rows.map((r: any) => ({
      ...mapRequestRow(r),
      items: getRequestItemsPayload(r.id),
    }));
    res.json(withItems);
  });

  // ─── 17. Analytics (MUST be before /api/requests/:id) ────────────────

  app.get("/api/requests/analytics", async (_req, res) => {
    try {
      const mostRequested = rawDb.prepare(`
        SELECT ri.item_name, ri.inventory_item_id, SUM(ri.requested_quantity) as total_requested
        FROM request_items ri
        GROUP BY ri.inventory_item_id, ri.item_name
        ORDER BY total_requested DESC LIMIT 10
      `).all();

      const mostApproved = rawDb.prepare(`
        SELECT ri.item_name, ri.inventory_item_id, SUM(ri.approved_quantity) as total_approved
        FROM request_items ri
        WHERE ri.approved_quantity > 0
        GROUP BY ri.inventory_item_id, ri.item_name
        ORDER BY total_approved DESC LIMIT 10
      `).all();

      const decidedRow = rawDb.prepare(`
        SELECT
          COUNT(CASE WHEN status IN ('approved','partially_approved','completed') THEN 1 END) as approved_count,
          COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_count,
          COUNT(*) as total
        FROM requests WHERE status IN ('approved','partially_approved','completed','denied')
      `).get() as any;
      const approvalRate = decidedRow?.total > 0 ? decidedRow.approved_count / decidedRow.total : 0;
      const denialRate = decidedRow?.total > 0 ? decidedRow.denied_count / decidedRow.total : 0;

      const noShowRow = rawDb.prepare(`
        SELECT
          COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show_count,
          COUNT(*) as total
        FROM requests WHERE status IN ('approved','partially_approved','completed','no_show','expired','ready_for_pickup')
      `).get() as any;
      const noShowRate = noShowRow?.total > 0 ? noShowRow.no_show_count / noShowRow.total : 0;

      const avgDecisionRow = rawDb.prepare(`
        SELECT AVG((julianday(reviewed_at) - julianday(created_at)) * 24) as avg_hours
        FROM requests WHERE reviewed_at IS NOT NULL
      `).get() as any;
      const avgDecisionTime = avgDecisionRow?.avg_hours ?? 0;

      const avgPickupRow = rawDb.prepare(`
        SELECT AVG((julianday(fulfilled_at) - julianday(reviewed_at)) * 24) as avg_hours
        FROM requests WHERE fulfilled_at IS NOT NULL AND reviewed_at IS NOT NULL
      `).get() as any;
      const avgPickupTime = avgPickupRow?.avg_hours ?? 0;

      const requestsByStatus = rawDb.prepare(`
        SELECT status, COUNT(*) as count FROM requests GROUP BY status
      `).all();

      const topCategories = rawDb.prepare(`
        SELECT ri.item_category as category, COUNT(*) as count
        FROM request_items ri
        WHERE ri.item_category IS NOT NULL
        GROUP BY ri.item_category
        ORDER BY count DESC LIMIT 10
      `).all();

      const unmetDemand = rawDb.prepare(`
        SELECT ri.item_name, ri.inventory_item_id,
          SUM(ri.requested_quantity) - SUM(COALESCE(ri.approved_quantity, 0)) as unmet
        FROM request_items ri
        GROUP BY ri.inventory_item_id, ri.item_name
        HAVING unmet > 0
        ORDER BY unmet DESC LIMIT 10
      `).all();

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
      let expirationHours = 48;
      try {
        const setting = await storage.getSetting("requestExpirationHours");
        if (setting) expirationHours = parseInt(setting) || 48;
      } catch {}

      const expired = rawDb.prepare(`
        SELECT id FROM requests
        WHERE status IN ('approved','partially_approved','ready_for_pickup')
        AND pickup_deadline IS NOT NULL AND pickup_deadline < ?
      `).all(nowIso) as any[];

      for (const r of expired) {
        const rItems = rawDb.prepare(
          `SELECT inventory_item_id, approved_quantity FROM request_items WHERE request_id = ? AND reserved = 1`
        ).all(r.id) as any[];
        for (const item of rItems) {
          rawDb.prepare(
            `UPDATE inventory_items SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?`
          ).run(item.approved_quantity, item.inventory_item_id);
        }
        rawDb.prepare(`UPDATE request_items SET reserved = 0 WHERE request_id = ?`).run(r.id);
        rawDb.prepare(`UPDATE requests SET status = 'expired', updated_at = ? WHERE id = ?`).run(nowIso, r.id);
        const auditId = randomUUID();
        rawDb.prepare(
          `INSERT INTO request_audit_log (id, request_id, action, details, previous_status, new_status, created_at)
           VALUES (?, ?, 'expired', 'Auto-expired: pickup deadline passed', 'approved', 'expired', ?)`
        ).run(auditId, r.id, nowIso);
      }
    } catch {}

    // Build query with filters
    const { status, dateFrom, dateTo, identifier, sort } = req.query;
    let sql = "SELECT * FROM requests WHERE 1=1";
    const params: any[] = [];

    if (status && typeof status === "string") {
      sql += " AND status = ?";
      params.push(status);
    }
    if (dateFrom && typeof dateFrom === "string") {
      sql += " AND created_at >= ?";
      params.push(dateFrom);
    }
    if (dateTo && typeof dateTo === "string") {
      sql += " AND created_at <= ?";
      params.push(dateTo);
    }
    if (identifier && typeof identifier === "string") {
      sql += " AND client_identifier = ?";
      params.push(identifier);
    }

    if (sort === "oldest") {
      sql += " ORDER BY created_at ASC";
    } else {
      sql += " ORDER BY created_at DESC";
    }

    const requests = rawDb.prepare(sql).all(...params) as any[];
    const withItems = requests.map((r: any) => ({
      ...mapRequestRow(r),
      items: getRequestItemsPayload(r.id),
    }));
    res.json(withItems);
  });

  // ─── 5. Request Detail ───────────────────────────────────────────────

  app.get("/api/requests/:id", async (req, res) => {
    const request = getRequestPayload(req.params.id, { auditLog: true, clientHistory: true });
    if (!request) return res.status(404).json({ message: "Request not found" });
    res.json(request);
  });

  // ─── 6. Approve Request ──────────────────────────────────────────────

  app.post("/api/requests/:id/approve", async (req, res) => {
    try {
      const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (!["pending", "under_review"].includes(request.status)) {
        return res.status(400).json({ message: `Cannot approve request with status '${request.status}'` });
      }

      const requestItems = rawDb.prepare("SELECT * FROM request_items WHERE request_id = ?").all(req.params.id) as any[];
      const { items: bodyItems, adminNote } = req.body;
      const now = new Date().toISOString();

      // Determine approved quantities per item
      const approvalMap = new Map<string, number>();
      if (Array.isArray(bodyItems)) {
        for (const bi of bodyItems) {
          approvalMap.set(bi.id, bi.approvedQuantity ?? 0);
        }
      }

      // Precompute: is this a partial approval? (must happen outside transaction for status)
      let isPartial = false;
      for (const ri of requestItems) {
        const approvedQty = approvalMap.has(ri.id) ? approvalMap.get(ri.id)! : ri.requested_quantity;
        if (approvedQty < ri.requested_quantity || approvedQty === 0) {
          isPartial = true;
          break;
        }
      }

      // Read expiration setting before the transaction (async calls can't be inside db.transaction)
      let expirationHours = 48;
      try {
        const setting = await storage.getSetting("requestExpirationHours");
        if (setting) expirationHours = parseInt(setting) || 48;
      } catch {}
      const deadline = new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString();
      const newStatus = isPartial ? "partially_approved" : "approved";

      // Atomic transaction: reserve inventory + update request + audit log + notification
      // Uses WHERE clause atomic reservation to prevent race conditions (double-approval oversells)
      const approveAtomic = rawDb.transaction(() => {
        for (const ri of requestItems) {
          const approvedQty = approvalMap.has(ri.id) ? approvalMap.get(ri.id)! : ri.requested_quantity;

          if (approvedQty > 0) {
            // CRITICAL: atomic availability check + reservation in one UPDATE
            // This prevents TOCTOU race where two concurrent approvals oversell inventory
            const result = rawDb.prepare(`
              UPDATE inventory_items
              SET reserved_quantity = reserved_quantity + ?
              WHERE id = ? AND (quantity - reserved_quantity) >= ?
            `).run(approvedQty, ri.inventory_item_id, approvedQty);

            if (result.changes === 0) {
              // Either item doesn't exist or insufficient available stock
              const invItem = rawDb.prepare("SELECT name, quantity, reserved_quantity FROM inventory_items WHERE id = ?").get(ri.inventory_item_id) as any;
              if (!invItem) {
                throw new Error(`Inventory item ${ri.item_name} no longer exists`);
              }
              const available = invItem.quantity - (invItem.reserved_quantity || 0);
              throw new Error(`Insufficient stock for ${ri.item_name}. Available: ${available}, Requested: ${approvedQty}`);
            }

            rawDb.prepare(
              "UPDATE request_items SET approved_quantity = ?, reserved = 1 WHERE id = ?"
            ).run(approvedQty, ri.id);
          } else {
            rawDb.prepare(
              "UPDATE request_items SET approved_quantity = 0, reserved = 0, denial_reason = ? WHERE id = ?"
            ).run("Not approved", ri.id);
          }
        }

        // Update request status
        rawDb.prepare(`
          UPDATE requests SET status = ?, reviewed_at = ?, reviewed_by = 'admin', admin_note = ?, pickup_deadline = ?, updated_at = ?
          WHERE id = ?
        `).run(newStatus, now, adminNote || null, deadline, now, req.params.id);

        // Audit log
        const auditId = randomUUID();
        rawDb.prepare(`
          INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
          VALUES (?, ?, 'approved', ?, 'admin', ?, ?, ?)
        `).run(auditId, req.params.id, isPartial ? "Partially approved" : "Fully approved", request.status, newStatus, now);

        // Notification
        const notifId = randomUUID();
        rawDb.prepare(`
          INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
          VALUES (?, ?, ?, ?, 'request_approved', 'Request Approved', ?, ?)
        `).run(notifId, 'client', request.client_identifier, req.params.id,
          isPartial ? "Your request has been partially approved. Please pick up by the deadline." : "Your request has been approved. Please pick up by the deadline.",
          now);
      });

      try {
        approveAtomic();
      } catch (err: any) {
        // Transaction auto-rolled back. Return conflict error.
        return res.status(409).json({ message: err.message || "Failed to reserve inventory" });
      }

      res.json(getRequestPayload(req.params.id));
    } catch (err: any) {
      console.error("[approve] error:", err);
      res.status(500).json({ message: "Internal error approving request" });
    }
  });

  // ─── 7. Deny Request ─────────────────────────────────────────────────

  app.post("/api/requests/:id/deny", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["pending", "under_review"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot deny request with status '${request.status}'` });
    }

    const { adminNote } = req.body;
    if (!adminNote || typeof adminNote !== "string" || !adminNote.trim()) {
      return res.status(400).json({ message: "adminNote is required when denying a request" });
    }

    const now = new Date().toISOString();
    rawDb.prepare(`
      UPDATE requests SET status = 'denied', admin_note = ?, reviewed_at = ?, reviewed_by = 'admin', updated_at = ?
      WHERE id = ?
    `).run(adminNote.trim(), now, now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'denied', ?, 'admin', ?, 'denied', ?)
    `).run(auditId, req.params.id, adminNote.trim(), request.status, now);

    // Notification
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_denied', 'Request Denied', ?, ?)
    `).run(notifId, 'client', request.client_identifier, req.params.id, `Your request has been denied. Reason: ${adminNote.trim()}`, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 8. Fulfill Request ──────────────────────────────────────────────

  app.post("/api/requests/:id/fulfill", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot fulfill request with status '${request.status}'` });
    }

    const requestItems = rawDb.prepare(
      "SELECT * FROM request_items WHERE request_id = ? AND approved_quantity > 0"
    ).all(req.params.id) as any[];

    const { items: bodyItems } = req.body || {};
    const fulfillMap = new Map<string, number>();
    if (Array.isArray(bodyItems)) {
      for (const bi of bodyItems) {
        fulfillMap.set(bi.id, bi.fulfilledQuantity);
      }
    }

    const now = new Date().toISOString();

    // Create transaction
    const txId = randomUUID();
    rawDb.prepare(`
      INSERT INTO transactions (id, type, timestamp, client_id, client_name, created_at)
      VALUES (?, 'OUT', ?, ?, ?, ?)
    `).run(txId, now, request.client_id || null, request.client_name, now);

    // Process each item
    for (const ri of requestItems) {
      const fulfilledQty = fulfillMap.has(ri.id) ? fulfillMap.get(ri.id)! : ri.approved_quantity;

      // Decrement inventory quantity
      rawDb.prepare(
        "UPDATE inventory_items SET quantity = MAX(0, quantity - ?) WHERE id = ?"
      ).run(fulfilledQty, ri.inventory_item_id);

      // Release reservation
      rawDb.prepare(
        "UPDATE inventory_items SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?"
      ).run(ri.approved_quantity, ri.inventory_item_id);

      // Update request item
      rawDb.prepare(
        "UPDATE request_items SET fulfilled_quantity = ?, reserved = 0 WHERE id = ?"
      ).run(fulfilledQty, ri.id);

      // Create transaction item
      const invItem = rawDb.prepare("SELECT * FROM inventory_items WHERE id = ?").get(ri.inventory_item_id) as any;
      const txItemId = randomUUID();
      rawDb.prepare(`
        INSERT INTO transaction_items (id, transaction_id, inventory_item_id, name, quantity, weight_per_unit_lbs, value_per_unit_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(txItemId, txId, ri.inventory_item_id, ri.item_name, fulfilledQty,
        invItem?.weight_per_unit_lbs || "0", invItem?.value_per_unit_usd || "0");
    }

    // Update request
    rawDb.prepare(`
      UPDATE requests SET status = 'completed', fulfilled_at = ?, transaction_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, txId, now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'fulfilled', 'Request fulfilled and items distributed', 'admin', ?, 'completed', ?)
    `).run(auditId, req.params.id, request.status, now);

    // Notification
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_fulfilled', 'Request Completed', 'Your request has been fulfilled. Thank you!', ?)
    `).run(notifId, 'client', request.client_identifier, req.params.id, now);

    const updated = getRequestPayload(req.params.id) as Record<string, unknown>;
    const transaction = rawDb.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
    res.json({ ...updated, transaction });
  });

  // ─── 9. Cancel Request ───────────────────────────────────────────────

  app.post("/api/requests/:id/cancel", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });

    const terminalStatuses = ["completed", "denied", "expired", "no_show", "cancelled"];
    if (terminalStatuses.includes(request.status)) {
      return res.status(400).json({ message: `Cannot cancel request with status '${request.status}'` });
    }

    const now = new Date().toISOString();

    // Release reservations if any
    if (["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      const reservedItems = rawDb.prepare(
        "SELECT * FROM request_items WHERE request_id = ? AND reserved = 1"
      ).all(req.params.id) as any[];
      for (const ri of reservedItems) {
        rawDb.prepare(
          "UPDATE inventory_items SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?"
        ).run(ri.approved_quantity, ri.inventory_item_id);
      }
      rawDb.prepare("UPDATE request_items SET reserved = 0 WHERE request_id = ?").run(req.params.id);
    }

    rawDb.prepare(`
      UPDATE requests SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'cancelled', 'Request cancelled', NULL, ?, 'cancelled', ?)
    `).run(auditId, req.params.id, request.status, now);

    // Notification
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_cancelled', 'Request Cancelled', 'Your request has been cancelled.', ?)
    `).run(notifId, 'client', request.client_identifier, req.params.id, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 10. No-Show ─────────────────────────────────────────────────────

  app.post("/api/requests/:id/no-show", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });

    const terminalStatuses = ["completed", "denied", "expired", "no_show", "cancelled"];
    if (terminalStatuses.includes(request.status)) {
      return res.status(400).json({ message: `Cannot mark no-show for request with status '${request.status}'` });
    }

    const now = new Date().toISOString();

    // Release reservations if any
    if (["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      const reservedItems = rawDb.prepare(
        "SELECT * FROM request_items WHERE request_id = ? AND reserved = 1"
      ).all(req.params.id) as any[];
      for (const ri of reservedItems) {
        rawDb.prepare(
          "UPDATE inventory_items SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?"
        ).run(ri.approved_quantity, ri.inventory_item_id);
      }
      rawDb.prepare("UPDATE request_items SET reserved = 0 WHERE request_id = ?").run(req.params.id);
    }

    rawDb.prepare(`
      UPDATE requests SET status = 'no_show', updated_at = ?
      WHERE id = ?
    `).run(now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'no_show', 'Client did not pick up', 'admin', ?, 'no_show', ?)
    `).run(auditId, req.params.id, request.status, now);

    // Notification
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_no_show', 'No-Show Recorded', 'You were marked as a no-show for your request. Reserved items have been released.', ?)
    `).run(notifId, 'client', request.client_identifier, req.params.id, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 11. Extend Pickup Deadline ──────────────────────────────────────

  app.post("/api/requests/:id/extend", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved", "ready_for_pickup"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot extend deadline for request with status '${request.status}'` });
    }

    const { newDeadline } = req.body;
    if (!newDeadline || typeof newDeadline !== "string") {
      return res.status(400).json({ message: "newDeadline (ISO string) is required" });
    }

    const now = new Date().toISOString();
    rawDb.prepare(`
      UPDATE requests SET pickup_deadline = ?, updated_at = ?
      WHERE id = ?
    `).run(newDeadline, now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'deadline_extended', ?, 'admin', ?, ?, ?)
    `).run(auditId, req.params.id, `Pickup deadline extended to ${newDeadline}`, request.status, request.status, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 12. Add Admin Note ──────────────────────────────────────────────

  app.post("/api/requests/:id/note", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });

    const { note } = req.body;
    if (!note || typeof note !== "string") {
      return res.status(400).json({ message: "note is required" });
    }

    const now = new Date().toISOString();
    rawDb.prepare(`
      UPDATE requests SET admin_note = ?, updated_at = ?
      WHERE id = ?
    `).run(note, now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'note_added', ?, 'admin', ?, ?, ?)
    `).run(auditId, req.params.id, note, request.status, request.status, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 13. Mark Under Review ───────────────────────────────────────────

  app.post("/api/requests/:id/review", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: `Cannot mark as under review from status '${request.status}'` });
    }

    const now = new Date().toISOString();
    rawDb.prepare(`
      UPDATE requests SET status = 'under_review', updated_at = ?
      WHERE id = ?
    `).run(now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'review_started', 'Request marked as under review', 'admin', 'pending', 'under_review', ?)
    `).run(auditId, req.params.id, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 14. Mark Ready for Pickup ───────────────────────────────────────

  app.post("/api/requests/:id/ready", async (req, res) => {
    const request = rawDb.prepare("SELECT * FROM requests WHERE id = ?").get(req.params.id) as any;
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (!["approved", "partially_approved"].includes(request.status)) {
      return res.status(400).json({ message: `Cannot mark as ready from status '${request.status}'` });
    }

    const now = new Date().toISOString();
    rawDb.prepare(`
      UPDATE requests SET status = 'ready_for_pickup', updated_at = ?
      WHERE id = ?
    `).run(now, req.params.id);

    // Audit log
    const auditId = randomUUID();
    rawDb.prepare(`
      INSERT INTO request_audit_log (id, request_id, action, details, actor, previous_status, new_status, created_at)
      VALUES (?, ?, 'ready_for_pickup', 'Items are ready for client pickup', 'admin', ?, 'ready_for_pickup', ?)
    `).run(auditId, req.params.id, request.status, now);

    // Notification
    const notifId = randomUUID();
    rawDb.prepare(`
      INSERT INTO notifications (id, recipient_type, recipient_id, request_id, type, title, message, created_at)
      VALUES (?, ?, ?, ?, 'request_ready', 'Ready for Pickup', 'Your items are ready for pickup!', ?)
    `).run(notifId, 'client', request.client_identifier, req.params.id, now);

    res.json(getRequestPayload(req.params.id));
  });

  // ─── 15. Get Notifications ───────────────────────────────────────────

  app.get("/api/notifications/:recipientId", async (req, res) => {
    const notifications = rawDb.prepare(
      "SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC"
    ).all(req.params.recipientId) as any[];
    res.json(notifications.map(mapNotificationRow));
  });

  // ─── 16. Mark Notification Read ──────────────────────────────────────

  app.post("/api/notifications/:id/read", async (req, res) => {
    rawDb.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ─── Donor Management ─────────────────────────────────────────────

  app.get("/api/donors", async (_req, res) => {
    const donors = await storage.getDonors();
    // Add computed stats for each donor
    const withStats = donors.map((d: any) => {
      const txRows = rawDb.prepare(
        "SELECT * FROM transactions WHERE type = 'IN' AND (donor_id = ? OR donor = ?) ORDER BY timestamp DESC"
      ).all(d.id, d.name) as any[];
      let totalItems = 0;
      let totalWeight = 0;
      let totalValue = 0;
      for (const tx of txRows) {
        const items = rawDb.prepare("SELECT * FROM transaction_items WHERE transaction_id = ?").all(tx.id) as any[];
        for (const item of items) {
          totalItems += item.quantity || 0;
          totalWeight += (parseFloat(item.weight_per_unit_lbs) || 0) * (item.quantity || 0);
          totalValue += (parseFloat(item.value_per_unit_usd) || 0) * (item.quantity || 0);
        }
      }
      const lastTimestamp = txRows[0]?.timestamp ?? null;
      return {
        ...d,
        totalDonations: txRows.length,
        // UI-facing short names (donors.tsx reads these)
        totalItems,
        lastDonation: lastTimestamp,
        // Long-form names kept for any existing readers
        totalItemsDonated: totalItems,
        totalWeightDonated: Math.round(totalWeight * 100) / 100,
        totalValueDonated: Math.round(totalValue * 100) / 100,
        lastDonationDate: lastTimestamp,
      };
    });
    res.json(withStats);
  });

  app.get("/api/donors/:id/export", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = rawDb.prepare(
      "SELECT * FROM transactions WHERE type = 'IN' AND (donor_id = ? OR donor = ?) ORDER BY timestamp DESC"
    ).all(donor.id, donor.name) as any[];

    let totalItems = 0, totalWeight = 0, totalValue = 0;
    const lines: string[] = [];
    lines.push(`Donor Report: ${donor.name}`);
    if (donor.organization) lines.push(`Organization: ${donor.organization}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("Date,Items,Total Qty,Total Weight (lbs),Total Value ($)");
    for (const tx of txRows) {
      const items = rawDb.prepare("SELECT * FROM transaction_items WHERE transaction_id = ?").all(tx.id) as any[];
      let qty = 0, wt = 0, val = 0;
      const names: string[] = [];
      for (const item of items) {
        qty += item.quantity || 0;
        wt += (parseFloat(item.weight_per_unit_lbs) || 0) * (item.quantity || 0);
        val += (parseFloat(item.value_per_unit_usd) || 0) * (item.quantity || 0);
        names.push(item.name);
      }
      totalItems += qty; totalWeight += wt; totalValue += val;
      const date = new Date(tx.timestamp).toLocaleDateString();
      lines.push(`${date},"${names.join(", ")}",${qty},${Math.round(wt*100)/100},${Math.round(val*100)/100}`);
    }
    lines.push("");
    lines.push("Summary");
    lines.push(`Total Donations,${txRows.length}`);
    lines.push(`Total Items Donated,${totalItems}`);
    lines.push(`Total Weight,${Math.round(totalWeight*100)/100} lbs`);
    lines.push(`Total Value,$${Math.round(totalValue*100)/100}`);
    if (txRows.length > 0) {
      lines.push(`First Donation,${new Date(txRows[txRows.length-1].timestamp).toLocaleDateString()}`);
      lines.push(`Last Donation,${new Date(txRows[0].timestamp).toLocaleDateString()}`);
      lines.push(`Average Items Per Donation,${Math.round(totalItems/txRows.length*10)/10}`);
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="donor-${donor.name.replace(/[^a-z0-9]/gi, '-')}-report.csv"`);
    res.send(csv);
  });

  app.get("/api/donors/:id/history", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = rawDb.prepare(
      "SELECT * FROM transactions WHERE type = 'IN' AND (donor_id = ? OR donor = ?) ORDER BY timestamp DESC"
    ).all(donor.id, donor.name) as any[];

    interface DonationHistoryItemOut {
      id: string;
      type: string;
      date: string;
      source: string | null;
      donor: string | null;
      latitude: number | null;
      longitude: number | null;
      accuracy: number | null;
      items: Array<{
        id: string;
        inventoryItemId: string | null;
        name: string;
        quantity: number;
        weight: number;
        value: number;
      }>;
      totalQuantity: number;
      totalWeight: number;
      totalValue: number;
    }

    const history: DonationHistoryItemOut[] = txRows.map((tx: any) => {
      const rawItems = rawDb
        .prepare("SELECT * FROM transaction_items WHERE transaction_id = ?")
        .all(tx.id) as any[];
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
    });
    res.json(history);
  });

  app.get("/api/donors/:id", async (req, res) => {
    const donor = await storage.getDonor(req.params.id);
    if (!donor) return res.status(404).json({ message: "Donor not found" });
    const txRows = rawDb.prepare(
      "SELECT * FROM transactions WHERE type = 'IN' AND (donor_id = ? OR donor = ?) ORDER BY timestamp DESC"
    ).all(donor.id, donor.name) as any[];
    let totalItems = 0, totalWeight = 0, totalValue = 0;
    for (const tx of txRows) {
      const items = rawDb.prepare("SELECT * FROM transaction_items WHERE transaction_id = ?").all(tx.id) as any[];
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
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Donor name is required" });
    const donor = await storage.createDonor(req.body);
    res.status(201).json(donor);
  });

  app.patch("/api/donors/:id", async (req, res) => {
    const updated = await storage.updateDonor(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Donor not found" });
    res.json(updated);
  });

  app.delete("/api/donors/:id", async (req, res) => {
    const deleted = await storage.deleteDonor(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Donor not found" });
    res.json({ success: true });
  });

  // ─── Emergency Shop Appointment Reports ─────────────────────────────
  //
  // Aggregates per-client emergency check-out counts so the UI can:
  //  - Flag students with more than one Emergency Shop Appointment
  //  - Show a dedicated "Emergencies" category in reports
  //
  app.get("/api/reports/emergencies", async (_req, res) => {
    try {
      // Per-client emergency totals (joined back to clients so we always have the latest name)
      const perClient = rawDb.prepare(`
        SELECT
          COALESCE(t.client_id, '') AS client_id,
          COALESCE(c.name, t.client_name) AS client_name,
          COALESCE(c.identifier, '') AS client_identifier,
          COUNT(*) AS emergency_count,
          MAX(t.timestamp) AS last_emergency_at
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.type = 'OUT' AND t.is_emergency = 1
        GROUP BY COALESCE(t.client_id, t.client_name)
        ORDER BY emergency_count DESC, last_emergency_at DESC
      `).all() as any[];

      const totalEmergencies = (rawDb.prepare(
        "SELECT COUNT(*) as count FROM transactions WHERE type = 'OUT' AND is_emergency = 1",
      ).get() as any)?.count ?? 0;

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
  //
  // Returns a CSV report grouped by month with:
  //   - Per-item subtotals (units distributed, cost per unit, line total)
  //   - Per-category subtotals
  //   - Monthly totals
  //   - A year-end bottom line with the grand total per year
  //
  app.get("/api/reports/monthly-csv", async (req, res) => {
    try {
      const yearFilter = typeof req.query.year === "string" ? req.query.year : null;
      const includeEmergencyOnly = req.query.emergency === "1" || req.query.emergency === "true";

      // Pull all OUT transactions + their line items + inventory category in one shot
      const rows = rawDb.prepare(`
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
      `).all() as any[];

      // year → month (1-12) → { categories: Map<category, Map<itemName, {qty,costPerUnit,total}>>, total, emergencyCount }
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
        // Keep the most recently observed unit cost (price history isn't joined here)
        if (cost > 0) itemAgg.costPerUnit = cost;
        itemAgg.total += lineTotal;
      }

      // Build CSV
      const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const lines: string[] = [];
      lines.push(`Morgan State FRC Monthly Summary${includeEmergencyOnly ? " (Emergency Shop Appointments only)" : ""}`);
      lines.push(`Generated,${new Date().toLocaleString()}`);
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
              lines.push([
                csvEscape(category),
                csvEscape(itemName),
                itemAgg.quantity.toString(),
                itemAgg.costPerUnit.toFixed(2),
                itemAgg.total.toFixed(2),
              ].join(","));
            }
            lines.push(`${csvEscape(category)} subtotal,,,,${catAgg.total.toFixed(2)}`);
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

  return httpServer;
}

// ─── CSV helpers ──────────────────────────────────────────────────────
function csvEscape(value: string): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
