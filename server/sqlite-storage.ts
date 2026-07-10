/**
 * SQLite-backed implementation of IStorage.
 *
 * Design notes:
 *  - better-sqlite3 is synchronous, so every method wraps a sync call in a
 *    resolved Promise to satisfy the async IStorage interface.
 *  - Timestamps are stored as ISO-8601 TEXT and converted to Date on read.
 *  - Booleans are stored as INTEGER 0/1 and converted to boolean on read.
 *  - Arrays (allergens, allergies) are stored as JSON TEXT.
 *  - JSONB fields (dataSourcesTried, rawPayload) are stored as JSON TEXT.
 *  - The PG `numeric` type maps to TEXT in SQLite (preserves decimal precision).
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { IStorage } from "./storage";
import type {
  User,
  InsertUser,
  InventoryItem,
  InsertInventoryItem,
  Client,
  InsertClient,
  Transaction,
  InsertTransaction,
  TransactionItem,
  InsertTransactionItem,
  PackComponent,
  InsertPackComponent,
  PriceHistory,
  InsertPriceHistory,
  WeightHistory,
  InsertWeightHistory,
  HouseholdMember,
  InsertHouseholdMember,
  ItemGroup,
  InsertItemGroup,
  ItemGroupItem,
  InsertItemGroupItem,
} from "@shared/schema";

// ─── Row ↔ Domain adapters ─────────────────────────────────────────────────
// SQLite rows use snake_case, 0/1 for booleans, JSON strings for arrays/objects,
// and ISO strings for dates. These helpers convert in both directions.

function toDate(iso: string): Date {
  return new Date(iso);
}
function fromDate(d: Date | undefined | null): string {
  return (d ?? new Date()).toISOString();
}
function toBool(v: number): boolean {
  return v === 1;
}
function fromBool(v: boolean | undefined | null): number {
  return v ? 1 : 0;
}
function toJsonArray(v: string | null | undefined): string[] {
  if (!v) return [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}
function fromJsonArray(v: string[] | undefined | null): string {
  return JSON.stringify(v ?? []);
}
function toJson(v: string | null | undefined): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
function fromJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v);
}

// ─── Row → InventoryItem ────────────────────────────────────────────────────

function rowToInventoryItem(r: any): InventoryItem {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand ?? null,
    category: r.category,
    barcode: r.barcode ?? null,
    quantity: r.quantity,
    packageType: r.package_type ?? "single",
    unitCount: r.unit_count ?? 1,
    weightPerUnitLbs: r.weight_per_unit_lbs ?? "0",
    netWeightG: r.net_weight_g ?? null,
    unitWeightG: r.unit_weight_g ?? null,
    weightIsEstimated: toBool(r.weight_is_estimated),
    valuePerUnitUsd: r.value_per_unit_usd ?? "0",
    costCents: r.cost_cents ?? null,
    costIsEstimated: toBool(r.cost_is_estimated),
    currency: r.currency ?? "USD",
    reorderThreshold: r.reorder_threshold ?? null,
    allergens: toJsonArray(r.allergens),
    expirationDate: r.expiration_date ?? null,
    dataSourcesTried: toJson(r.data_sources_tried),
    winningSource: r.winning_source ?? null,
    matchConfidence: r.match_confidence ?? null,
    rawPayload: toJson(r.raw_payload),
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

// ─── Row → User ─────────────────────────────────────────────────────────────

function rowToUser(r: any): User {
  return {
    id: r.id,
    username: r.username,
    password: r.password,
    role: r.role as User["role"],
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

// ─── Row → Client ───────────────────────────────────────────────────────────

function rowToClient(r: any): Client {
  return {
    id: r.id,
    name: r.name,
    identifier: r.identifier,
    contact: r.contact ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    dateOfBirth: r.date_of_birth ?? null,
    householdSize: r.household_size ?? 1,
    eligibleDate: r.eligible_date ?? null,
    certificationDate: r.certification_date ?? null,
    status: r.status ?? "active",
    clientType: r.client_type ?? "student",
    organization: r.organization ?? null,
    partnershipType: r.partnership_type ?? null,
    allergies: toJsonArray(r.allergies),
    notes: r.notes ?? null,
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

// ─── Row → HouseholdMember ─────────────────────────────────────────────────

function rowToHouseholdMember(r: any): HouseholdMember {
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    relationship: r.relationship ?? null,
    dateOfBirth: r.date_of_birth ?? null,
    allergies: toJsonArray(r.allergies),
    notes: r.notes ?? null,
    createdAt: toDate(r.created_at),
  };
}

// ─── Row → ItemGroup ───────────────────────────────────────────────────────

function rowToItemGroup(r: any): ItemGroup {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    isActive: toBool(r.is_active),
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

// ─── Row → ItemGroupItem ───────────────────────────────────────────────────

function rowToItemGroupItem(r: any): ItemGroupItem {
  return {
    id: r.id,
    groupId: r.group_id,
    inventoryItemId: r.inventory_item_id,
    quantity: r.quantity,
  };
}

// ─── Row → Transaction ──────────────────────────────────────────────────────

function rowToTransaction(r: any): Transaction {
  return {
    id: r.id,
    type: r.type as Transaction["type"],
    timestamp: toDate(r.timestamp),
    source: r.source ?? null,
    donor: r.donor ?? null,
    clientId: r.client_id ?? null,
    clientName: r.client_name ?? null,
    isEmergency: toBool(r.is_emergency ?? 0),
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    accuracy: r.accuracy ?? null,
    createdAt: toDate(r.created_at),
  };
}

// ─── Row → TransactionItem ──────────────────────────────────────────────────

function rowToTransactionItem(r: any): TransactionItem {
  return {
    id: r.id,
    transactionId: r.transaction_id,
    inventoryItemId: r.inventory_item_id,
    name: r.name,
    quantity: r.quantity,
    weightPerUnitLbs: r.weight_per_unit_lbs,
    valuePerUnitUsd: r.value_per_unit_usd,
  };
}

// ─── Row → PackComponent ────────────────────────────────────────────────────

function rowToPackComponent(r: any): PackComponent {
  return {
    id: r.id,
    parentItemId: r.parent_item_id,
    componentName: r.component_name,
    componentBarcode: r.component_barcode ?? null,
    quantity: r.quantity,
    weightG: r.weight_g ?? null,
  };
}

// ─── Row → PriceHistory ─────────────────────────────────────────────────────

function rowToPriceHistory(r: any): PriceHistory {
  return {
    id: r.id,
    inventoryItemId: r.inventory_item_id,
    costCents: r.cost_cents,
    currency: r.currency,
    source: r.source ?? null,
    recordedAt: toDate(r.recorded_at),
  };
}

// ─── Row → WeightHistory ────────────────────────────────────────────────────

function rowToWeightHistory(r: any): WeightHistory {
  return {
    id: r.id,
    inventoryItemId: r.inventory_item_id,
    netWeightG: r.net_weight_g,
    source: r.source ?? null,
    isEstimated: toBool(r.is_estimated),
    recordedAt: toDate(r.recorded_at),
  };
}

// ─── Request Management row converters ─────────────────────────────────────

function rowToRequest(r: any): any {
  return {
    id: r.id,
    clientId: r.client_id ?? null,
    clientName: r.client_name,
    clientIdentifier: r.client_identifier,
    clientEmail: r.client_email ?? null,
    clientPhone: r.client_phone ?? null,
    reason: r.reason,
    status: r.status,
    adminNote: r.admin_note ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ? toDate(r.reviewed_at) : null,
    pickupDeadline: r.pickup_deadline ?? null,
    fulfilledAt: r.fulfilled_at ? toDate(r.fulfilled_at) : null,
    cancelledAt: r.cancelled_at ? toDate(r.cancelled_at) : null,
    transactionId: r.transaction_id ?? null,
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

function rowToRequestItem(r: any): any {
  return {
    id: r.id,
    requestId: r.request_id,
    inventoryItemId: r.inventory_item_id,
    itemName: r.item_name,
    itemCategory: r.item_category ?? null,
    requestedQuantity: r.requested_quantity,
    approvedQuantity: r.approved_quantity ?? null,
    fulfilledQuantity: r.fulfilled_quantity ?? null,
    reserved: r.reserved === 1,
    denialReason: r.denial_reason ?? null,
  };
}

function rowToAuditLog(r: any): any {
  return {
    id: r.id,
    requestId: r.request_id,
    action: r.action,
    actor: r.actor ?? null,
    details: r.details ?? null,
    previousStatus: r.previous_status ?? null,
    newStatus: r.new_status ?? null,
    createdAt: toDate(r.created_at),
  };
}

function rowToNotification(r: any): any {
  return {
    id: r.id,
    requestId: r.request_id ?? null,
    recipientType: r.recipient_type,
    recipientId: r.recipient_id,
    type: r.type,
    title: r.title,
    message: r.message,
    read: r.read === 1,
    createdAt: toDate(r.created_at),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SqliteStorage
function rowToDonor(r: any): any {
  return {
    id: r.id,
    name: r.name,
    organization: r.organization ?? null,
    contactName: r.contact_name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    notes: r.notes ?? null,
    status: r.status ?? "active",
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

// ═══════════════════════════════════════════════════════════════════════════

export class SqliteStorage implements IStorage {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ─── Users ─────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<User | undefined> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? rowToUser(row) : undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const row = this.db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username);
    return row ? rowToUser(row) : undefined;
  }

  async createUser(insert: InsertUser): Promise<User> {
    const id = randomUUID();
    const now = fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO users (id, username, password, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, insert.username, insert.password, insert.role ?? "volunteer", now, now);
    return (await this.getUser(id))!;
  }

  // ─── Inventory ─────────────────────────────────────────────────────────

  async getInventoryItems(): Promise<InventoryItem[]> {
    const rows = this.db.prepare("SELECT * FROM inventory_items ORDER BY name").all();
    return rows.map(rowToInventoryItem);
  }

  async getInventoryItem(id: string): Promise<InventoryItem | undefined> {
    const row = this.db
      .prepare("SELECT * FROM inventory_items WHERE id = ?")
      .get(id);
    return row ? rowToInventoryItem(row) : undefined;
  }

  async getInventoryItemByBarcode(
    barcode: string,
  ): Promise<InventoryItem | undefined> {
    const row = this.db
      .prepare("SELECT * FROM inventory_items WHERE barcode = ?")
      .get(barcode);
    return row ? rowToInventoryItem(row) : undefined;
  }

  async createInventoryItem(
    insert: InsertInventoryItem,
  ): Promise<InventoryItem> {
    const id = randomUUID();
    const now = fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO inventory_items (
          id, name, brand, category, barcode, quantity,
          package_type, unit_count,
          weight_per_unit_lbs, net_weight_g, unit_weight_g, weight_is_estimated,
          value_per_unit_usd, cost_cents, cost_is_estimated, currency,
          reorder_threshold, allergens, expiration_date,
          data_sources_tried, winning_source, match_confidence, raw_payload,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        )`,
      )
      .run(
        id,
        insert.name,
        insert.brand ?? null,
        insert.category ?? "Uncategorized",
        insert.barcode ?? null,
        insert.quantity ?? 0,
        insert.packageType ?? "single",
        insert.unitCount ?? 1,
        insert.weightPerUnitLbs ?? "0",
        insert.netWeightG ?? null,
        insert.unitWeightG ?? null,
        fromBool(insert.weightIsEstimated),
        insert.valuePerUnitUsd ?? "0",
        insert.costCents ?? null,
        fromBool(insert.costIsEstimated),
        insert.currency ?? "USD",
        insert.reorderThreshold ?? null,
        fromJsonArray(insert.allergens),
        insert.expirationDate ?? null,
        fromJson(insert.dataSourcesTried),
        insert.winningSource ?? null,
        insert.matchConfidence ?? null,
        fromJson(insert.rawPayload),
        now,
        now,
      );
    return (await this.getInventoryItem(id))!;
  }

  async updateInventoryItem(
    id: string,
    partial: Partial<InsertInventoryItem>,
  ): Promise<InventoryItem | undefined> {
    const existing = await this.getInventoryItem(id);
    if (!existing) return undefined;

    // Build SET clauses dynamically from the partial
    const sets: string[] = [];
    const values: unknown[] = [];

    if (partial.name !== undefined) { sets.push("name = ?"); values.push(partial.name); }
    if (partial.brand !== undefined) { sets.push("brand = ?"); values.push(partial.brand ?? null); }
    if (partial.category !== undefined) { sets.push("category = ?"); values.push(partial.category); }
    if (partial.barcode !== undefined) { sets.push("barcode = ?"); values.push(partial.barcode ?? null); }
    if (partial.quantity !== undefined) { sets.push("quantity = ?"); values.push(partial.quantity); }
    if (partial.packageType !== undefined) { sets.push("package_type = ?"); values.push(partial.packageType); }
    if (partial.unitCount !== undefined) { sets.push("unit_count = ?"); values.push(partial.unitCount); }
    if (partial.weightPerUnitLbs !== undefined) { sets.push("weight_per_unit_lbs = ?"); values.push(partial.weightPerUnitLbs); }
    if (partial.netWeightG !== undefined) { sets.push("net_weight_g = ?"); values.push(partial.netWeightG); }
    if (partial.unitWeightG !== undefined) { sets.push("unit_weight_g = ?"); values.push(partial.unitWeightG); }
    if (partial.weightIsEstimated !== undefined) { sets.push("weight_is_estimated = ?"); values.push(fromBool(partial.weightIsEstimated)); }
    if (partial.valuePerUnitUsd !== undefined) { sets.push("value_per_unit_usd = ?"); values.push(partial.valuePerUnitUsd); }
    if (partial.costCents !== undefined) { sets.push("cost_cents = ?"); values.push(partial.costCents); }
    if (partial.costIsEstimated !== undefined) { sets.push("cost_is_estimated = ?"); values.push(fromBool(partial.costIsEstimated)); }
    if (partial.currency !== undefined) { sets.push("currency = ?"); values.push(partial.currency); }
    if (partial.reorderThreshold !== undefined) { sets.push("reorder_threshold = ?"); values.push(partial.reorderThreshold); }
    if (partial.allergens !== undefined) { sets.push("allergens = ?"); values.push(fromJsonArray(partial.allergens)); }
    if (partial.expirationDate !== undefined) { sets.push("expiration_date = ?"); values.push(partial.expirationDate); }
    if (partial.dataSourcesTried !== undefined) { sets.push("data_sources_tried = ?"); values.push(fromJson(partial.dataSourcesTried)); }
    if (partial.winningSource !== undefined) { sets.push("winning_source = ?"); values.push(partial.winningSource); }
    if (partial.matchConfidence !== undefined) { sets.push("match_confidence = ?"); values.push(partial.matchConfidence); }
    if (partial.rawPayload !== undefined) { sets.push("raw_payload = ?"); values.push(fromJson(partial.rawPayload)); }

    // Always bump updated_at
    sets.push("updated_at = ?");
    values.push(fromDate(new Date()));

    if (sets.length === 1) {
      // Only updated_at — still update it
    }

    values.push(id); // WHERE id = ?
    this.db
      .prepare(`UPDATE inventory_items SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getInventoryItem(id);
  }

  // ─── Clients ───────────────────────────────────────────────────────────

  async getClients(): Promise<Client[]> {
    const rows = this.db.prepare("SELECT * FROM clients ORDER BY name").all();
    return rows.map(rowToClient);
  }

  async getClient(id: string): Promise<Client | undefined> {
    const row = this.db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
    return row ? rowToClient(row) : undefined;
  }

  async getClientByIdentifier(
    identifier: string,
  ): Promise<Client | undefined> {
    const row = this.db
      .prepare("SELECT * FROM clients WHERE identifier = ?")
      .get(identifier);
    return row ? rowToClient(row) : undefined;
  }

  async createClient(insert: InsertClient): Promise<Client> {
    const id = randomUUID();
    const now = fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO clients (id, name, identifier, contact, phone, email, address,
          date_of_birth, household_size, eligible_date, certification_date, status,
          client_type, organization, partnership_type,
          allergies, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.name,
        insert.identifier,
        insert.contact ?? null,
        insert.phone ?? null,
        insert.email ?? null,
        insert.address ?? null,
        insert.dateOfBirth ?? null,
        insert.householdSize ?? 1,
        insert.eligibleDate ?? null,
        insert.certificationDate ?? null,
        insert.status ?? "active",
        (insert as any).clientType ?? "student",
        (insert as any).organization ?? null,
        (insert as any).partnershipType ?? null,
        fromJsonArray(insert.allergies),
        insert.notes ?? null,
        now,
        now,
      );
    return (await this.getClient(id))!;
  }

  async updateClient(
    id: string,
    partial: Partial<InsertClient>,
  ): Promise<Client | undefined> {
    const existing = await this.getClient(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (partial.name !== undefined) { sets.push("name = ?"); values.push(partial.name); }
    if (partial.identifier !== undefined) { sets.push("identifier = ?"); values.push(partial.identifier); }
    if (partial.contact !== undefined) { sets.push("contact = ?"); values.push(partial.contact ?? null); }
    if (partial.phone !== undefined) { sets.push("phone = ?"); values.push(partial.phone ?? null); }
    if (partial.email !== undefined) { sets.push("email = ?"); values.push(partial.email ?? null); }
    if (partial.address !== undefined) { sets.push("address = ?"); values.push(partial.address ?? null); }
    if (partial.dateOfBirth !== undefined) { sets.push("date_of_birth = ?"); values.push(partial.dateOfBirth ?? null); }
    if (partial.householdSize !== undefined) { sets.push("household_size = ?"); values.push(partial.householdSize ?? 1); }
    if (partial.eligibleDate !== undefined) { sets.push("eligible_date = ?"); values.push(partial.eligibleDate ?? null); }
    if (partial.certificationDate !== undefined) { sets.push("certification_date = ?"); values.push(partial.certificationDate ?? null); }
    if (partial.status !== undefined) { sets.push("status = ?"); values.push(partial.status ?? "active"); }
    const pAny = partial as any;
    if (pAny.clientType !== undefined) { sets.push("client_type = ?"); values.push(pAny.clientType ?? "student"); }
    if (pAny.organization !== undefined) { sets.push("organization = ?"); values.push(pAny.organization ?? null); }
    if (pAny.partnershipType !== undefined) { sets.push("partnership_type = ?"); values.push(pAny.partnershipType ?? null); }
    if (partial.allergies !== undefined) { sets.push("allergies = ?"); values.push(fromJsonArray(partial.allergies)); }
    if (partial.notes !== undefined) { sets.push("notes = ?"); values.push(partial.notes ?? null); }

    sets.push("updated_at = ?");
    values.push(fromDate(new Date()));

    values.push(id);
    this.db
      .prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getClient(id);
  }

  async deleteClient(id: string): Promise<boolean> {
    // Wrap in atomic transaction: either all orphan cleanup + delete succeeds or nothing.
    const deleteAtomic = this.db.transaction((clientId: string) => {
      // Nullify client_id on transactions so historical records aren't orphaned
      this.db.prepare("UPDATE transactions SET client_id = NULL WHERE client_id = ?").run(clientId);
      // Nullify client_id on requests so audit trail is preserved
      this.db.prepare("UPDATE requests SET client_id = NULL WHERE client_id = ?").run(clientId);
      // Delete household members (also handled by CASCADE but explicit is safer)
      this.db.prepare("DELETE FROM household_members WHERE client_id = ?").run(clientId);
      // Finally delete the client
      return this.db.prepare("DELETE FROM clients WHERE id = ?").run(clientId);
    });
    const result = deleteAtomic(id);
    return result.changes > 0;
  }

  // ─── Transactions ──────────────────────────────────────────────────────

  async getTransactions(): Promise<Transaction[]> {
    const rows = this.db
      .prepare("SELECT * FROM transactions ORDER BY created_at DESC")
      .all();
    return rows.map(rowToTransaction);
  }

  async createTransaction(insert: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const now = fromDate(new Date());
    const ts = insert.timestamp ? fromDate(insert.timestamp) : now;
    this.db
      .prepare(
        `INSERT INTO transactions (id, type, timestamp, source, donor, client_id, client_name,
          is_emergency, latitude, longitude, accuracy, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.type,
        ts,
        insert.source ?? null,
        insert.donor ?? null,
        insert.clientId ?? null,
        insert.clientName ?? null,
        fromBool((insert as any).isEmergency),
        insert.latitude ?? null,
        insert.longitude ?? null,
        insert.accuracy ?? null,
        now,
      );
    const row = this.db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(id);
    return rowToTransaction(row);
  }

  // ─── Transaction Items ─────────────────────────────────────────────────

  async getTransactionItems(
    transactionId: string,
  ): Promise<TransactionItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM transaction_items WHERE transaction_id = ?")
      .all(transactionId);
    return rows.map(rowToTransactionItem);
  }

  async createTransactionItem(
    insert: InsertTransactionItem,
  ): Promise<TransactionItem> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO transaction_items (id, transaction_id, inventory_item_id, name, quantity,
          weight_per_unit_lbs, value_per_unit_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.transactionId,
        insert.inventoryItemId,
        insert.name,
        insert.quantity,
        insert.weightPerUnitLbs,
        insert.valuePerUnitUsd,
      );
    const row = this.db
      .prepare("SELECT * FROM transaction_items WHERE id = ?")
      .get(id);
    return rowToTransactionItem(row);
  }

  // ─── Pack Components ───────────────────────────────────────────────────

  async getPackComponents(parentItemId: string): Promise<PackComponent[]> {
    const rows = this.db
      .prepare("SELECT * FROM pack_components WHERE parent_item_id = ?")
      .all(parentItemId);
    return rows.map(rowToPackComponent);
  }

  async createPackComponent(
    insert: InsertPackComponent,
  ): Promise<PackComponent> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO pack_components (id, parent_item_id, component_name, component_barcode, quantity, weight_g)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.parentItemId,
        insert.componentName,
        insert.componentBarcode ?? null,
        insert.quantity ?? 1,
        insert.weightG ?? null,
      );
    const row = this.db
      .prepare("SELECT * FROM pack_components WHERE id = ?")
      .get(id);
    return rowToPackComponent(row);
  }

  // ─── Price History ─────────────────────────────────────────────────────

  async getPriceHistory(inventoryItemId: string): Promise<PriceHistory[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM price_history WHERE inventory_item_id = ? ORDER BY recorded_at DESC",
      )
      .all(inventoryItemId);
    return rows.map(rowToPriceHistory);
  }

  async createPriceHistory(insert: InsertPriceHistory): Promise<PriceHistory> {
    const id = randomUUID();
    const recordedAt = insert.recordedAt
      ? fromDate(insert.recordedAt)
      : fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO price_history (id, inventory_item_id, cost_cents, currency, source, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.inventoryItemId,
        insert.costCents,
        insert.currency ?? "USD",
        insert.source ?? null,
        recordedAt,
      );
    const row = this.db
      .prepare("SELECT * FROM price_history WHERE id = ?")
      .get(id);
    return rowToPriceHistory(row);
  }

  // ─── Weight History ────────────────────────────────────────────────────

  async getWeightHistory(inventoryItemId: string): Promise<WeightHistory[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM weight_history WHERE inventory_item_id = ? ORDER BY recorded_at DESC",
      )
      .all(inventoryItemId);
    return rows.map(rowToWeightHistory);
  }

  async createWeightHistory(
    insert: InsertWeightHistory,
  ): Promise<WeightHistory> {
    const id = randomUUID();
    const recordedAt = insert.recordedAt
      ? fromDate(insert.recordedAt)
      : fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO weight_history (id, inventory_item_id, net_weight_g, source, is_estimated, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.inventoryItemId,
        insert.netWeightG,
        insert.source ?? null,
        fromBool(insert.isEstimated),
        recordedAt,
      );
    const row = this.db
      .prepare("SELECT * FROM weight_history WHERE id = ?")
      .get(id);
    return rowToWeightHistory(row);
  }

  // ─── Household Members ──────────────────────────────────────────────

  async getHouseholdMembers(clientId: string): Promise<HouseholdMember[]> {
    const rows = this.db
      .prepare("SELECT * FROM household_members WHERE client_id = ? ORDER BY name")
      .all(clientId);
    return rows.map(rowToHouseholdMember);
  }

  async createHouseholdMember(insert: InsertHouseholdMember): Promise<HouseholdMember> {
    const id = randomUUID();
    const now = fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO household_members (id, client_id, name, relationship, date_of_birth, allergies, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.clientId,
        insert.name,
        insert.relationship ?? null,
        insert.dateOfBirth ?? null,
        fromJsonArray(insert.allergies),
        insert.notes ?? null,
        now,
      );
    const row = this.db.prepare("SELECT * FROM household_members WHERE id = ?").get(id);
    return rowToHouseholdMember(row);
  }

  async deleteHouseholdMember(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM household_members WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── Item Groups ────────────────────────────────────────────────────

  async getItemGroups(): Promise<ItemGroup[]> {
    const rows = this.db.prepare("SELECT * FROM item_groups ORDER BY name").all();
    return rows.map(rowToItemGroup);
  }

  async getItemGroup(id: string): Promise<ItemGroup | undefined> {
    const row = this.db.prepare("SELECT * FROM item_groups WHERE id = ?").get(id);
    return row ? rowToItemGroup(row) : undefined;
  }

  async createItemGroup(insert: InsertItemGroup): Promise<ItemGroup> {
    const id = randomUUID();
    const now = fromDate(new Date());
    this.db
      .prepare(
        `INSERT INTO item_groups (id, name, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        insert.name,
        insert.description ?? null,
        fromBool(insert.isActive ?? true),
        now,
        now,
      );
    return (await this.getItemGroup(id))!;
  }

  async updateItemGroup(id: string, partial: Partial<InsertItemGroup>): Promise<ItemGroup | undefined> {
    const existing = await this.getItemGroup(id);
    if (!existing) return undefined;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (partial.name !== undefined) { sets.push("name = ?"); values.push(partial.name); }
    if (partial.description !== undefined) { sets.push("description = ?"); values.push(partial.description ?? null); }
    if (partial.isActive !== undefined) { sets.push("is_active = ?"); values.push(fromBool(partial.isActive)); }

    sets.push("updated_at = ?");
    values.push(fromDate(new Date()));

    values.push(id);
    this.db.prepare(`UPDATE item_groups SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    return this.getItemGroup(id);
  }

  async deleteItemGroup(id: string): Promise<boolean> {
    // CASCADE deletes item_group_items via FK
    const result = this.db.prepare("DELETE FROM item_groups WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── Item Group Items ───────────────────────────────────────────────

  async getItemGroupItems(groupId: string): Promise<ItemGroupItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM item_group_items WHERE group_id = ?")
      .all(groupId);
    return rows.map(rowToItemGroupItem);
  }

  async createItemGroupItem(insert: InsertItemGroupItem): Promise<ItemGroupItem> {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO item_group_items (id, group_id, inventory_item_id, quantity)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, insert.groupId, insert.inventoryItemId, insert.quantity ?? 1);
    const row = this.db.prepare("SELECT * FROM item_group_items WHERE id = ?").get(id);
    return rowToItemGroupItem(row);
  }

  async deleteItemGroupItem(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM item_group_items WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── Settings ───────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | undefined> {
    const row: any = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows: any[] = this.db.prepare("SELECT key, value FROM settings").all();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ─── Request Management System ─────────────────────────────────────

  async getRequests(filters?: { status?: string; clientIdentifier?: string; dateFrom?: string; dateTo?: string }): Promise<any[]> {
    let sql = "SELECT * FROM requests";
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters?.status) { conditions.push("status = ?"); params.push(filters.status); }
    if (filters?.clientIdentifier) { conditions.push("client_identifier = ?"); params.push(filters.clientIdentifier); }
    if (filters?.dateFrom) { conditions.push("created_at >= ?"); params.push(filters.dateFrom); }
    if (filters?.dateTo) { conditions.push("created_at <= ?"); params.push(filters.dateTo); }
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(rowToRequest);
  }

  async getRequest(id: string): Promise<any | undefined> {
    const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
    return row ? rowToRequest(row) : undefined;
  }

  async createRequest(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO requests (id, client_id, client_name, client_identifier, client_email, client_phone, reason, status, admin_note, reviewed_by, reviewed_at, pickup_deadline, fulfilled_at, cancelled_at, transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.clientId ?? null, data.clientName, data.clientIdentifier, data.clientEmail ?? null, data.clientPhone ?? null, data.reason, data.status ?? "pending", data.adminNote ?? null, data.reviewedBy ?? null, data.reviewedAt ?? null, data.pickupDeadline ?? null, data.fulfilledAt ?? null, data.cancelledAt ?? null, data.transactionId ?? null, now, now);
    return (await this.getRequest(id))!;
  }

  async updateRequest(id: string, data: any): Promise<any | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    const fieldMap: Record<string, string> = {
      clientId: "client_id", clientName: "client_name", clientIdentifier: "client_identifier",
      clientEmail: "client_email", clientPhone: "client_phone", reason: "reason", status: "status",
      adminNote: "admin_note", reviewedBy: "reviewed_by", reviewedAt: "reviewed_at",
      pickupDeadline: "pickup_deadline", fulfilledAt: "fulfilled_at", cancelledAt: "cancelled_at",
      transactionId: "transaction_id",
    };
    for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
      if (data[jsKey] !== undefined) {
        sets.push(`${dbKey} = ?`);
        const val = data[jsKey];
        values.push(val instanceof Date ? val.toISOString() : val);
      }
    }
    if (sets.length === 0) return this.getRequest(id);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE requests SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getRequest(id);
  }

  async getRequestsByClientIdentifier(identifier: string): Promise<any[]> {
    const rows = this.db.prepare("SELECT * FROM requests WHERE client_identifier = ? ORDER BY created_at DESC").all(identifier);
    return rows.map(rowToRequest);
  }

  async getRequestCountSince(identifier: string, since: string): Promise<number> {
    const row: any = this.db.prepare("SELECT COUNT(*) as count FROM requests WHERE client_identifier = ? AND created_at >= ?").get(identifier, since);
    return row?.count ?? 0;
  }

  // ─── Request Items ─────────────────────────────────────────────────

  async getRequestItems(requestId: string): Promise<any[]> {
    const rows = this.db.prepare("SELECT * FROM request_items WHERE request_id = ?").all(requestId);
    return rows.map(rowToRequestItem);
  }

  async createRequestItem(data: any): Promise<any> {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO request_items (id, request_id, inventory_item_id, item_name, item_category, requested_quantity, approved_quantity, fulfilled_quantity, reserved, denial_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.requestId, data.inventoryItemId, data.itemName, data.itemCategory ?? null, data.requestedQuantity, data.approvedQuantity ?? null, data.fulfilledQuantity ?? null, data.reserved ? 1 : 0, data.denialReason ?? null);
    const row = this.db.prepare("SELECT * FROM request_items WHERE id = ?").get(id);
    return row ? rowToRequestItem(row) : undefined;
  }

  async updateRequestItem(id: string, data: any): Promise<any | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    if (data.approvedQuantity !== undefined) { sets.push("approved_quantity = ?"); values.push(data.approvedQuantity); }
    if (data.fulfilledQuantity !== undefined) { sets.push("fulfilled_quantity = ?"); values.push(data.fulfilledQuantity); }
    if (data.reserved !== undefined) { sets.push("reserved = ?"); values.push(data.reserved ? 1 : 0); }
    if (data.denialReason !== undefined) { sets.push("denial_reason = ?"); values.push(data.denialReason); }
    if (sets.length === 0) return undefined;
    values.push(id);
    this.db.prepare(`UPDATE request_items SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    const row = this.db.prepare("SELECT * FROM request_items WHERE id = ?").get(id);
    return row ? rowToRequestItem(row) : undefined;
  }

  // ─── Request Audit Log ─────────────────────────────────────────────

  async getRequestAuditLog(requestId: string): Promise<any[]> {
    const rows = this.db.prepare("SELECT * FROM request_audit_log WHERE request_id = ? ORDER BY created_at ASC").all(requestId);
    return rows.map(rowToAuditLog);
  }

  async createAuditLogEntry(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO request_audit_log (id, request_id, action, actor, details, previous_status, new_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.requestId, data.action, data.actor ?? null, data.details ?? null, data.previousStatus ?? null, data.newStatus ?? null, now);
    const row = this.db.prepare("SELECT * FROM request_audit_log WHERE id = ?").get(id);
    return row ? rowToAuditLog(row) : undefined;
  }

  // ─── Notifications ─────────────────────────────────────────────────

  async getNotifications(recipientId: string): Promise<any[]> {
    const rows = this.db.prepare("SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC").all(recipientId);
    return rows.map(rowToNotification);
  }

  async getUnreadNotificationCount(recipientId: string): Promise<number> {
    const row: any = this.db.prepare("SELECT COUNT(*) as count FROM notifications WHERE recipient_id = ? AND read = 0").get(recipientId);
    return row?.count ?? 0;
  }

  async createNotification(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO notifications (id, request_id, recipient_type, recipient_id, type, title, message, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(id, data.requestId ?? null, data.recipientType, data.recipientId, data.type, data.title, data.message, now);
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
    return row ? rowToNotification(row) : undefined;
  }

  async markNotificationRead(id: string): Promise<void> {
    this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
  }

  async markAllNotificationsRead(recipientId: string): Promise<void> {
    this.db.prepare("UPDATE notifications SET read = 1 WHERE recipient_id = ?").run(recipientId);
  }

  // ─── Inventory Reservation ─────────────────────────────────────────

  async reserveInventory(itemId: string, quantity: number): Promise<void> {
    const result = this.db.prepare(
      `UPDATE inventory_items SET reserved_quantity = reserved_quantity + ? WHERE id = ? AND (quantity - reserved_quantity) >= ?`
    ).run(quantity, itemId, quantity);
    if (result.changes === 0) {
      throw new Error(`Insufficient available inventory for item ${itemId}`);
    }
  }

  async releaseInventory(itemId: string, quantity: number): Promise<void> {
    this.db.prepare(
      `UPDATE inventory_items SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?`
    ).run(quantity, itemId);
  }

  async getAvailableQuantity(itemId: string): Promise<number> {
    const row: any = this.db.prepare("SELECT (quantity - reserved_quantity) AS available FROM inventory_items WHERE id = ?").get(itemId);
    return row?.available ?? 0;
  }

  // ─── Donors ─────────────────────────────────────────────────────────

  async getDonors(): Promise<any[]> {
    const rows = this.db.prepare("SELECT * FROM donors ORDER BY name").all();
    return rows.map(rowToDonor);
  }

  async getDonor(id: string): Promise<any | undefined> {
    const row = this.db.prepare("SELECT * FROM donors WHERE id = ?").get(id);
    return row ? rowToDonor(row) : undefined;
  }

  async getDonorByName(name: string): Promise<any | undefined> {
    const row = this.db.prepare("SELECT * FROM donors WHERE name = ?").get(name);
    return row ? rowToDonor(row) : undefined;
  }

  async createDonor(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO donors (id, name, organization, contact_name, phone, email, address, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.name, data.organization ?? null, data.contactName ?? null, data.phone ?? null, data.email ?? null, data.address ?? null, data.notes ?? null, data.status ?? "active", now, now);
    return (await this.getDonor(id))!;
  }

  async updateDonor(id: string, data: any): Promise<any | undefined> {
    const sets: string[] = [];
    const values: any[] = [];
    const fieldMap: Record<string, string> = {
      name: "name", organization: "organization", contactName: "contact_name",
      phone: "phone", email: "email", address: "address", notes: "notes", status: "status",
    };
    for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
      if (data[jsKey] !== undefined) { sets.push(`${dbKey} = ?`); values.push(data[jsKey]); }
    }
    if (sets.length === 0) return this.getDonor(id);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE donors SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.getDonor(id);
  }

  async deleteDonor(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM donors WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
