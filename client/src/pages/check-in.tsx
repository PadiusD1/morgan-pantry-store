import React, { useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { currentLocation } from "@/lib/location";
import { lookupBarcode, type EnrichedProduct } from "@/lib/barcode-lookup";
import { createScanQueue, useScanner } from "@/lib/scanner";
import { apiRequest, saveErrorMessage, withIdempotencyKey } from "@/lib/queryClient";
import { useSaveGuard } from "@/lib/save-guard";
import { toInventoryItem, type ApiInventoryItem } from "@/lib/api-types";
import { itemOptions, nextSelectedId, resolveSelectedId } from "@/lib/check-in-selection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Import, SearchIcon, XIcon, Loader2, CheckCircle2, AlertCircle, Package, Scale, DollarSign, ShieldCheck } from "lucide-react";

type DonorOption = {
  id: string;
  name: string;
  organization?: string | null;
  status?: string;
  fromPartner?: boolean;
};

type ApiClientLite = {
  id: string;
  name: string;
  organization?: string | null;
  clientType?: string | null;
  partnershipType?: string | null;
};

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "found-existing"; itemName: string }
  | { phase: "found-created"; itemName: string; source: string; product: EnrichedProduct }
  | { phase: "not-found" }
  | { phase: "error"; message: string };

export default function CheckInPage() {
  const { inventory, addOrUpdateItem, recordInbound, upsertBarcodeCache, sources, donors: localDonors, addSource, addDonor, categories, addCategory } = useRepository();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ─── Donor list: pull authoritative list from /api/donors so every donor shows up,
  // not just the three hard-coded localStorage seeds.
  const { data: apiDonors = [] } = useQuery<DonorOption[]>({
    queryKey: ["/api/donors"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/donors");
      return res.json();
    },
  });

  // Partner organizations can also donate to the pantry — surface them in the same
  // selector so staff don't have to add a parallel "donor" record for each partner.
  const { data: apiPartners = [] } = useQuery<ApiClientLite[]>({
    queryKey: ["/api/clients", "type=partner"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/clients?type=partner");
      return res.json();
    },
  });

  // Merge: API donors first, then partner orgs (de-duped by name), then any
  // localStorage-only legacy names as a fallback.
  const donorOptions = useMemo<DonorOption[]>(() => {
    const seen = new Map<string, DonorOption>();
    for (const d of apiDonors) {
      if (!d?.name) continue;
      seen.set(d.name, d);
    }
    for (const p of apiPartners) {
      if (!p?.name || seen.has(p.name)) continue;
      seen.set(p.name, {
        id: `partner:${p.id}`,
        name: p.name,
        organization: p.organization ?? null,
        fromPartner: true,
      });
    }
    for (const name of localDonors || []) {
      if (name && !seen.has(name)) {
        seen.set(name, { id: `local:${name}`, name });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [apiDonors, apiPartners, localDonors]);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<string | "">("");
  // A newly registered item, kept selectable until the list holds its saved row.
  const [pinnedItem, setPinnedItem] = useState<ReturnType<typeof toInventoryItem> | null>(null);
  const [quantity, setQuantity] = useState<number>(0);
  const [source, setSource] = useState("");
  const [donor, setDonor] = useState("");
  const [donorPartnerId, setDonorPartnerId] = useState<string | undefined>();
  const [isNewSource, setIsNewSource] = useState(false);
  const [isNewDonor, setIsNewDonor] = useState(false);
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [scanState, setScanState] = useState<ScanState>({ phase: "idle" });

  const [newItem, setNewItem] = useState({
    name: "",
    category: "Uncategorized",
    barcode: "",
    brand: "",
    weightPerUnitLbs: 0,
    valuePerUnitUsd: 0,
    allergens: [] as string[],
  });
  const quantityInputRef = useRef<HTMLInputElement>(null);

  const sortedInventory = useMemo(
    () => [...inventory].sort((a, b) => a.name.localeCompare(b.name)),
    [inventory],
  );

  const sourceOptions = useMemo(() => {
    const next = [...(sources || [])];
    if (apiPartners.length > 0 && !next.includes("Partner Donation")) {
      const donationIndex = next.indexOf("Donation");
      next.splice(donationIndex >= 0 ? donationIndex + 1 : next.length, 0, "Partner Donation");
    }
    return next;
  }, [apiPartners.length, sources]);

  const isDonationSource = source === "Donation" || source === "Partner Donation";

  // Get the currently selected item for enrichment display
  const shownSelectedId = resolveSelectedId(selectedId, sortedInventory, pinnedItem);
  const itemChoices = useMemo(
    () => itemOptions(sortedInventory, pinnedItem, shownSelectedId),
    [sortedInventory, pinnedItem, shownSelectedId],
  );
  const selectedItem = useMemo(
    () => (shownSelectedId ? itemChoices.find((i) => i.id === shownSelectedId) : undefined),
    [shownSelectedId, itemChoices],
  );

  async function handleBarcodeLookup(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;

    setScanState({ phase: "scanning" });

    try {
      const result = await lookupBarcode(trimmed);

      if (result.status === "debounced") {
        setScanState({ phase: "idle" });
        return;
      }

      if (result.status === "exists") {
        const item = toInventoryItem(result.item as ApiInventoryItem);
        setMode("existing");
        setSelectedId((prevId) => {
          // Each scan of the same item bumps the to-receive quantity by 1 — staff can scan a
          // case multiple times without re-typing numbers. Switching items resets to 1.
          setQuantity((prevQty) => (prevId === item.id ? prevQty + 1 : 1));
          return item.id;
        });
        setScanState({ phase: "found-existing", itemName: item.name });
        toast({
          title: "Item already on file — merged",
          description: `${item.name} (${item.quantity} on hand). Existing data populated. Scan again or confirm to record.`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        return;
      }

      if (result.status === "created") {
        const item = toInventoryItem(result.item as ApiInventoryItem);
        upsertBarcodeCache(trimmed, {
          name: item.name,
          category: item.category,
          weightPerUnitLbs: item.weightPerUnitLbs,
          allergens: item.allergens,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        setMode("existing");
        setPinnedItem(item);
        setSelectedId(item.id);
        // First-time scan of a new barcode: pre-fill quantity to 1.
        setQuantity(1);
        setScanState({
          phase: "found-created",
          itemName: item.name,
          source: result.product.winningSource,
          product: result.product,
        });
        toast({
          title: "New item added automatically",
          description: `${item.name} found via ${result.product.winningSource}. Quantity preset to 1 — adjust or scan again to add more.`,
        });
        return;
      }

      // Not found in any API
      setMode("new");
      setNewItem(prev => ({ ...prev, barcode: trimmed }));
      setScanState({ phase: "not-found" });
      toast({
        title: "Barcode not recognized",
        description: "No match found in any product database. Please enter details manually.",
      });
    } catch (err) {
      setScanState({ phase: "error", message: String(err) });
      setMode("new");
      setNewItem(prev => ({ ...prev, barcode: trimmed }));
      toast({
        title: "Lookup failed",
        description: "Could not reach product databases. Please enter details manually.",
      });
    }
  }

  // A scan always reaches the lookup, whatever field has focus, and a code
  // that arrives during a lookup waits its turn.
  const lookupRef = useRef(handleBarcodeLookup);
  lookupRef.current = handleBarcodeLookup;
  const [scanQueue] = useState(() => createScanQueue((code) => lookupRef.current(code)));
  useScanner(scanQueue.push);

  // One save at a time, and a retry keeps the same Idempotency-Key.
  const saveGuard = useSaveGuard();
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await saveGuard.run(submitCheckIn);
  }

  async function submitCheckIn(key: string): Promise<boolean | void> {
    if (!quantity || quantity <= 0) {
      toast({
        title: "Quantity required",
        description: "Enter a quantity greater than zero to record this check-in.",
      });
      return;
    }

    let itemId = shownSelectedId;

    if (mode === "new") {
      if (!newItem.name.trim()) {
        toast({
          title: "Item name required",
          description: "Enter a name for the new item before recording stock.",
        });
        return;
      }
      const finalCategory = newItem.category.trim() || "Uncategorized";
      // Save custom category for future use
      if (finalCategory !== "Uncategorized" && !categories.includes(finalCategory)) {
        addCategory(finalCategory);
      }
      const created = addOrUpdateItem({
        name: newItem.name.trim(),
        brand: newItem.brand?.trim() || undefined,
        category: finalCategory,
        barcode: newItem.barcode?.trim() || undefined,
        quantity: 0,
        weightPerUnitLbs: newItem.weightPerUnitLbs,
        valuePerUnitUsd: newItem.valuePerUnitUsd,
        allergens: newItem.allergens,
      });
      itemId = created.id;
      setPinnedItem(created);
      // Cache barcode so future scans remember all saved info
      if (newItem.barcode?.trim()) {
        upsertBarcodeCache(newItem.barcode.trim(), {
          name: newItem.name.trim(),
          category: finalCategory,
          weightPerUnitLbs: newItem.weightPerUnitLbs,
          allergens: newItem.allergens,
        });
      }
    }

    if (!itemId) return;

    if (isNewSource && source.trim()) {
        addSource(source.trim());
    }
    if (isNewDonor && donor.trim() && isDonationSource) {
        const donorName = donor.trim();
        addDonor(donorName);
        // Persist to /api/donors so it shows up on future check-ins and in the Donors page.
        // Best effort: a duplicate-name failure is fine — the donor still gets used on this transaction.
        try {
          await apiRequest("POST", "/api/donors", { name: donorName, status: "active" });
          queryClient.invalidateQueries({ queryKey: ["/api/donors"] });
        } catch {
          // Server may return 400 for missing name or 500 for duplicate — ignore.
        }
    }

    const location = currentLocation();

    try {
      await withIdempotencyKey(key, () => recordInbound({
        itemId,
        quantity,
        source: source.trim() || undefined,
        donor: (isDonationSource ? (donor.trim() || undefined) : undefined),
        donorClientId: isDonationSource ? donorPartnerId : undefined,
        location,
      }));
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error("Failed to record check-in:", err);
      }
      toast({
        title: "Check-in failed",
        description: saveErrorMessage(err, "The stock could not be recorded. Please try again."),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Stock received",
      description: `Recorded ${quantity} units received${location ? " with location" : ""}.`,
    });

    setQuantity(0);
    setScanState({ phase: "idle" });
    if (mode === "new") {
      setMode("existing");
      setSelectedId(itemId);
      setNewItem({
        name: "",
        category: "Uncategorized",
        barcode: "",
        brand: "",
        weightPerUnitLbs: 0,
        valuePerUnitUsd: 0,
        allergens: [],
      });
      setIsNewCategory(false);
      setCustomCategory("");
    }
    return true;
  }

  return (
    <Card className="glass-panel max-w-2xl" data-testid="card-check-in">
      <CardHeader>
        <CardTitle className="section-heading flex items-center gap-2">
          <Import className="h-4 w-4 text-[hsl(221_63%_30%)]" />
          Record received stock
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-6">
           <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            {scanState.phase === "scanning" && (
              <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <Input
              type="search"
              placeholder="Scan barcode to find or add..."
              className="pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  scanQueue.push(e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
              disabled={scanState.phase === "scanning"}
              autoFocus
              data-testid="input-checkin-barcode-scan"
            />
          </div>

          {/* Scan status feedback */}
          {scanState.phase === "scanning" && (
            <p className="text-[11px] text-muted-foreground mt-1 ml-1 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Looking up barcode across product databases...
            </p>
          )}
          {scanState.phase === "found-existing" && (
            <p className="text-[11px] text-emerald-600 mt-1 ml-1 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Already in inventory: {scanState.itemName}. Enter quantity below.
            </p>
          )}
          {scanState.phase === "found-created" && (
            <div className="mt-1 ml-1 space-y-1">
              <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Auto-added: {scanState.itemName} (via {scanState.source}). Enter quantity below.
              </p>
              {/* Enrichment summary */}
              <EnrichmentBadges product={scanState.product} />
            </div>
          )}
          {scanState.phase === "not-found" && (
            <p className="text-[11px] text-amber-600 mt-1 ml-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Not found in any database. Fill in details manually below.
            </p>
          )}
          {scanState.phase === "error" && (
            <p className="text-[11px] text-red-600 mt-1 ml-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Lookup failed. Fill in details manually.
            </p>
          )}
          {scanState.phase === "idle" && (
            <p className="text-[11px] text-muted-foreground mt-1 ml-1">
              USB Scanner: Focus this field and scan. Enter key triggers auto-lookup.
            </p>
          )}
        </div>

        {/* Enrichment details for selected existing item */}
        {mode === "existing" && selectedItem && (
          selectedItem.winningSource || selectedItem.brand ||
          (selectedItem.weightPerUnitLbs && selectedItem.weightPerUnitLbs > 0) ||
          (selectedItem.netWeightG && selectedItem.netWeightG > 0) ||
          (selectedItem.allergens && selectedItem.allergens.length > 0) ||
          (selectedItem.costCents && selectedItem.costCents > 0)
        ) && (
          <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-dashed">
            <ItemEnrichmentDetails item={selectedItem} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 border-t pt-4 border-dashed">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "existing" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("existing")}
              data-testid="button-mode-existing-item"
            >
              Existing item
            </Button>
            <Button
              type="button"
              variant={mode === "new" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("new")}
              data-testid="button-mode-new-item"
            >
              New item on the fly
            </Button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="select-item" data-testid="label-existing-item">
                Item
              </label>
              <Select
                value={shownSelectedId}
                onValueChange={(val) => setSelectedId((cur) => nextSelectedId(cur, val))}
              >
                <SelectTrigger id="select-item" data-testid="select-existing-item">
                  <SelectValue placeholder="Select an item" />
                </SelectTrigger>
                <SelectContent>
                  {itemChoices.map((item) => (
                    <SelectItem key={item.id} value={item.id} data-testid={`option-existing-item-${item.id}`}>
                      {item.brand ? `${item.brand} - ` : ""}{item.name} • {item.quantity} on hand
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-name" data-testid="label-new-item-name">
                    Item name
                  </label>
                  <Input
                    id="new-name"
                    value={newItem.name}
                    onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                    data-testid="input-new-item-name"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-brand" data-testid="label-new-item-brand">
                    Brand (optional)
                  </label>
                  <Input
                    id="new-brand"
                    value={newItem.brand}
                    onChange={(e) => setNewItem((p) => ({ ...p, brand: e.target.value }))}
                    data-testid="input-new-item-brand"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-category" data-testid="label-new-item-category">
                    Category
                  </label>
                  {!isNewCategory ? (
                    <Select
                      value={newItem.category}
                      onValueChange={(val) => {
                        if (val === "__new_category__") {
                          setIsNewCategory(true);
                          setCustomCategory("");
                        } else {
                          setNewItem((p) => ({ ...p, category: val }));
                        }
                      }}
                    >
                      <SelectTrigger id="new-category" data-testid="select-new-item-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                        <SelectItem value="__new_category__">+ Add New Category</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex gap-1">
                      <Input
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        onBlur={() => {
                          if (customCategory.trim()) {
                            setNewItem((p) => ({ ...p, category: customCategory.trim() }));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (customCategory.trim()) {
                              setNewItem((p) => ({ ...p, category: customCategory.trim() }));
                              setIsNewCategory(false);
                            }
                          }
                        }}
                        placeholder="Enter new category"
                        autoFocus
                        data-testid="input-new-item-category-custom"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Cancel new category"
                        onClick={() => {
                          if (customCategory.trim()) {
                            setNewItem((p) => ({ ...p, category: customCategory.trim() }));
                          }
                          setIsNewCategory(false);
                        }}
                      >
                        <XIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-barcode" data-testid="label-new-item-barcode">
                    Barcode / UPC (optional)
                  </label>
                  <Input
                    id="new-barcode"
                    value={newItem.barcode}
                    onChange={(e) => setNewItem((p) => ({ ...p, barcode: e.target.value }))}
                    data-testid="input-new-item-barcode"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-weight" data-testid="label-new-item-weight">
                    Weight per unit (lbs)
                  </label>
                  <Input
                    id="new-weight"
                    type="number"
                    min={0}
                    step="0.01"
                    value={newItem.weightPerUnitLbs}
                    onChange={(e) =>
                      setNewItem((p) => ({ ...p, weightPerUnitLbs: Number(e.target.value) || 0 }))
                    }
                    data-testid="input-new-item-weight"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="new-value" data-testid="label-new-item-value">
                    Value per unit ($)
                  </label>
                  <Input
                    id="new-value"
                    type="number"
                    min={0}
                    step="0.01"
                    value={newItem.valuePerUnitUsd}
                    onChange={(e) =>
                      setNewItem((p) => ({ ...p, valuePerUnitUsd: Number(e.target.value) || 0 }))
                    }
                    data-testid="input-new-item-value"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="quantity" data-testid="label-quantity-received">
                Quantity received
              </label>
              <Input
                id="quantity"
                ref={quantityInputRef}
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                data-testid="input-quantity-received"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="source" data-testid="label-source-donor">
                Source
              </label>
              <div className="flex gap-2">
                {!isNewSource ? (
                  <Select value={source} onValueChange={(val) => {
                    if (val === "new_source_custom") {
                        setIsNewSource(true);
                        setSource("");
                    } else {
                        setSource(val);
                        if (val !== "Donation" && val !== "Partner Donation") {
                          setDonor("");
                          setDonorPartnerId(undefined);
                          setIsNewDonor(false);
                        }
                    }
                  }}>
                    <SelectTrigger id="source">
                        <SelectValue placeholder="Select Source" />
                    </SelectTrigger>
                    <SelectContent>
                        {sourceOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        <SelectItem value="new_source_custom">+ Add New Source</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                    <div className="flex gap-1 w-full">
                        <Input
                            value={source}
                            onChange={(e) => setSource(e.target.value)}
                            placeholder="Enter new source"
                            autoFocus
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label="Cancel new source" onClick={() => setIsNewSource(false)}>
                            <span className="sr-only">Cancel</span>
                            <XIcon className="h-4 w-4" />
                        </Button>
                    </div>
                )}
              </div>
            </div>
          </div>

          {isDonationSource && (
              <div className="space-y-1.5 border-l-2 border-indigo-100 pl-4 mt-2">
                  <div className="relative">
                    <div className="absolute -left-[21px] top-[14px] w-4 h-px bg-indigo-200"></div>
                    <label className="text-sm font-medium" htmlFor="donor">
                        Donor / Partner
                    </label>
                  </div>
                  <div className="flex gap-2">
                    {!isNewDonor ? (
                        <Select value={donor} onValueChange={(val) => {
                            if (val === "new_donor_custom") {
                                setIsNewDonor(true);
                                setDonor("");
                                setDonorPartnerId(undefined);
                            } else {
                                const selected = donorOptions.find((d) => d.name === val);
                                setDonor(val);
                                setDonorPartnerId(selected?.fromPartner ? selected.id.replace(/^partner:/, "") : undefined);
                            }
                        }}>
                            <SelectTrigger id="donor">
                                <SelectValue placeholder="Select Donor" />
                            </SelectTrigger>
                            <SelectContent>
                                {donorOptions.map((d) => {
                                  const label = d.organization ? `${d.name} — ${d.organization}` : d.name;
                                  return (
                                    <SelectItem key={d.id} value={d.name}>
                                      {label}
                                      {d.fromPartner ? " · Partner org" : ""}
                                    </SelectItem>
                                  );
                                })}
                                <SelectItem value="new_donor_custom">+ Add New Donor</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="flex gap-1 w-full">
                            <Input
                                value={donor}
                                onChange={(e) => {
                                  setDonor(e.target.value);
                                  setDonorPartnerId(undefined);
                                }}
                                placeholder="Enter new donor"
                                autoFocus
                            />
                            <Button type="button" variant="ghost" size="icon" aria-label="Cancel new donor" onClick={() => setIsNewDonor(false)}>
                                <span className="sr-only">Cancel</span>
                                <XIcon className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                  </div>
              </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-muted-foreground" data-testid="text-check-in-help">
              This will increase on-hand quantity and log an IN transaction in Activity.
            </p>
            <Button type="submit" data-testid="button-save-check-in">
              Record check-in
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Enrichment Badges (shown after auto-create) ────────────────────────────

function EnrichmentBadges({ product }: { product: EnrichedProduct }) {
  const badges: { icon: React.ReactNode; label: string; detail: string; color: string }[] = [];

  // Confidence
  const conf = Math.round(product.matchConfidence * 100);
  badges.push({
    icon: <ShieldCheck className="h-3 w-3" />,
    label: `${conf}%`,
    detail: `Match confidence`,
    color: conf >= 80 ? "text-emerald-700 bg-emerald-50" : conf >= 60 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50",
  });

  // Package type
  if (product.packageType !== "single") {
    const typeLabel = product.packageType.replace(/_/g, " ");
    badges.push({
      icon: <Package className="h-3 w-3" />,
      label: `${typeLabel} (${product.unitCount})`,
      detail: `Package type`,
      color: "text-blue-700 bg-blue-50",
    });
  }

  // Weight
  if (product.netWeightG) {
    const wLabel = product.netWeightG >= 1000
      ? `${(product.netWeightG / 1000).toFixed(1)}kg`
      : `${Math.round(product.netWeightG)}g`;
    badges.push({
      icon: <Scale className="h-3 w-3" />,
      label: `${wLabel}${product.weightIsEstimated ? " ~est" : ""}`,
      detail: `Net weight`,
      color: product.weightIsEstimated ? "text-amber-700 bg-amber-50" : "text-slate-700 bg-slate-50",
    });
  }

  // Cost
  if (product.costCents) {
    badges.push({
      icon: <DollarSign className="h-3 w-3" />,
      label: `$${(product.costCents / 100).toFixed(2)}${product.costIsEstimated ? " ~est" : ""}`,
      detail: `Unit cost`,
      color: product.costIsEstimated ? "text-amber-700 bg-amber-50" : "text-slate-700 bg-slate-50",
    });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {badges.map((b, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${b.color}`}
          title={b.detail}
        >
          {b.icon}
          {b.label}
        </span>
      ))}
    </div>
  );
}

// ─── Item Enrichment Details (shown for selected existing item) ─────────────

function ItemEnrichmentDetails({ item }: { item: { brand?: string; packageType?: string; unitCount?: number; netWeightG?: number; unitWeightG?: number; weightIsEstimated?: boolean; weightPerUnitLbs?: number; costCents?: number; costIsEstimated?: boolean; valuePerUnitUsd?: number; winningSource?: string; matchConfidence?: number; currency?: string; allergens?: string[] } }) {
  const details: string[] = [];

  if (item.brand) details.push(`Brand: ${item.brand}`);

  if (item.packageType && item.packageType !== "single") {
    details.push(`Package: ${item.packageType.replace(/_/g, " ")} (${item.unitCount ?? 1} units)`);
  }

  if (item.netWeightG) {
    const w = item.netWeightG >= 1000
      ? `${(item.netWeightG / 1000).toFixed(1)}kg`
      : `${Math.round(item.netWeightG)}g`;
    details.push(`Weight: ${w}${item.weightIsEstimated ? " (estimated)" : ""}`);
    if (item.unitWeightG && item.unitCount && item.unitCount > 1) {
      const uw = item.unitWeightG >= 1000
        ? `${(item.unitWeightG / 1000).toFixed(1)}kg`
        : `${Math.round(item.unitWeightG)}g`;
      details.push(`Per unit: ${uw}`);
    }
  } else if (item.weightPerUnitLbs && item.weightPerUnitLbs > 0) {
    details.push(`Weight: ${item.weightPerUnitLbs.toFixed(2)} lbs/unit`);
  }

  if (item.costCents) {
    details.push(`Cost: $${(item.costCents / 100).toFixed(2)}${item.costIsEstimated ? " (estimated)" : ""}`);
  } else if (item.valuePerUnitUsd && item.valuePerUnitUsd > 0) {
    details.push(`Value: $${Number(item.valuePerUnitUsd).toFixed(2)}/unit`);
  }

  if (item.allergens && item.allergens.length > 0) {
    details.push(`Allergens: ${item.allergens.join(", ")}`);
  }

  if (item.winningSource) {
    const conf = item.matchConfidence ? ` (${Math.round(item.matchConfidence * 100)}% confidence)` : "";
    details.push(`Source: ${item.winningSource}${conf}`);
  }

  if (details.length === 0) return null;

  return (
    <div className="text-[11px] text-muted-foreground space-y-0.5">
      {details.map((d, i) => (
        <p key={i}>{d}</p>
      ))}
    </div>
  );
}
