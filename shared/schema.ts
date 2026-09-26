import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  numeric,
  date,
  timestamp,
  pgEnum,
  doublePrecision,
  boolean,
  jsonb,
  real,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "staff",
  "volunteer",
  "student",
]);

export const transactionTypeEnum = pgEnum("transaction_type", ["IN", "OUT"]);

export const packageTypeEnum = pgEnum("package_type", [
  "single",
  "multi_pack",
  "variety_pack",
  "case",
]);

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // bcrypt hash — never a plaintext password
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("student"),
  // Morgan State student ID (students only)
  studentId: text("student_id"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  role: true,
  studentId: true,
  phone: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "password">;

// ─── Inventory Items ─────────────────────────────────────────────────────────

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  brand: text("brand"),
  category: text("category").notNull().default("Uncategorized"),
  barcode: text("barcode").unique(),
  quantity: integer("quantity").notNull().default(0),

  // Package info
  packageType: packageTypeEnum("package_type").default("single"),
  unitCount: integer("unit_count").default(1),

  // Weight (grams-based, with legacy lbs field retained)
  weightPerUnitLbs: numeric("weight_per_unit_lbs", {
    precision: 10,
    scale: 4,
  })
    .notNull()
    .default("0"),
  netWeightG: real("net_weight_g"),
  unitWeightG: real("unit_weight_g"),
  weightIsEstimated: boolean("weight_is_estimated").notNull().default(false),

  // Cost
  valuePerUnitUsd: numeric("value_per_unit_usd", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  costCents: integer("cost_cents"),
  costIsEstimated: boolean("cost_is_estimated").notNull().default(false),
  currency: text("currency").default("USD"),

  // Request reservation system
  reservedQuantity: integer("reserved_quantity").notNull().default(0),

  // Metadata
  reorderThreshold: integer("reorder_threshold"),
  allergens: text("allergens")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  expirationDate: date("expiration_date"),

  // Data provenance
  dataSourcesTried: jsonb("data_sources_tried"),
  winningSource: text("winning_source"),
  matchConfidence: real("match_confidence"),
  rawPayload: jsonb("raw_payload"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// ─── Clients ─────────────────────────────────────────────────────────────────

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  identifier: text("identifier").notNull().unique(),
  contact: text("contact"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  dateOfBirth: date("date_of_birth"),
  householdSize: integer("household_size").default(1),
  eligibleDate: date("eligible_date"),
  certificationDate: date("certification_date"),
  status: text("status").default("active"),
  // Partners Hub: "student" (default) or "partner" — partner orgs receive bulk distributions
  clientType: text("client_type").notNull().default("student"),
  organization: text("organization"),
  partnershipType: text("partnership_type"),
  allergies: text("allergies")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  notes: text("notes"),
  classification: text("classification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clients)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ─── Household Members (PantrySoft CRM) ─────────────────────────────────

export const householdMembers = pgTable("household_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship"),
  dateOfBirth: date("date_of_birth"),
  allergies: text("allergies")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHouseholdMemberSchema = createInsertSchema(householdMembers)
  .omit({ id: true, createdAt: true });

export type InsertHouseholdMember = z.infer<typeof insertHouseholdMemberSchema>;
export type HouseholdMember = typeof householdMembers.$inferSelect;

// ─── Item Groups (PantrySoft Quick-Pick Bundles) ─────────────────────────

export const itemGroups = pgTable("item_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertItemGroupSchema = createInsertSchema(itemGroups)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertItemGroup = z.infer<typeof insertItemGroupSchema>;
export type ItemGroup = typeof itemGroups.$inferSelect;

export const itemGroupItems = pgTable("item_group_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => itemGroups.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  quantity: integer("quantity").notNull().default(1),
});

export const insertItemGroupItemSchema = createInsertSchema(itemGroupItems)
  .omit({ id: true });

export type InsertItemGroupItem = z.infer<typeof insertItemGroupItemSchema>;
export type ItemGroupItem = typeof itemGroupItems.$inferSelect;

// ─── Donors ──────────────────────────────────────────────────────────────────

export const donors = pgTable("donors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organization: text("organization"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDonorSchema = createInsertSchema(donors)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertDonor = z.infer<typeof insertDonorSchema>;
export type Donor = typeof donors.$inferSelect;

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Setting = typeof settings.$inferSelect;

// ─── Transactions ────────────────────────────────────────────────────────────

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: transactionTypeEnum("type").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  source: text("source"),
  donor: text("donor"),
  clientId: uuid("client_id").references(() => clients.id),
  clientName: text("client_name"),
  donorId: uuid("donor_id").references(() => donors.id),
  // Emergency Shop Appointment flag: tracks emergency check-outs separately in reports
  isEmergency: boolean("is_emergency").notNull().default(false),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracy: doublePrecision("accuracy"),
  clientClassification: text("client_classification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions)
  .omit({ id: true, createdAt: true });

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// ─── Transaction Items ───────────────────────────────────────────────────────

export const transactionItems = pgTable("transaction_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  weightPerUnitLbs: numeric("weight_per_unit_lbs", {
    precision: 10,
    scale: 4,
  }).notNull(),
  valuePerUnitUsd: numeric("value_per_unit_usd", {
    precision: 10,
    scale: 2,
  }).notNull(),
});

export const insertTransactionItemSchema = createInsertSchema(transactionItems)
  .omit({ id: true });

export type InsertTransactionItem = z.infer<typeof insertTransactionItemSchema>;
export type TransactionItem = typeof transactionItems.$inferSelect;

// ─── Pack Components ────────────────────────────────────────────────────────

export const packComponents = pgTable("pack_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentItemId: uuid("parent_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  componentName: text("component_name").notNull(),
  componentBarcode: text("component_barcode"),
  quantity: integer("quantity").notNull().default(1),
  weightG: real("weight_g"),
});

export const insertPackComponentSchema = createInsertSchema(packComponents)
  .omit({ id: true });

export type InsertPackComponent = z.infer<typeof insertPackComponentSchema>;
export type PackComponent = typeof packComponents.$inferSelect;

// ─── Price History ──────────────────────────────────────────────────────────

export const priceHistory = pgTable("price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  costCents: integer("cost_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  source: text("source"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceHistorySchema = createInsertSchema(priceHistory)
  .omit({ id: true });

export type InsertPriceHistory = z.infer<typeof insertPriceHistorySchema>;
export type PriceHistory = typeof priceHistory.$inferSelect;

// ─── Weight History ─────────────────────────────────────────────────────────

export const weightHistory = pgTable("weight_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  netWeightG: real("net_weight_g").notNull(),
  source: text("source"),
  isEstimated: boolean("is_estimated").notNull().default(false),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWeightHistorySchema = createInsertSchema(weightHistory)
  .omit({ id: true });

export type InsertWeightHistory = z.infer<typeof insertWeightHistorySchema>;
export type WeightHistory = typeof weightHistory.$inferSelect;

// ─── Relations ───────────────────────────────────────────────────────────────

export const inventoryItemsRelations = relations(inventoryItems, ({ many }) => ({
  packComponents: many(packComponents),
  priceHistory: many(priceHistory),
  weightHistory: many(weightHistory),
  transactionItems: many(transactionItems),
}));

export const packComponentsRelations = relations(packComponents, ({ one }) => ({
  parentItem: one(inventoryItems, {
    fields: [packComponents.parentItemId],
    references: [inventoryItems.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [priceHistory.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const weightHistoryRelations = relations(weightHistory, ({ one }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [weightHistory.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  client: one(clients, {
    fields: [transactions.clientId],
    references: [clients.id],
  }),
  donor: one(donors, {
    fields: [transactions.donorId],
    references: [donors.id],
  }),
  items: many(transactionItems),
}));

export const donorsRelations = relations(donors, ({ many }) => ({
  transactions: many(transactions),
}));

export const transactionItemsRelations = relations(transactionItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionItems.transactionId],
    references: [transactions.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [transactionItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  transactions: many(transactions),
  householdMembers: many(householdMembers),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  client: one(clients, {
    fields: [householdMembers.clientId],
    references: [clients.id],
  }),
}));

export const itemGroupsRelations = relations(itemGroups, ({ many }) => ({
  items: many(itemGroupItems),
}));

export const itemGroupItemsRelations = relations(itemGroupItems, ({ one }) => ({
  group: one(itemGroups, {
    fields: [itemGroupItems.groupId],
    references: [itemGroups.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [itemGroupItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

// ─── Request Management System ──────────────────────────────────────────────

export type RequestStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "partially_approved"
  | "ready_for_pickup"
  | "completed"
  | "denied"
  | "expired"
  | "no_show"
  | "cancelled";

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "under_review",
  "approved",
  "partially_approved",
  "ready_for_pickup",
  "completed",
  "denied",
  "expired",
  "no_show",
  "cancelled",
]);

// ─── Requests ───────────────────────────────────────────────────────────────

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id),
  // Authenticated student account that submitted this request (null for kiosk/walk-up)
  userId: uuid("user_id").references(() => users.id),
  clientName: text("client_name").notNull(),
  clientIdentifier: text("client_identifier").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  reason: text("reason").notNull(),
  // Free-form note from the student/requester submitted alongside their request
  studentNote: text("student_note"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  pickupDeadline: text("pickup_deadline"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  transactionId: uuid("transaction_id").references(() => transactions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRequestSchema = createInsertSchema(requests)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requests.$inferSelect;

// ─── Request Items ──────────────────────────────────────────────────────────

export const requestItems = pgTable("request_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  itemName: text("item_name").notNull(),
  itemCategory: text("item_category"),
  requestedQuantity: integer("requested_quantity").notNull(),
  approvedQuantity: integer("approved_quantity"),
  fulfilledQuantity: integer("fulfilled_quantity"),
  reserved: boolean("reserved").notNull().default(false),
  denialReason: text("denial_reason"),
});

export const insertRequestItemSchema = createInsertSchema(requestItems)
  .omit({ id: true });

export type InsertRequestItem = z.infer<typeof insertRequestItemSchema>;
export type RequestItem = typeof requestItems.$inferSelect;

// ─── Request Audit Log ──────────────────────────────────────────────────────

export const requestAuditLog = pgTable("request_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actor: text("actor"),
  details: text("details"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRequestAuditLogSchema = createInsertSchema(requestAuditLog)
  .omit({ id: true, createdAt: true });

export type InsertRequestAuditLog = z.infer<typeof insertRequestAuditLogSchema>;
export type RequestAuditLog = typeof requestAuditLog.$inferSelect;

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => requests.id, {
    onDelete: "set null",
  }),
  recipientType: text("recipient_type").notNull(),
  recipientId: text("recipient_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true });

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ─── Request System Relations ───────────────────────────────────────────────

export const requestsRelations = relations(requests, ({ one, many }) => ({
  client: one(clients, {
    fields: [requests.clientId],
    references: [clients.id],
  }),
  transaction: one(transactions, {
    fields: [requests.transactionId],
    references: [transactions.id],
  }),
  items: many(requestItems),
  auditLog: many(requestAuditLog),
  notifications: many(notifications),
}));

export const requestItemsRelations = relations(requestItems, ({ one }) => ({
  request: one(requests, {
    fields: [requestItems.requestId],
    references: [requests.id],
  }),
  inventoryItem: one(inventoryItems, {
    fields: [requestItems.inventoryItemId],
    references: [inventoryItems.id],
  }),
}));

export const requestAuditLogRelations = relations(requestAuditLog, ({ one }) => ({
  request: one(requests, {
    fields: [requestAuditLog.requestId],
    references: [requests.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  request: one(requests, {
    fields: [notifications.requestId],
    references: [requests.id],
  }),
}));

// ─── Release one (migrations/0001_release_one.sql) ──────────────────────────

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "idempotency_keys_pkey", columns: [t.userId, t.key] }),
    index("idx_idempotency_keys_created_at").on(t.createdAt),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    delta: integer("delta").notNull(),
    quantityBefore: integer("quantity_before").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    reason: text("reason"),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_stock_adjustments_inventory_item_id").on(t.inventoryItemId)],
);

export type StockAdjustment = typeof stockAdjustments.$inferSelect;
