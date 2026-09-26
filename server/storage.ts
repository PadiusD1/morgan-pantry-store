/**
 * Storage layer – IStorage interface + concrete implementation.
 *
 * The concrete implementation is PgStorage (server/pg-storage.ts), backed by
 * Supabase Postgres through drizzle-orm. The previous SqliteStorage lived in
 * server/sqlite-storage.ts (see git history) and was retired when the app
 * moved to Vercel serverless, where a file database cannot persist.
 */

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
  Donor,
  InsertDonor,
} from "@shared/schema";

// ─── IStorage interface ──────────────────────────────────────────────────────

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;

  // Inventory
  getInventoryItems(): Promise<InventoryItem[]>;
  getInventoryItem(id: string): Promise<InventoryItem | undefined>;
  getInventoryItemByBarcode(barcode: string): Promise<InventoryItem | undefined>;
  createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(
    id: string,
    item: Partial<InsertInventoryItem>,
  ): Promise<InventoryItem | undefined>;

  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  getClientByIdentifier(identifier: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(
    id: string,
    client: Partial<InsertClient>,
  ): Promise<Client | undefined>;
  deleteClient(id: string): Promise<boolean>;

  // Transactions
  getTransactions(): Promise<Transaction[]>;
  createTransaction(tx: InsertTransaction): Promise<Transaction>;

  // Transaction Items
  getTransactionItems(transactionId: string): Promise<TransactionItem[]>;
  createTransactionItem(item: InsertTransactionItem): Promise<TransactionItem>;

  // Pack Components
  getPackComponents(parentItemId: string): Promise<PackComponent[]>;
  createPackComponent(comp: InsertPackComponent): Promise<PackComponent>;

  // Price History
  getPriceHistory(inventoryItemId: string): Promise<PriceHistory[]>;
  createPriceHistory(entry: InsertPriceHistory): Promise<PriceHistory>;

  // Weight History
  getWeightHistory(inventoryItemId: string): Promise<WeightHistory[]>;
  createWeightHistory(entry: InsertWeightHistory): Promise<WeightHistory>;

  // Household Members
  getHouseholdMembers(clientId: string): Promise<HouseholdMember[]>;
  createHouseholdMember(member: InsertHouseholdMember): Promise<HouseholdMember>;
  deleteHouseholdMember(id: string): Promise<boolean>;

  // Item Groups
  getItemGroups(): Promise<ItemGroup[]>;
  getItemGroup(id: string): Promise<ItemGroup | undefined>;
  createItemGroup(group: InsertItemGroup): Promise<ItemGroup>;
  updateItemGroup(id: string, group: Partial<InsertItemGroup>): Promise<ItemGroup | undefined>;
  deleteItemGroup(id: string): Promise<boolean>;

  // Item Group Items
  getItemGroupItems(groupId: string): Promise<ItemGroupItem[]>;
  createItemGroupItem(item: InsertItemGroupItem): Promise<ItemGroupItem>;
  deleteItemGroupItem(id: string): Promise<boolean>;

  // Settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<Record<string, string>>;

  // ─── Requests ─────────────────────────────────────────────────────────
  getRequests(filters?: { status?: string; clientIdentifier?: string; dateFrom?: string; dateTo?: string }): Promise<any[]>;
  getRequest(id: string): Promise<any | undefined>;
  createRequest(data: any): Promise<any>;
  updateRequest(id: string, data: any): Promise<any | undefined>;
  getRequestsByClientIdentifier(identifier: string): Promise<any[]>;
  getRequestsByUserId(userId: string): Promise<any[]>;
  getRequestCountSince(identifier: string, since: string): Promise<number>;

  // ─── Request Items ────────────────────────────────────────────────────
  getRequestItems(requestId: string): Promise<any[]>;
  createRequestItem(data: any): Promise<any>;
  updateRequestItem(id: string, data: any): Promise<any | undefined>;

  // ─── Request Audit Log ────────────────────────────────────────────────
  getRequestAuditLog(requestId: string): Promise<any[]>;
  createAuditLogEntry(data: any): Promise<any>;

  // ─── Notifications ────────────────────────────────────────────────────
  getNotifications(recipientId: string): Promise<any[]>;
  getUnreadNotificationCount(recipientId: string): Promise<number>;
  createNotification(data: any): Promise<any>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(recipientId: string): Promise<void>;

  // ─── Inventory Reservation ────────────────────────────────────────────
  reserveInventory(itemId: string, quantity: number): Promise<void>;
  releaseInventory(itemId: string, quantity: number): Promise<void>;
  getAvailableQuantity(itemId: string): Promise<number>;

  // ─── Donors ─────────────────────────────────────────────────────────
  getDonors(): Promise<Donor[]>;
  getDonor(id: string): Promise<Donor | undefined>;
  getDonorByName(name: string): Promise<Donor | undefined>;
  findDonorsByNormalisedName(key: string): Promise<Donor[]>;
  createDonor(data: InsertDonor): Promise<Donor>;
  updateDonor(id: string, data: Partial<InsertDonor>): Promise<Donor | undefined>;
  deleteDonor(id: string): Promise<boolean>;
}

// ─── Concrete implementation: Postgres (Supabase) ───────────────────────────

import { PgStorage } from "./pg-storage";

export const storage: IStorage = new PgStorage();
