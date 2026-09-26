/**
 * PgStorage – Postgres (Supabase) implementation of IStorage via drizzle-orm.
 *
 * Conventions:
 * - Creates use .returning(); the DB generates uuids and timestamps.
 * - Deletes use .returning() length for the boolean result.
 * - Native pg types throughout: string[] for text[] columns, objects for
 *   jsonb, booleans as booleans, Date for timestamptz. numeric columns
 *   (weightPerUnitLbs, valuePerUnitUsd) stay strings — drizzle numeric = string.
 * - Human-facing lists sort with ORDER BY lower(name) for stable ordering
 *   regardless of DB collation.
 */

import { eq, and, gte, lte, desc, asc, sql, count, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DonorStore } from "./donor-find-or-create";
import {
  users,
  inventoryItems,
  clients,
  householdMembers,
  itemGroups,
  itemGroupItems,
  donors,
  settings,
  transactions,
  transactionItems,
  packComponents,
  priceHistory,
  weightHistory,
  requests,
  requestItems,
  requestAuditLog,
  notifications,
  type User,
  type InsertUser,
  type InventoryItem,
  type InsertInventoryItem,
  type Client,
  type InsertClient,
  type Transaction,
  type InsertTransaction,
  type TransactionItem,
  type InsertTransactionItem,
  type PackComponent,
  type InsertPackComponent,
  type PriceHistory,
  type InsertPriceHistory,
  type WeightHistory,
  type InsertWeightHistory,
  type HouseholdMember,
  type InsertHouseholdMember,
  type ItemGroup,
  type InsertItemGroup,
  type ItemGroupItem,
  type InsertItemGroupItem,
  type Donor,
  type InsertDonor,
} from "@shared/schema";
import type { IStorage } from "./storage";
import { db } from "./pg";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Routes pass timestamps as Date or ISO string; drizzle timestamptz wants Date. */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Like asDate but preserves null/undefined as SQL NULL. */
function asNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/** True when at least one key of a partial update carries a defined value. */
function hasDefinedValues(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((v) => v !== undefined);
}

type RequestUpdate = Partial<typeof requests.$inferInsert>;
type RequestItemUpdate = Partial<typeof requestItems.$inferInsert>;

// ═════════════════════════════════════════════════════════════════════════════

export class PgStorage implements IStorage {
  // ─── Users ─────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    return row;
  }

  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(sql`lower(${users.name})`);
  }

  async createUser(insert: InsertUser): Promise<User> {
    const [row] = await db.insert(users).values(insert).returning();
    return row;
  }

  async updateUser(
    id: string,
    partial: Partial<InsertUser>,
  ): Promise<User | undefined> {
    if (!hasDefinedValues(partial)) return this.getUser(id);
    const [row] = await db
      .update(users)
      .set(partial)
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  async deleteUser(id: string): Promise<boolean> {
    // requests.user_id has no ON DELETE action — detach requests first so
    // student request history survives account removal.
    return db.transaction(async (tx) => {
      await tx
        .update(requests)
        .set({ userId: null })
        .where(eq(requests.userId, id));
      const deleted = await tx
        .delete(users)
        .where(eq(users.id, id))
        .returning({ id: users.id });
      return deleted.length > 0;
    });
  }

  // ─── Inventory ─────────────────────────────────────────────────────────

  async getInventoryItems(): Promise<InventoryItem[]> {
    return db
      .select()
      .from(inventoryItems)
      .orderBy(sql`lower(${inventoryItems.name})`);
  }

  async getInventoryItem(id: string): Promise<InventoryItem | undefined> {
    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, id));
    return row;
  }

  async getInventoryItemByBarcode(
    barcode: string,
  ): Promise<InventoryItem | undefined> {
    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.barcode, barcode));
    return row;
  }

  async createInventoryItem(
    insert: InsertInventoryItem,
  ): Promise<InventoryItem> {
    const [row] = await db.insert(inventoryItems).values(insert).returning();
    return row;
  }

  async updateInventoryItem(
    id: string,
    partial: Partial<InsertInventoryItem>,
  ): Promise<InventoryItem | undefined> {
    if (!hasDefinedValues(partial)) return this.getInventoryItem(id);
    const [row] = await db
      .update(inventoryItems)
      .set(partial)
      .where(eq(inventoryItems.id, id))
      .returning();
    return row;
  }

  // ─── Clients ───────────────────────────────────────────────────────────

  async getClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(sql`lower(${clients.name})`);
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [row] = await db.select().from(clients).where(eq(clients.id, id));
    return row;
  }

  async getClientByIdentifier(identifier: string): Promise<Client | undefined> {
    const [row] = await db
      .select()
      .from(clients)
      .where(eq(clients.identifier, identifier));
    return row;
  }

  async createClient(insert: InsertClient): Promise<Client> {
    const [row] = await db.insert(clients).values(insert).returning();
    return row;
  }

  async updateClient(
    id: string,
    partial: Partial<InsertClient>,
  ): Promise<Client | undefined> {
    if (!hasDefinedValues(partial)) return this.getClient(id);
    const [row] = await db
      .update(clients)
      .set(partial)
      .where(eq(clients.id, id))
      .returning();
    return row;
  }

  async deleteClient(id: string): Promise<boolean> {
    // Atomic: detach historical records, remove household, delete client.
    return db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ clientId: null })
        .where(eq(transactions.clientId, id));
      await tx
        .update(requests)
        .set({ clientId: null })
        .where(eq(requests.clientId, id));
      await tx
        .delete(householdMembers)
        .where(eq(householdMembers.clientId, id));
      const deleted = await tx
        .delete(clients)
        .where(eq(clients.id, id))
        .returning({ id: clients.id });
      return deleted.length > 0;
    });
  }

  // ─── Transactions ──────────────────────────────────────────────────────

  async getTransactions(): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt));
  }

  async createTransaction(insert: InsertTransaction): Promise<Transaction> {
    const [row] = await db
      .insert(transactions)
      .values({
        ...insert,
        // Routes may hand an ISO string despite the type; DB default covers omission.
        timestamp: insert.timestamp ? asDate(insert.timestamp) : undefined,
      })
      .returning();
    return row;
  }

  // ─── Transaction Items ─────────────────────────────────────────────────

  async getTransactionItems(transactionId: string): Promise<TransactionItem[]> {
    return db
      .select()
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, transactionId));
  }

  async createTransactionItem(
    insert: InsertTransactionItem,
  ): Promise<TransactionItem> {
    const [row] = await db.insert(transactionItems).values(insert).returning();
    return row;
  }

  // ─── Pack Components ───────────────────────────────────────────────────

  async getPackComponents(parentItemId: string): Promise<PackComponent[]> {
    return db
      .select()
      .from(packComponents)
      .where(eq(packComponents.parentItemId, parentItemId));
  }

  async createPackComponent(
    insert: InsertPackComponent,
  ): Promise<PackComponent> {
    const [row] = await db.insert(packComponents).values(insert).returning();
    return row;
  }

  // ─── Price History ─────────────────────────────────────────────────────

  async getPriceHistory(inventoryItemId: string): Promise<PriceHistory[]> {
    return db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.inventoryItemId, inventoryItemId))
      .orderBy(desc(priceHistory.recordedAt));
  }

  async createPriceHistory(insert: InsertPriceHistory): Promise<PriceHistory> {
    const [row] = await db
      .insert(priceHistory)
      .values({
        ...insert,
        recordedAt: insert.recordedAt ? asDate(insert.recordedAt) : undefined,
      })
      .returning();
    return row;
  }

  // ─── Weight History ────────────────────────────────────────────────────

  async getWeightHistory(inventoryItemId: string): Promise<WeightHistory[]> {
    return db
      .select()
      .from(weightHistory)
      .where(eq(weightHistory.inventoryItemId, inventoryItemId))
      .orderBy(desc(weightHistory.recordedAt));
  }

  async createWeightHistory(
    insert: InsertWeightHistory,
  ): Promise<WeightHistory> {
    const [row] = await db
      .insert(weightHistory)
      .values({
        ...insert,
        recordedAt: insert.recordedAt ? asDate(insert.recordedAt) : undefined,
      })
      .returning();
    return row;
  }

  // ─── Household Members ─────────────────────────────────────────────────

  async getHouseholdMembers(clientId: string): Promise<HouseholdMember[]> {
    return db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.clientId, clientId))
      .orderBy(sql`lower(${householdMembers.name})`);
  }

  async createHouseholdMember(
    insert: InsertHouseholdMember,
  ): Promise<HouseholdMember> {
    const [row] = await db.insert(householdMembers).values(insert).returning();
    return row;
  }

  async deleteHouseholdMember(id: string): Promise<boolean> {
    const deleted = await db
      .delete(householdMembers)
      .where(eq(householdMembers.id, id))
      .returning({ id: householdMembers.id });
    return deleted.length > 0;
  }

  // ─── Item Groups ───────────────────────────────────────────────────────

  async getItemGroups(): Promise<ItemGroup[]> {
    return db
      .select()
      .from(itemGroups)
      .orderBy(sql`lower(${itemGroups.name})`);
  }

  async getItemGroup(id: string): Promise<ItemGroup | undefined> {
    const [row] = await db
      .select()
      .from(itemGroups)
      .where(eq(itemGroups.id, id));
    return row;
  }

  async createItemGroup(insert: InsertItemGroup): Promise<ItemGroup> {
    const [row] = await db.insert(itemGroups).values(insert).returning();
    return row;
  }

  async updateItemGroup(
    id: string,
    partial: Partial<InsertItemGroup>,
  ): Promise<ItemGroup | undefined> {
    if (!hasDefinedValues(partial)) return this.getItemGroup(id);
    const [row] = await db
      .update(itemGroups)
      .set(partial)
      .where(eq(itemGroups.id, id))
      .returning();
    return row;
  }

  async deleteItemGroup(id: string): Promise<boolean> {
    // item_group_items rows go with it via ON DELETE CASCADE.
    const deleted = await db
      .delete(itemGroups)
      .where(eq(itemGroups.id, id))
      .returning({ id: itemGroups.id });
    return deleted.length > 0;
  }

  // ─── Item Group Items ──────────────────────────────────────────────────

  async getItemGroupItems(groupId: string): Promise<ItemGroupItem[]> {
    return db
      .select()
      .from(itemGroupItems)
      .where(eq(itemGroupItems.groupId, groupId));
  }

  async createItemGroupItem(
    insert: InsertItemGroupItem,
  ): Promise<ItemGroupItem> {
    const [row] = await db.insert(itemGroupItems).values(insert).returning();
    return row;
  }

  async deleteItemGroupItem(id: string): Promise<boolean> {
    const deleted = await db
      .delete(itemGroupItems)
      .where(eq(itemGroupItems.id, id))
      .returning({ id: itemGroupItems.id });
    return deleted.length > 0;
  }

  // ─── Settings ──────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | undefined> {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key));
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ─── Requests ──────────────────────────────────────────────────────────

  async getRequests(filters?: {
    status?: string;
    clientIdentifier?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<any[]> {
    const conditions: SQL[] = [];
    if (filters?.status) {
      conditions.push(eq(requests.status, filters.status));
    }
    if (filters?.clientIdentifier) {
      conditions.push(eq(requests.clientIdentifier, filters.clientIdentifier));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(requests.createdAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(requests.createdAt, new Date(filters.dateTo)));
    }
    return db
      .select()
      .from(requests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(requests.createdAt));
  }

  async getRequest(id: string): Promise<any | undefined> {
    const [row] = await db.select().from(requests).where(eq(requests.id, id));
    return row;
  }

  async createRequest(data: any): Promise<any> {
    const [row] = await db
      .insert(requests)
      .values({
        clientId: data.clientId ?? null,
        userId: data.userId ?? null,
        clientName: data.clientName,
        clientIdentifier: data.clientIdentifier,
        clientEmail: data.clientEmail ?? null,
        clientPhone: data.clientPhone ?? null,
        reason: data.reason,
        studentNote: data.studentNote ?? null,
        status: data.status ?? "pending",
        adminNote: data.adminNote ?? null,
        reviewedBy: data.reviewedBy ?? null,
        reviewedAt: asNullableDate(data.reviewedAt),
        pickupDeadline: data.pickupDeadline ?? null,
        fulfilledAt: asNullableDate(data.fulfilledAt),
        cancelledAt: asNullableDate(data.cancelledAt),
        transactionId: data.transactionId ?? null,
      })
      .returning();
    return row;
  }

  async updateRequest(id: string, data: any): Promise<any | undefined> {
    const set: RequestUpdate = {};
    if (data.clientId !== undefined) set.clientId = data.clientId;
    if (data.userId !== undefined) set.userId = data.userId;
    if (data.clientName !== undefined) set.clientName = data.clientName;
    if (data.clientIdentifier !== undefined)
      set.clientIdentifier = data.clientIdentifier;
    if (data.clientEmail !== undefined) set.clientEmail = data.clientEmail;
    if (data.clientPhone !== undefined) set.clientPhone = data.clientPhone;
    if (data.reason !== undefined) set.reason = data.reason;
    if (data.studentNote !== undefined) set.studentNote = data.studentNote;
    if (data.status !== undefined) set.status = data.status;
    if (data.adminNote !== undefined) set.adminNote = data.adminNote;
    if (data.reviewedBy !== undefined) set.reviewedBy = data.reviewedBy;
    if (data.reviewedAt !== undefined)
      set.reviewedAt = asNullableDate(data.reviewedAt);
    if (data.pickupDeadline !== undefined)
      set.pickupDeadline = data.pickupDeadline;
    if (data.fulfilledAt !== undefined)
      set.fulfilledAt = asNullableDate(data.fulfilledAt);
    if (data.cancelledAt !== undefined)
      set.cancelledAt = asNullableDate(data.cancelledAt);
    if (data.transactionId !== undefined)
      set.transactionId = data.transactionId;

    if (!hasDefinedValues(set)) return this.getRequest(id);
    const [row] = await db
      .update(requests)
      .set(set)
      .where(eq(requests.id, id))
      .returning();
    return row;
  }

  async getRequestsByClientIdentifier(identifier: string): Promise<any[]> {
    return db
      .select()
      .from(requests)
      .where(eq(requests.clientIdentifier, identifier))
      .orderBy(desc(requests.createdAt));
  }

  async getRequestsByUserId(userId: string): Promise<any[]> {
    return db
      .select()
      .from(requests)
      .where(eq(requests.userId, userId))
      .orderBy(desc(requests.createdAt));
  }

  async getRequestCountSince(identifier: string, since: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(requests)
      .where(
        and(
          eq(requests.clientIdentifier, identifier),
          gte(requests.createdAt, new Date(since)),
        ),
      );
    return row?.value ?? 0;
  }

  // ─── Request Items ─────────────────────────────────────────────────────

  async getRequestItems(requestId: string): Promise<any[]> {
    return db
      .select()
      .from(requestItems)
      .where(eq(requestItems.requestId, requestId));
  }

  async createRequestItem(data: any): Promise<any> {
    const [row] = await db
      .insert(requestItems)
      .values({
        requestId: data.requestId,
        inventoryItemId: data.inventoryItemId,
        itemName: data.itemName,
        itemCategory: data.itemCategory ?? null,
        requestedQuantity: data.requestedQuantity,
        approvedQuantity: data.approvedQuantity ?? null,
        fulfilledQuantity: data.fulfilledQuantity ?? null,
        reserved: Boolean(data.reserved),
        denialReason: data.denialReason ?? null,
      })
      .returning();
    return row;
  }

  async updateRequestItem(id: string, data: any): Promise<any | undefined> {
    const set: RequestItemUpdate = {};
    if (data.approvedQuantity !== undefined)
      set.approvedQuantity = data.approvedQuantity;
    if (data.fulfilledQuantity !== undefined)
      set.fulfilledQuantity = data.fulfilledQuantity;
    if (data.reserved !== undefined) set.reserved = Boolean(data.reserved);
    if (data.denialReason !== undefined) set.denialReason = data.denialReason;

    if (!hasDefinedValues(set)) return undefined;
    const [row] = await db
      .update(requestItems)
      .set(set)
      .where(eq(requestItems.id, id))
      .returning();
    return row;
  }

  // ─── Request Audit Log ─────────────────────────────────────────────────

  async getRequestAuditLog(requestId: string): Promise<any[]> {
    return db
      .select()
      .from(requestAuditLog)
      .where(eq(requestAuditLog.requestId, requestId))
      .orderBy(asc(requestAuditLog.createdAt));
  }

  async createAuditLogEntry(data: any): Promise<any> {
    const [row] = await db
      .insert(requestAuditLog)
      .values({
        requestId: data.requestId,
        action: data.action,
        actor: data.actor ?? null,
        details: data.details ?? null,
        previousStatus: data.previousStatus ?? null,
        newStatus: data.newStatus ?? null,
      })
      .returning();
    return row;
  }

  // ─── Notifications ─────────────────────────────────────────────────────

  async getNotifications(recipientId: string): Promise<any[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, recipientId))
      .orderBy(desc(notifications.createdAt));
  }

  async getUnreadNotificationCount(recipientId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.read, false),
        ),
      );
    return row?.value ?? 0;
  }

  async createNotification(data: any): Promise<any> {
    const [row] = await db
      .insert(notifications)
      .values({
        requestId: data.requestId ?? null,
        recipientType: data.recipientType,
        recipientId: data.recipientId,
        type: data.type,
        title: data.title,
        message: data.message,
        read: false,
      })
      .returning();
    return row;
  }

  async markNotificationRead(id: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(recipientId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.recipientId, recipientId));
  }

  // ─── Inventory Reservation ─────────────────────────────────────────────

  async reserveInventory(itemId: string, quantity: number): Promise<void> {
    // Atomic check-and-increment: the WHERE clause is the only overselling
    // guard in the app, so it must stay a single conditional UPDATE.
    const updated = await db
      .update(inventoryItems)
      .set({
        reservedQuantity: sql`${inventoryItems.reservedQuantity} + ${quantity}`,
      })
      .where(
        and(
          eq(inventoryItems.id, itemId),
          sql`(${inventoryItems.quantity} - ${inventoryItems.reservedQuantity}) >= ${quantity}`,
        ),
      )
      .returning({ id: inventoryItems.id });
    if (updated.length === 0) {
      throw new Error(`Insufficient available inventory for item ${itemId}`);
    }
  }

  async releaseInventory(itemId: string, quantity: number): Promise<void> {
    // Clamp at zero so over-release can never drive reservations negative.
    await db
      .update(inventoryItems)
      .set({
        reservedQuantity: sql`GREATEST(0, ${inventoryItems.reservedQuantity} - ${quantity})`,
      })
      .where(eq(inventoryItems.id, itemId));
  }

  async getAvailableQuantity(itemId: string): Promise<number> {
    const [row] = await db
      .select({
        available: sql<number>`${inventoryItems.quantity} - ${inventoryItems.reservedQuantity}`,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, itemId));
    return row?.available ?? 0;
  }

  // ─── Donors ────────────────────────────────────────────────────────────

  async getDonors(): Promise<Donor[]> {
    return db.select().from(donors).orderBy(sql`lower(${donors.name})`);
  }

  async getDonor(id: string): Promise<Donor | undefined> {
    const [row] = await db.select().from(donors).where(eq(donors.id, id));
    return row;
  }

  async getDonorByName(name: string): Promise<Donor | undefined> {
    const [row] = await db.select().from(donors).where(eq(donors.name, name));
    return row;
  }

  // key is normaliseName from shared/identity.ts, lowercase with collapsed spaces
  async findDonorsByNormalisedName(key: string): Promise<Donor[]> {
    return donorStoreOn(db).findDonorsByNormalisedName(key);
  }

  async createDonor(data: InsertDonor): Promise<Donor> {
    return donorStoreOn(db).createDonor(data);
  }

  async updateDonor(
    id: string,
    data: Partial<InsertDonor>,
  ): Promise<Donor | undefined> {
    if (!hasDefinedValues(data)) return this.getDonor(id);
    const [row] = await db
      .update(donors)
      .set(data)
      .where(eq(donors.id, id))
      .returning();
    return row;
  }

  async deleteDonor(id: string): Promise<boolean> {
    const deleted = await db
      .delete(donors)
      .where(eq(donors.id, id))
      .returning({ id: donors.id });
    return deleted.length > 0;
  }
}

/**
 * The donor reads and writes of find or create on one connection. An
 * idempotent route passes drizzle over its transaction client, so the donor
 * write rolls back with the rest of the transaction.
 */
export function donorStoreOn(exec: NodePgDatabase<any>): DonorStore {
  return {
    findDonorsByNormalisedName: (key) =>
      exec
        .select()
        .from(donors)
        .where(sql`lower(btrim(regexp_replace(${donors.name}, '\\s+', ' ', 'g'))) = ${key}`)
        .orderBy(asc(donors.createdAt)),
    createDonor: async (data) => {
      const [row] = await exec.insert(donors).values(data).returning();
      return row;
    },
  };
}
