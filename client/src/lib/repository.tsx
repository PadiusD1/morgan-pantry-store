import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, saveErrorMessage } from "./queryClient";
import { planItemChange, serverMessage, type ItemChange, type ItemChangeOptions } from "./stock-change";
import { toast } from "@/hooks/use-toast";
import { duplicateRefusal } from "@shared/identity";
import {
  toInventoryItem,
  toClientRecord,
  toTransaction,
  toApiInventoryBody,
  toApiClientBody,
  type ApiInventoryItem,
  type ApiClient,
  type ApiTransaction,
} from "./api-types";
import { findCachedItem } from "./inventory-cache";
import { newClientRecord } from "./new-client";

export type PackageType = "single" | "multi_pack" | "variety_pack" | "case";

export type InventoryItem = {
  id: string;
  name: string;
  brand?: string;
  category: string;
  barcode?: string;
  quantity: number;

  // Package
  packageType?: PackageType;
  unitCount?: number;

  // Weight
  weightPerUnitLbs: number;
  netWeightG?: number;
  unitWeightG?: number;
  weightIsEstimated?: boolean;

  // Cost
  valuePerUnitUsd: number;
  costCents?: number;
  costIsEstimated?: boolean;
  currency?: string;

  // Metadata
  reorderThreshold?: number;
  allergens?: string[];

  // Data provenance
  winningSource?: string;
  matchConfidence?: number;

  createdAt: string;
  updatedAt: string;
};

export type ClientType = "student" | "partner";

export type ClientRecord = {
  id: string;
  name: string;
  identifier: string;
  contact?: string;
  phone?: string;
  email?: string;
  classification?: string;
  address?: string;
  dateOfBirth?: string;
  householdSize?: number;
  eligibleDate?: string;
  certificationDate?: string;
  status?: string;
  clientType?: ClientType;
  organization?: string;
  partnershipType?: string;
  allergies?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TransactionItem = {
  itemId: string;
  name: string;
  quantity: number;
  weightPerUnitLbs: number;
  valuePerUnitUsd: number;
};

export type TransactionType = "IN" | "OUT";

export type GeoLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

export type Transaction = {
  id: string;
  type: TransactionType;
  timestamp: string;
  items: TransactionItem[];
  source?: string;
  donor?: string;
  clientId?: string;
  clientName?: string;
  isEmergency?: boolean;
  location?: GeoLocation;
};

export type Settings = {
  visitWarningDays: number;
};

export type BarcodeCacheEntry = {
  name?: string;
  category?: string;
  weightPerUnitLbs?: number;
  allergens?: string[];
  cachedAt: string;
};

export type RepositoryState = {
  inventory: InventoryItem[];
  clients: ClientRecord[];
  transactions: Transaction[];
  settings: Settings;
  barcodeCache: Record<string, BarcodeCacheEntry>;
  sources: string[];
  categories: string[];
};

export type RepositoryContextValue = RepositoryState & {
  addOrUpdateItem: (partial: ItemChange, options?: ItemChangeOptions) => InventoryItem;
  adjustItemQuantity: (itemId: string, delta: number) => void;
  recordInbound: (options: {
    itemId: string;
    quantity: number;
    source?: string;
    donor?: string;
    donorClientId?: string;
    donorId?: string;
    timestamp?: string;
    location?: GeoLocation;
  }) => Promise<void>;
  recordOutbound: (options: {
    client: { id?: string; name: string; identifier: string; contact?: string; email?: string; classification?: string };
    items: { itemId: string; quantity: number }[];
    timestamp?: string;
    location?: GeoLocation;
    isEmergency?: boolean;
  }) => Promise<{ client: ClientRecord }>;
  upsertClient: (partial: Partial<ClientRecord> & { name: string; identifier: string }) => ClientRecord;
  updateSettings: (partial: Partial<Settings>) => void;
  upsertBarcodeCache: (barcode: string, entry: Omit<BarcodeCacheEntry, "cachedAt">) => void;
  addSource: (source: string) => void;
  categories: string[];
  addCategory: (category: string) => void;
};

// ─── localStorage helpers for client-only state ────────────────────────────

const LOCAL_KEY = "morgan-local-settings:v1";

type LocalState = {
  settings: Settings;
  barcodeCache: Record<string, BarcodeCacheEntry>;
  sources: string[];
  categories: string[];
};

const defaultLocal: LocalState = {
  settings: { visitWarningDays: 7 },
  barcodeCache: {},
  sources: ["Donation", "Purchase", "Transfer", "Other"],
  categories: [
    "Beverages",
    "Bread & Bakery",
    "Canned Goods",
    "Cereals & Breakfast",
    "Condiments & Sauces",
    "Dairy & Eggs",
    "Frozen Foods",
    "Grains & Pasta",
    "Meat & Poultry",
    "Produce",
    "Snacks",
    "Baby Food",
    "Personal Care",
    "Household",
    "Other",
  ],
};

function loadLocal(): LocalState {
  if (typeof window === "undefined") return defaultLocal;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return defaultLocal;
    return { ...defaultLocal, ...JSON.parse(raw) };
  } catch {
    return defaultLocal;
  }
}

function saveLocal(state: LocalState) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function uuid() {
  return crypto.randomUUID();
}

// ─── Context ────────────────────────────────────────────────────────────────

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function RepositoryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // ── API queries ─────────────────────────────────────────────────────────
  const inventoryQuery = useQuery<ApiInventoryItem[]>({
    queryKey: ["/api/inventory"],
  });

  const clientsQuery = useQuery<ApiClient[]>({
    queryKey: ["/api/clients"],
  });

  const transactionsQuery = useQuery<ApiTransaction[]>({
    queryKey: ["/api/transactions"],
  });

  // ── Adapted data ────────────────────────────────────────────────────────
  const inventory = useMemo(
    () => (inventoryQuery.data ?? []).map(toInventoryItem),
    [inventoryQuery.data],
  );

  const clients = useMemo(
    () => (clientsQuery.data ?? []).map(toClientRecord),
    [clientsQuery.data],
  );

  const transactions = useMemo(
    () => (transactionsQuery.data ?? []).map(toTransaction),
    [transactionsQuery.data],
  );

  // ── Client-only localStorage state ──────────────────────────────────────
  const [local, setLocal] = useState<LocalState>(loadLocal);
  useEffect(() => { saveLocal(local); }, [local]);

  // ── Pending item creates: temp ID → Promise<server ID> ─────────────────
  const pendingCreates = useRef<Map<string, Promise<string>>>(new Map());

  // ── Pending client creates: temp ID → Promise<server ID> ──────────────
  const pendingClientCreates = useRef<Map<string, Promise<string>>>(new Map());

  // ── Resolve an item ID: if it's a pending temp ID, await the real one ──
  async function resolveItemId(id: string): Promise<string> {
    const pending = pendingCreates.current.get(id);
    if (pending) return pending;
    return id;
  }

  // ── Resolve a client ID: if it's a pending temp ID, await the real one ──
  async function resolveClientId(id: string): Promise<string> {
    const pending = pendingClientCreates.current.get(id);
    if (pending) return pending;
    return id;
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  function addOrUpdateItem(partial: ItemChange, options?: ItemChangeOptions): InventoryItem {
    const now = new Date().toISOString();
    const currentInventory = (inventoryQuery.data ?? []).map(toInventoryItem);
    const existing =
      (partial.id && currentInventory.find((i) => i.id === partial.id)) ||
      (partial.barcode ? currentInventory.find((i) => i.barcode && i.barcode === partial.barcode) : undefined);

    if (existing) {
      const { fields, body, adds, quantity } = planItemChange(existing.quantity, partial, options);
      const updated: InventoryItem = { ...existing, ...fields, quantity, updatedAt: now };

      // Optimistic update
      queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) =>
        (old ?? []).map((i) => (i.id === existing.id ? { ...i, ...toOptimisticApiItem(updated) } : i)),
      );

      // Fire API. On failure, invalidate to roll the optimistic edit back to the
      // server's truth instead of silently leaving a phantom change in the cache.
      apiRequest("PATCH", `/api/inventory/${existing.id}`, body)
        .then(() =>
          adds > 0
            ? apiRequest("POST", `/api/inventory/${existing.id}/adjust`, { delta: adds, reason: "import" }, { idempotencyKey: uuid() })
            : undefined,
        )
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/inventory"] }))
        .catch((e) => {
          showStockRefusal(e);
          return queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        });

      return updated;
    }

    // Create new item
    const tempId = partial.id ?? uuid();
    const item: InventoryItem = {
      id: tempId,
      name: partial.name,
      brand: partial.brand,
      category: partial.category ?? "Uncategorized",
      barcode: partial.barcode?.trim() || undefined,
      quantity: partial.quantity ?? 0,

      packageType: partial.packageType ?? "single",
      unitCount: partial.unitCount ?? 1,

      weightPerUnitLbs: partial.weightPerUnitLbs ?? 0,
      netWeightG: partial.netWeightG,
      unitWeightG: partial.unitWeightG,
      weightIsEstimated: partial.weightIsEstimated,

      valuePerUnitUsd: partial.valuePerUnitUsd ?? 0,
      costCents: partial.costCents,
      costIsEstimated: partial.costIsEstimated,
      currency: partial.currency ?? "USD",

      reorderThreshold: partial.reorderThreshold,
      allergens: partial.allergens,

      winningSource: partial.winningSource,
      matchConfidence: partial.matchConfidence,

      createdAt: now,
      updatedAt: now,
    };

    // Optimistic update
    queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) => [
      ...(old ?? []),
      toOptimisticApiItem(item),
    ]);

    // Track pending create. On success it resolves to the real server ID; on
    // failure it REJECTS so any awaiter (recordInbound / recordOutbound) can
    // surface the error instead of silently POSTing a transaction against a
    // temp ID the server never stored.
    const createPromise = apiRequest("POST", "/api/inventory", toApiInventoryBody(item), {
      idempotencyKey: options?.idempotencyKey ?? uuid(),
    })
      .then(async (res) => {
        const created: ApiInventoryItem = await res.json();
        // Replace temp ID in cache with real data. If a refetch removed the
        // optimistic row while the create was in flight, append the server row.
        queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) =>
          upsertApiRow(old, tempId, created),
        );
        pendingCreates.current.delete(tempId);
        return created.id;
      })
      .catch((err) => {
        // Roll the optimistic row back to server truth, then propagate.
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        pendingCreates.current.delete(tempId);
        throw err instanceof Error ? err : new Error(String(err));
      });

    pendingCreates.current.set(tempId, createPromise);
    // Standalone callers (CSV import, inventory add) don't await this promise —
    // swallow the rejection here so it isn't reported as unhandled. Awaiters
    // still observe the rejection through their own `await`.
    createPromise.catch(() => {});

    return item;
  }

  // A refused stock change is shown, never dropped.
  function showStockRefusal(e: unknown) {
    toast({
      title: "Not saved",
      description: saveErrorMessage(e, serverMessage(e) ?? "The stock was not changed. Please try again."),
      variant: "destructive",
    });
  }

  function adjustItemQuantity(itemId: string, delta: number) {
    // Optimistic update
    queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) =>
      (old ?? []).map((i) => {
        if (i.id !== itemId) return i;
        return { ...i, quantity: Math.max(0, i.quantity + delta), updatedAt: new Date().toISOString() };
      }),
    );

    // Send only the difference, applied on the server, so a stale page can not
    // overwrite a check in made since it loaded (PLAN.md item 33).
    apiRequest("POST", `/api/inventory/${itemId}/adjust`, { delta }, { idempotencyKey: uuid() })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/inventory"] }))
      // On failure, show why and roll the optimistic +/- back to server truth.
      .catch((e) => {
        showStockRefusal(e);
        return queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      });
  }

  function upsertClient(partial: Partial<ClientRecord> & { name: string; identifier: string }): ClientRecord {
    const now = new Date().toISOString();
    const currentClients = (clientsQuery.data ?? []).map(toClientRecord);

    // Bonding rule: same student info coming in twice should merge into one record.
    // Prefer explicit id; otherwise match by normalized identifier (case-insensitive,
    // trimmed) so re-typing a known ID merges with the existing record instead of
    // creating a parallel duplicate. Scope by client_type so a partner identifier
    // doesn't absorb a student record (and vice versa).
    const normalize = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
    const partialIdentifier = normalize(partial.identifier);
    const partialType = partial.clientType ?? "student";
    const existing = partial.id
      ? currentClients.find((c) => c.id === partial.id)
      : currentClients.find(
          (c) =>
            normalize(c.identifier) === partialIdentifier &&
            (c.clientType ?? "student") === partialType,
        );

    if (existing) {
      // Merge: keep existing values for any field the caller didn't supply, so
      // partial check-out submissions don't blow away phone/email/etc.
      const merged: Partial<ClientRecord> = {};
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined && value !== null && value !== "") {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      const updated: ClientRecord = { ...existing, ...merged, updatedAt: now };

      queryClient.setQueryData<ApiClient[]>(["/api/clients"], (old) =>
        (old ?? []).map((c) => (c.id === existing.id ? toOptimisticApiClient(updated) : c)),
      );

      apiRequest("PATCH", `/api/clients/${existing.id}`, toApiClientBody(merged))
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/clients"] }))
        // On failure, invalidate to roll the optimistic merge back to server truth.
        .catch((err) => {
          const refusal = duplicateRefusal(err);
          if (refusal) toast({ title: "Not saved", description: refusal, variant: "destructive" });
          return queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        });

      return updated;
    }

    const tempId = uuid();
    const client: ClientRecord = newClientRecord(partial, tempId, now);

    queryClient.setQueryData<ApiClient[]>(["/api/clients"], (old) => [
      ...(old ?? []),
      toOptimisticApiClient(client),
    ]);

    // Track pending client create so recordOutbound can await the real ID.
    // A 409 (duplicate identifier) is NOT a failure — a real record already
    // exists, so we resolve to that record's id. Any other non-OK status, or a
    // network error, REJECTS so recordOutbound can surface the failure and
    // avoid POSTing a transaction against a client the server never stored.
    const createPromise = apiRequest("POST", "/api/clients", toApiClientBody(client))
      .then(async (res) => {
        const created: ApiClient = await res.json();
        queryClient.setQueryData<ApiClient[]>(["/api/clients"], (old) =>
          upsertApiRow(old, tempId, created),
        );
        pendingClientCreates.current.delete(tempId);
        return created.id;
      })
      .catch(async (err) => {
        // apiRequest throws `Error("{status}: {body}")`. A 409 means the client
        // already exists — recover its canonical id instead of failing.
        const status = err instanceof Error ? parseInt(err.message, 10) : NaN;
        const refusal = duplicateRefusal(err);
        if (refusal) toast({ title: "Not saved", description: refusal, variant: "destructive" });
        if (status === 409 && !refusal) {
          queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
          pendingClientCreates.current.delete(tempId);
          try {
            const lookup = await apiRequest(
              "GET",
              `/api/clients?type=${client.clientType === "partner" ? "partner" : "student"}`,
            );
            const list: ApiClient[] = await lookup.json();
            const dup = list.find((c) => normalize(c.identifier) === partialIdentifier);
            if (dup) return dup.id;
          } catch {
            // fall through to reject below
          }
          // Duplicate exists but we couldn't resolve its id — treat as failure.
          throw err instanceof Error ? err : new Error(String(err));
        }
        // Genuine failure (network / 4xx / 5xx): roll back and propagate.
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        pendingClientCreates.current.delete(tempId);
        throw err instanceof Error ? err : new Error(String(err));
      });

    pendingClientCreates.current.set(tempId, createPromise);
    // Standalone callers (Clients / Partners pages) don't await this promise —
    // swallow the rejection here so it isn't reported as unhandled. Awaiters
    // (recordOutbound) still observe the rejection through their own `await`.
    createPromise.catch(() => {});

    return client;
  }

  async function recordInbound(options: {
    itemId: string;
    quantity: number;
    source?: string;
    donor?: string;
    donorClientId?: string;
    donorId?: string;
    timestamp?: string;
    location?: GeoLocation;
  }): Promise<void> {
    const { itemId, quantity, source, donor, donorClientId, donorId, location } = options;
    const timestamp = options.timestamp ?? new Date().toISOString();

    if (!quantity || quantity <= 0) return;

    // The live cache, not this render's snapshot, so an item the page created a
    // moment ago is found. A missing item throws, the caller says nothing was recorded.
    const cached = queryClient.getQueryData<ApiInventoryItem[]>(["/api/inventory"]) ?? inventoryQuery.data;
    const item = toInventoryItem(findCachedItem(cached, itemId));

    // Optimistic inventory update. The SERVER is the source of truth for stock —
    // it applies the +received delta atomically when the IN transaction is posted
    // (see cross-agent contract). This is only a hint for instant UI feedback and
    // is reconciled by the invalidation below.
    queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) =>
      (old ?? []).map((i) =>
        i.id === itemId ? { ...i, quantity: i.quantity + quantity, updatedAt: timestamp } : i,
      ),
    );

    // Optimistic transaction
    const tempTxId = uuid();
    const txItem: TransactionItem = {
      itemId: item.id,
      name: item.name,
      quantity,
      weightPerUnitLbs: item.weightPerUnitLbs,
      valuePerUnitUsd: item.valuePerUnitUsd,
    };

    const optimisticTx: ApiTransaction = {
      id: tempTxId,
      type: "IN",
      timestamp,
      source: source ?? null,
      donor: donor ?? null,
      clientId: donorClientId ?? null,
      clientName: donorClientId ? donor ?? null : null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracy: location?.accuracy ?? null,
      createdAt: timestamp,
      items: [{
        id: tempTxId,
        transactionId: tempTxId,
        inventoryItemId: item.id,
        name: item.name,
        quantity,
        weightPerUnitLbs: String(item.weightPerUnitLbs),
        valuePerUnitUsd: String(item.valuePerUnitUsd),
      }],
    };

    queryClient.setQueryData<ApiTransaction[]>(["/api/transactions"], (old) => [
      optimisticTx,
      ...(old ?? []),
    ]);

    try {
      // Resolve the real inventory item ID. For a brand-new item, the page called
      // addOrUpdateItem (which creates it with quantity 0) just before this, so
      // its create POST may still be in flight — await it here to get the real id.
      // If that create failed, this rejects and we roll back below.
      const realItemId = await resolveItemId(itemId);

      // Create the IN transaction. The server applies the inventory delta inside
      // the same DB transaction — do NOT PATCH inventory quantity here.
      await apiRequest("POST", "/api/transactions", {
        type: "IN",
        timestamp,
        source: source ?? null,
        donor: donor ?? null,
        clientId: donorClientId ?? null,
        clientName: donorClientId ? donor ?? null : null,
        donorId: donorId ?? null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracy ?? null,
        items: [{
          inventoryItemId: realItemId,
          name: txItem.name,
          quantity: txItem.quantity,
          weightPerUnitLbs: String(txItem.weightPerUnitLbs),
          valuePerUnitUsd: String(txItem.valuePerUnitUsd),
        }],
      });

      // Confirmed — reconcile the optimistic cache with the server's truth.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    } catch (err) {
      // Roll back every optimistic mutation to the server's truth, then rethrow
      // so the page can surface an error toast and skip the success receipt.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async function recordOutbound(options: {
    client: { id?: string; name: string; identifier: string; contact?: string; email?: string; classification?: string };
    items: { itemId: string; quantity: number }[];
    timestamp?: string;
    location?: GeoLocation;
    isEmergency?: boolean;
  }): Promise<{ client: ClientRecord }> {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const isEmergency = Boolean(options.isEmergency);
    if (!options.items.length) {
      throw new Error("Check-out requires at least one item.");
    }

    const client = upsertClient({
      id: options.client.id,
      name: options.client.name,
      identifier: options.client.identifier,
      contact: options.client.contact,
      // Only typed values go in, so a blank box never wipes a stored one.
      ...(options.client.email ? { email: options.client.email } : {}),
      ...(options.client.classification ? { classification: options.client.classification } : {}),
    });

    const currentInventory = (inventoryQuery.data ?? []).map(toInventoryItem);

    // Optimistic inventory update — auto-adjust if insufficient, never block. The
    // SERVER is the source of truth: it subtracts the given quantity (clamped at 0)
    // atomically when the OUT transaction is posted (see cross-agent contract).
    queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) =>
      (old ?? []).map((apiItem) => {
        const cartItem = options.items.find((i) => i.itemId === apiItem.id);
        if (!cartItem) return apiItem;
        // If stock is insufficient, the net result is 0 (auto-adjusted)
        const newQty = Math.max(0, apiItem.quantity - cartItem.quantity);
        return { ...apiItem, quantity: newQty, updatedAt: timestamp };
      }),
    );

    // Build transaction items
    const txItems: TransactionItem[] = options.items
      .map((i) => {
        const base = currentInventory.find((item) => item.id === i.itemId);
        if (!base) return undefined;
        return {
          itemId: base.id,
          name: base.name,
          quantity: i.quantity,
          weightPerUnitLbs: base.weightPerUnitLbs,
          valuePerUnitUsd: base.valuePerUnitUsd,
        };
      })
      .filter(Boolean) as TransactionItem[];

    // Optimistic transaction
    const tempTxId = uuid();
    const optimisticTx: ApiTransaction = {
      id: tempTxId,
      type: "OUT",
      timestamp,
      source: null,
      donor: null,
      clientId: client.id,
      clientName: client.name,
      isEmergency,
      latitude: options.location?.latitude ?? null,
      longitude: options.location?.longitude ?? null,
      accuracy: options.location?.accuracy ?? null,
      createdAt: timestamp,
      items: txItems.map((ti) => ({
        id: tempTxId,
        transactionId: tempTxId,
        inventoryItemId: ti.itemId,
        name: ti.name,
        quantity: ti.quantity,
        weightPerUnitLbs: String(ti.weightPerUnitLbs),
        valuePerUnitUsd: String(ti.valuePerUnitUsd),
      })),
    };

    if (txItems.length) {
      queryClient.setQueryData<ApiTransaction[]>(["/api/transactions"], (old) => [
        optimisticTx,
        ...(old ?? []),
      ]);
    }

    try {
      // CRITICAL: resolve the real client ID before posting the transaction. For a
      // new client the create POST may still be in flight — await it so the
      // transaction links to the correct server client ID (and so a client-create
      // failure surfaces here rather than being silently dropped).
      const realClientId = await resolveClientId(client.id);

      if (txItems.length) {
        // Resolve item IDs (awaiting any in-flight item creates), then post the
        // OUT transaction. The server subtracts stock atomically — do NOT PATCH
        // inventory quantity here.
        const apiItems = await Promise.all(
          txItems.map(async (ti) => ({
            inventoryItemId: await resolveItemId(ti.itemId),
            name: ti.name,
            quantity: ti.quantity,
            weightPerUnitLbs: String(ti.weightPerUnitLbs),
            valuePerUnitUsd: String(ti.valuePerUnitUsd),
          })),
        );

        await apiRequest("POST", "/api/transactions", {
          type: "OUT",
          timestamp,
          clientId: realClientId,
          clientName: client.name,
          clientClassification: options.client.classification ?? null,
          isEmergency,
          latitude: options.location?.latitude ?? null,
          longitude: options.location?.longitude ?? null,
          accuracy: options.location?.accuracy ?? null,
          items: apiItems,
        });
      }

      // Confirmed — reconcile the optimistic cache with the server's truth.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });

      // Return the client carrying its resolved (real) server id so the caller
      // can select the persisted record for the receipt.
      return { client: { ...client, id: realClientId } };
    } catch (err) {
      // Roll back every optimistic mutation to the server's truth, then rethrow
      // so the page can surface an error toast and skip the success receipt.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  function updateSettings(partial: Partial<Settings>) {
    setLocal((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));
  }

  function upsertBarcodeCache(barcode: string, entry: Omit<BarcodeCacheEntry, "cachedAt">) {
    const cachedAt = new Date().toISOString();
    setLocal((prev) => ({
      ...prev,
      barcodeCache: { ...prev.barcodeCache, [barcode]: { ...entry, cachedAt } },
    }));
  }

  function addSource(source: string) {
    setLocal((prev) => {
      if (prev.sources?.includes(source)) return prev;
      return { ...prev, sources: [...(prev.sources || []), source] };
    });
  }

  function addCategory(category: string) {
    setLocal((prev) => {
      if (prev.categories?.includes(category)) return prev;
      return { ...prev, categories: [...(prev.categories || []), category] };
    });
  }

  // ── Loading & error gates ───────────────────────────────────────────────
  const isLoading = inventoryQuery.isLoading || clientsQuery.isLoading || transactionsQuery.isLoading;
  const error = inventoryQuery.error || clientsQuery.error || transactionsQuery.error;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-destructive">Failed to load data: {(error as Error).message}</p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
            queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
            queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const value: RepositoryContextValue = {
    inventory,
    clients,
    transactions,
    settings: local.settings,
    barcodeCache: local.barcodeCache,
    sources: local.sources,
    categories: local.categories,
    addOrUpdateItem,
    adjustItemQuantity,
    recordInbound,
    recordOutbound,
    upsertClient,
    updateSettings,
    upsertBarcodeCache,
    addSource,
    addCategory,
  };

  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository() {
  const ctx = useContext(RepositoryContext);
  if (!ctx) throw new Error("useRepository must be used inside RepositoryProvider");
  return ctx;
}

export function useClientWithHistory(clientId: string | undefined) {
  const { clients, transactions } = useRepository();
  if (!clientId) return { client: undefined, visits: [] as Transaction[] };
  const client = clients.find((c) => c.id === clientId);
  const visits = transactions.filter((t) => t.type === "OUT" && t.clientId === clientId);
  return { client, visits };
}

export function useInventorySummary() {
  const { inventory } = useRepository();
  const distinctItems = inventory.length;
  const totalUnits = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const totalWeightLbs = inventory.reduce((sum, i) => sum + i.quantity * i.weightPerUnitLbs, 0);
  return { distinctItems, totalUnits, totalWeightLbs };
}

export function isLowStock(item: InventoryItem): boolean {
  if (item.reorderThreshold == null) return false;
  return item.quantity <= item.reorderThreshold;
}

export async function getCurrentLocation(): Promise<GeoLocation | undefined> {
  if (!navigator.geolocation) return undefined;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 5000,
        enableHighAccuracy: true,
      });
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch {
    return undefined;
  }
}

// ─── Auto-Categorization ─────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Dairy & Eggs": ["milk", "cheese", "yogurt", "butter", "cream"],
  "Bread & Bakery": ["bread", "roll", "bun", "bagel", "muffin"],
  "Canned Goods": ["can", "canned", "soup", "beans", "tuna"],
  "Grains & Pasta": ["rice", "pasta", "noodle", "flour", "oat"],
  "Meat & Poultry": ["chicken", "beef", "pork", "turkey", "sausage", "meat"],
  "Produce": ["apple", "banana", "orange", "lettuce", "tomato", "vegetable", "fruit"],
  "Beverages": ["juice", "water", "soda", "tea", "coffee"],
  "Snacks": ["chip", "cracker", "cookie", "candy", "snack", "bar"],
  "Cereals & Breakfast": ["cereal", "oatmeal", "granola", "pancake"],
  "Condiments & Sauces": ["ketchup", "mustard", "sauce", "dressing", "mayo"],
  "Frozen Foods": ["frozen", "pizza", "ice cream"],
  "Personal Care": ["diaper", "soap", "shampoo", "toothpaste"],
  "Baby Food": ["baby", "formula", "infant"],
};

const LEARNED_ASSOCIATIONS_KEY = "morgan-learned-categories:v1";

function loadLearnedAssociations(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LEARNED_ASSOCIATIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLearnedAssociation(keyword: string, category: string) {
  try {
    const current = loadLearnedAssociations();
    current[keyword.toLowerCase()] = category;
    window.localStorage.setItem(LEARNED_ASSOCIATIONS_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

export function learnCategoryAssociation(itemName: string, category: string) {
  const words = itemName.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (word.length >= 3) {
      saveLearnedAssociation(word, category);
    }
  }
}

export function suggestCategory(itemName: string): { category: string; confidence: number } {
  if (!itemName.trim()) {
    return { category: "Uncategorized", confidence: 0 };
  }

  const nameLower = itemName.toLowerCase();
  const words = nameLower.split(/\s+/);

  // Check learned associations first (highest priority)
  const learned = loadLearnedAssociations();
  for (const word of words) {
    if (learned[word]) {
      return { category: learned[word], confidence: 0.85 };
    }
  }

  // Check built-in keyword map
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      // Exact word match in item name
      if (words.some((w) => w === keyword || w === keyword + "s" || w === keyword + "es")) {
        return { category, confidence: 0.9 };
      }
    }
  }

  // Partial match (keyword appears as substring)
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        return { category, confidence: 0.7 };
      }
    }
  }

  return { category: "Uncategorized", confidence: 0 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function upsertApiRow<T extends { id: string }>(
  old: T[] | undefined,
  tempId: string,
  created: T,
): T[] {
  const rows = old ?? [];
  let foundTemp = false;
  const replaced = rows.map((row) => {
    if (row.id !== tempId) return row;
    foundTemp = true;
    return created;
  });
  if (foundTemp) return replaced;
  return rows.some((row) => row.id === created.id) ? rows : [...rows, created];
}

function toOptimisticApiItem(item: InventoryItem): ApiInventoryItem {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand ?? null,
    category: item.category,
    barcode: item.barcode ?? null,
    quantity: item.quantity,

    packageType: item.packageType ?? "single",
    unitCount: item.unitCount ?? 1,

    weightPerUnitLbs: String(item.weightPerUnitLbs),
    netWeightG: item.netWeightG ?? null,
    unitWeightG: item.unitWeightG ?? null,
    weightIsEstimated: item.weightIsEstimated ?? false,

    valuePerUnitUsd: String(item.valuePerUnitUsd),
    costCents: item.costCents ?? null,
    costIsEstimated: item.costIsEstimated ?? false,
    currency: item.currency ?? "USD",

    reorderThreshold: item.reorderThreshold ?? null,
    allergens: item.allergens ?? [],
    expirationDate: null,

    dataSourcesTried: null,
    winningSource: item.winningSource ?? null,
    matchConfidence: item.matchConfidence ?? null,
    rawPayload: null,

    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toOptimisticApiClient(client: ClientRecord): ApiClient {
  return {
    id: client.id,
    name: client.name,
    identifier: client.identifier,
    contact: client.contact ?? null,
    phone: client.phone ?? null,
    email: client.email ?? null,
    address: client.address ?? null,
    dateOfBirth: client.dateOfBirth ?? null,
    householdSize: client.householdSize ?? 1,
    eligibleDate: client.eligibleDate ?? null,
    certificationDate: client.certificationDate ?? null,
    status: client.status ?? "active",
    clientType: client.clientType ?? "student",
    organization: client.organization ?? null,
    partnershipType: client.partnershipType ?? null,
    allergies: client.allergies ?? [],
    notes: client.notes ?? null,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}
