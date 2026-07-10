import type { InventoryItem, ClientRecord, Transaction, TransactionItem, GeoLocation } from "./repository";

// ─── API response shapes (what the server returns) ──────────────────────────

export type ApiInventoryItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  barcode: string | null;
  quantity: number;

  // Package
  packageType: string | null;
  unitCount: number | null;

  // Weight
  weightPerUnitLbs: string;
  netWeightG: number | null;
  unitWeightG: number | null;
  weightIsEstimated: boolean;

  // Cost
  valuePerUnitUsd: string;
  costCents: number | null;
  costIsEstimated: boolean;
  currency: string | null;

  // Metadata
  reorderThreshold: number | null;
  allergens: string[];
  expirationDate: string | null;

  // Data provenance
  dataSourcesTried: unknown | null;
  winningSource: string | null;
  matchConfidence: number | null;
  rawPayload: unknown | null;

  createdAt: string;
  updatedAt: string;
};

export type ApiClient = {
  id: string;
  name: string;
  identifier: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  dateOfBirth: string | null;
  householdSize: number | null;
  eligibleDate: string | null;
  certificationDate: string | null;
  status: string | null;
  clientType?: string | null;
  organization?: string | null;
  partnershipType?: string | null;
  allergies: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiTransactionItem = {
  id: string;
  transactionId: string;
  inventoryItemId: string;
  name: string;
  quantity: number;
  weightPerUnitLbs: string;
  valuePerUnitUsd: string;
};

export type ApiTransaction = {
  id: string;
  type: "IN" | "OUT";
  timestamp: string;
  source: string | null;
  donor: string | null;
  clientId: string | null;
  clientName: string | null;
  isEmergency?: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  createdAt: string;
  items?: ApiTransactionItem[];
};

// ─── API → Frontend adapters ────────────────────────────────────────────────

export function toInventoryItem(api: ApiInventoryItem): InventoryItem {
  return {
    id: api.id,
    name: api.name,
    brand: api.brand ?? undefined,
    category: api.category,
    barcode: api.barcode ?? undefined,
    quantity: api.quantity,

    packageType: (api.packageType as InventoryItem["packageType"]) ?? "single",
    unitCount: api.unitCount ?? 1,

    weightPerUnitLbs: parseFloat(api.weightPerUnitLbs) || 0,
    netWeightG: api.netWeightG ?? undefined,
    unitWeightG: api.unitWeightG ?? undefined,
    weightIsEstimated: api.weightIsEstimated ?? false,

    valuePerUnitUsd: parseFloat(api.valuePerUnitUsd) || 0,
    costCents: api.costCents ?? undefined,
    costIsEstimated: api.costIsEstimated ?? false,
    currency: api.currency ?? "USD",

    reorderThreshold: api.reorderThreshold ?? undefined,
    allergens: api.allergens.length > 0 ? api.allergens : undefined,

    winningSource: api.winningSource ?? undefined,
    matchConfidence: api.matchConfidence ?? undefined,

    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

export function toClientRecord(api: ApiClient): ClientRecord {
  return {
    id: api.id,
    name: api.name,
    identifier: api.identifier,
    contact: api.contact ?? undefined,
    phone: api.phone ?? undefined,
    email: api.email ?? undefined,
    address: api.address ?? undefined,
    dateOfBirth: api.dateOfBirth ?? undefined,
    householdSize: api.householdSize ?? 1,
    eligibleDate: api.eligibleDate ?? undefined,
    certificationDate: api.certificationDate ?? undefined,
    status: api.status ?? "active",
    clientType: (api.clientType as ClientRecord["clientType"]) ?? "student",
    organization: api.organization ?? undefined,
    partnershipType: api.partnershipType ?? undefined,
    allergies: api.allergies.length > 0 ? api.allergies : undefined,
    notes: api.notes ?? undefined,
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

export function toTransactionItem(api: ApiTransactionItem): TransactionItem {
  return {
    itemId: api.inventoryItemId,
    name: api.name,
    quantity: api.quantity,
    weightPerUnitLbs: parseFloat(api.weightPerUnitLbs) || 0,
    valuePerUnitUsd: parseFloat(api.valuePerUnitUsd) || 0,
  };
}

export function toTransaction(api: ApiTransaction): Transaction {
  const location: GeoLocation | undefined =
    api.latitude != null && api.longitude != null
      ? { latitude: api.latitude, longitude: api.longitude, accuracy: api.accuracy ?? undefined }
      : undefined;

  return {
    id: api.id,
    type: api.type,
    timestamp: api.timestamp,
    items: (api.items ?? []).map(toTransactionItem),
    source: api.source ?? undefined,
    donor: api.donor ?? undefined,
    clientId: api.clientId ?? undefined,
    clientName: api.clientName ?? undefined,
    isEmergency: Boolean(api.isEmergency),
    location,
  };
}

// ─── Frontend → API body adapters ───────────────────────────────────────────

export function toApiInventoryBody(item: Partial<InventoryItem>) {
  const body: Record<string, unknown> = {};
  if (item.name !== undefined) body.name = item.name;
  if (item.brand !== undefined) body.brand = item.brand || null;
  if (item.category !== undefined) body.category = item.category;
  if (item.barcode !== undefined) body.barcode = item.barcode || null;
  if (item.quantity !== undefined) body.quantity = item.quantity;

  if (item.packageType !== undefined) body.packageType = item.packageType;
  if (item.unitCount !== undefined) body.unitCount = item.unitCount;

  if (item.weightPerUnitLbs !== undefined) body.weightPerUnitLbs = String(item.weightPerUnitLbs);
  if (item.netWeightG !== undefined) body.netWeightG = item.netWeightG ?? null;
  if (item.unitWeightG !== undefined) body.unitWeightG = item.unitWeightG ?? null;
  if (item.weightIsEstimated !== undefined) body.weightIsEstimated = item.weightIsEstimated;

  if (item.valuePerUnitUsd !== undefined) body.valuePerUnitUsd = String(item.valuePerUnitUsd);
  if (item.costCents !== undefined) body.costCents = item.costCents ?? null;
  if (item.costIsEstimated !== undefined) body.costIsEstimated = item.costIsEstimated;
  if (item.currency !== undefined) body.currency = item.currency;

  if (item.reorderThreshold !== undefined) body.reorderThreshold = item.reorderThreshold ?? null;
  if (item.allergens !== undefined) body.allergens = item.allergens ?? [];
  return body;
}

export function toApiClientBody(client: Partial<ClientRecord>) {
  const body: Record<string, unknown> = {};
  if (client.name !== undefined) body.name = client.name;
  if (client.identifier !== undefined) body.identifier = client.identifier;
  if (client.contact !== undefined) body.contact = client.contact || null;
  if (client.phone !== undefined) body.phone = client.phone || null;
  if (client.email !== undefined) body.email = client.email || null;
  if (client.address !== undefined) body.address = client.address || null;
  if (client.dateOfBirth !== undefined) body.dateOfBirth = client.dateOfBirth || null;
  if (client.householdSize !== undefined) body.householdSize = client.householdSize ?? 1;
  if (client.eligibleDate !== undefined) body.eligibleDate = client.eligibleDate || null;
  if (client.certificationDate !== undefined) body.certificationDate = client.certificationDate || null;
  if (client.status !== undefined) body.status = client.status || "active";
  if (client.clientType !== undefined) body.clientType = client.clientType || "student";
  if (client.organization !== undefined) body.organization = client.organization || null;
  if (client.partnershipType !== undefined) body.partnershipType = client.partnershipType || null;
  if (client.allergies !== undefined) body.allergies = client.allergies ?? [];
  if (client.notes !== undefined) body.notes = client.notes || null;
  return body;
}

// ─── Request Management Types ────────────────────────────────────────

export type ApiRequestItem = {
  id: string;
  requestId: string;
  inventoryItemId: string;
  itemName: string;
  itemCategory: string | null;
  requestedQuantity: number;
  approvedQuantity: number | null;
  fulfilledQuantity: number | null;
  reserved: boolean;
  denialReason: string | null;
};

export type ApiAuditLogEntry = {
  id: string;
  requestId: string;
  action: string;
  actor: string | null;
  details: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  createdAt: string;
};

export type ApiNotification = {
  id: string;
  requestId: string | null;
  recipientType: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export type ApiRequest = {
  id: string;
  clientId: string | null;
  clientName: string;
  clientIdentifier: string;
  clientEmail: string | null;
  clientPhone: string | null;
  reason: string;
  studentNote?: string | null;
  // snake_case sibling for the SQL `student_note` column (returned by lookup endpoints)
  student_note?: string | null;
  status: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  pickupDeadline: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ApiRequestItem[];
  auditLog?: ApiAuditLogEntry[];
  clientHistory?: ApiRequest[];
};

// ─── Donor Types ─────────────────────────────────────────────────────

export type ApiDonor = {
  id: string;
  name: string;
  organization: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalDonations?: number;
  totalItemsDonated?: number;
  totalWeightDonated?: number;
  totalValueDonated?: number;
  lastDonationDate?: string | null;
  firstDonationDate?: string | null;
  averageDonationItems?: number;
};
