import React, { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepository, type InventoryItem } from "@/lib/repository";
import { currentLocation } from "@/lib/location";
import { lookupBarcode } from "@/lib/barcode-lookup";
import { createScanQueue, useScanner } from "@/lib/scanner";
import { refocusScanField } from "@/lib/scan-focus";
import { cartAllergyWarning } from "@/lib/cart-allergies";
import { toInventoryItem, type ApiInventoryItem } from "@/lib/api-types";
import { apiRequest, isEarlierSaveRecorded, withIdempotencyKey } from "@/lib/queryClient";
import { earlierSaveText, savedCheckOutName } from "@/lib/saved-result";
import { receiptFromFulfilled, receiptFromSaved } from "@/lib/receipt";
import { clientUpdateFailureText } from "@/lib/client-update";
import { checkOutFailure, fulfilFailure } from "@/lib/checkout-failure";
import { settleEarlierSave, type EarlierCheckOut } from "@/lib/checkout-earlier";
import { useSaveGuard } from "@/lib/save-guard";
import { addManualItem } from "@/lib/manual-item";
import { LINE_QUANTITY_LIMIT_MESSAGE, findOverLimitLine } from "@shared/line-quantity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { duplicateRefusal } from "@shared/identity";
import { CLASSIFICATIONS, buildCheckoutClient, inputsFromClient, resolveCheckoutIdentity, validateIdentityInputs } from "@shared/checkout-identity";
import { useReceiptCountdown } from "@/hooks/use-receipt-countdown";
import { ShoppingCartIcon, AlertTriangleIcon, Loader2, PlusCircle, XIcon, LayersIcon, PrinterIcon, PackageIcon, SirenIcon, ChevronsUpDownIcon, CheckIcon, Handshake } from "lucide-react";

type ItemGroupItem = {
  id: string;
  groupId: string;
  inventoryItemId: string;
  name: string;
  quantity?: number;
  defaultQuantity?: number;
};

type ItemGroup = {
  id: string;
  name: string;
  description: string | null;
  items: ItemGroupItem[];
  createdAt: string;
  updatedAt: string;
};

type ReceiptData = {
  clientName: string;
  clientIdentifier: string;
  items: { name: string; quantity: number }[];
  timestamp: string;
};

export default function CheckOutPage() {
  const { inventory, clients, transactions, recordOutbound, upsertBarcodeCache, addOrUpdateItem, categories } =
    useRepository();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [clientId, setClientId] = useState<string | "new" | "">("");
  const [clientName, setClientName] = useState("");
  const [clientIdentifier, setClientIdentifier] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientClassification, setClientClassification] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [clientAllergies, setClientAllergies] = useState<string[]>([]);
  const [isEmergency, setIsEmergency] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  // Count previous Emergency Shop Appointments for the currently-selected client.
  // Used to surface a "flagged student" badge when they've had more than one emergency.
  const selectedClientEmergencyCount = useMemo(() => {
    if (!clientId || clientId === "new") return 0;
    return transactions.filter(
      (t) => t.type === "OUT" && t.clientId === clientId && t.isEmergency,
    ).length;
  }, [transactions, clientId]);

  const [cart, setCart] = useState<{ itemId: string; quantity: number }[]>([]);
  const [barcode, setBarcode] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Manual item entry form (shown when barcode not found or user clicks "New item")
  const [newItemForm, setNewItemForm] = useState<{
    barcode: string;
    name: string;
    category: string;
    weightPerUnitLbs: number;
    valuePerUnitUsd: number;
  } | null>(null);

  // Item groups for quick-pick bundles
  const { data: itemGroups = [] } = useQuery<ItemGroup[]>({
    queryKey: ["/api/item-groups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/item-groups");
      return res.json();
    },
  });

  // Receipt state for post-checkout print
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const receiptWindow = useReceiptCountdown(receipt, () => setReceipt(null));

  // Track which approved request is being fulfilled through checkout
  const [fulfillingRequestId, setFulfillingRequestId] = useState<string | null>(null);
  // Map inventory item id -> the request's line-item id, so a fulfill call can
  // honor edited cart quantities per approved request item.
  const [requestItemIdByInventoryId, setRequestItemIdByInventoryId] = useState<Record<string, string>>({});

  // Allergy warning state
  const [allergyWarning, setAllergyWarning] = useState<{
    isOpen: boolean;
    itemName: string;
    itemAllergens: string[];
    clientAllergies: string[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const checkoutActive = useRef(true);
  const cancelAllergyDecision = useRef<(() => void) | null>(null);

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const sortedInventory = useMemo(
    () => [...inventory].sort((a, b) => a.name.localeCompare(b.name)),
    [inventory],
  );

  function setClientFromId(id: string) {
    setClientId(id);
    if (!id || id === "new") {
      setClientName("");
      setClientIdentifier("");
      setClientEmail("");
      setClientClassification("");
      setClientContact("");
      setClientAllergies([]);
      return;
    }
    const c = clients.find((c) => c.id === id);
    if (c) {
      setClientName(c.name);
      const split = inputsFromClient(c);
      setClientIdentifier(split.studentId);
      setClientEmail(split.email);
      setClientClassification(c.classification ?? "");
      setClientContact(c.contact || "");
      setClientAllergies(c.allergies || []);
    }
  }

  async function addToCart(itemId: string, quantity: number = 1, resolvedItem?: InventoryItem): Promise<boolean> {
    if (!itemId || !checkoutActive.current) return false;

    // Check allergies before adding
    if (clientId && clientId !== "new") {
      const currentInventory = queryClient.getQueryData<ApiInventoryItem[]>(["/api/inventory"])?.map(toInventoryItem) ?? inventory;
      const warning = cartAllergyWarning(itemId, currentInventory, clientAllergies, resolvedItem);
      if (warning) {
        // A scan is complete only after this decision. Otherwise a second
        // queued scan replaces the warning and silently loses the first item.
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (confirmed: boolean) => {
            if (settled) return;
            settled = true;
            cancelAllergyDecision.current = null;
            const added = confirmed && checkoutActive.current;
            if (added) performAddToCart(itemId, quantity);
            if (checkoutActive.current) {
              setAllergyWarning(null);
              setTimeout(() => refocusScanField(barcodeInputRef.current, document), 100);
            }
            resolve(added);
          };
          cancelAllergyDecision.current = () => finish(false);
          setAllergyWarning({
            isOpen: true,
            ...warning,
            clientAllergies,
            onConfirm: () => finish(true),
            onCancel: () => finish(false),
          });
        });
      }
    }

    performAddToCart(itemId, quantity);
    return true;
  }

  function addBundleToCart(group: ItemGroup) {
    let addedCount = 0;
    for (const groupItem of group.items) {
      const invItem = inventory.find((i) => i.id === groupItem.inventoryItemId);
      if (invItem) {
        performAddToCart(invItem.id, groupItem.defaultQuantity ?? groupItem.quantity ?? 1);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      toast({
        title: "Bundle added",
        description: `${group.name}: ${addedCount} item${addedCount === 1 ? "" : "s"} added to cart.`,
      });
    }
  }

  function performAddToCart(itemId: string, quantity: number) {
    setCart((prev) => {
      const existing = prev.find((c) => c.itemId === itemId);
      if (existing) {
        return prev.map((c) =>
          c.itemId === itemId ? { ...c, quantity: c.quantity + quantity } : c,
        );
      }
      return [...prev, { itemId, quantity }];
    });
  }

  async function handleBarcodeScanned(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;

    setScanLoading(true);

    try {
      const result = await lookupBarcode(trimmed);
      if (!checkoutActive.current) return;
      if (result.status === "exists" || result.status === "created") {
        queryClient.setQueryData<ApiInventoryItem[]>(["/api/inventory"], (old) => [
          ...(old ?? []).filter((row) => row.id !== result.item.id),
          result.item,
        ]);
      }

      if (result.status === "debounced") {
        setScanLoading(false);
        return;
      }

      if (result.status === "exists") {
        const item = toInventoryItem(result.item as ApiInventoryItem);
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        if (await addToCart(item.id, 1, item)) {
          toast({ title: "Item added", description: `${item.name} added to cart.` });
        }
        if (!checkoutActive.current) return;
        setScanLoading(false);
        setTimeout(() => refocusScanField(barcodeInputRef.current, document), 100);
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
        const added = await addToCart(item.id, 1, item);
        if (!checkoutActive.current) return;
        const srcLabel = result.product?.winningSource || "API";
        if (added) {
          toast({
            title: "New item added",
            description: `${item.name} found via ${srcLabel} and added to cart.`,
          });
        }
        setScanLoading(false);
        setTimeout(() => refocusScanField(barcodeInputRef.current, document), 100);
        return;
      }

      // Not found in any database — show manual entry form so staff can fill in details
      setNewItemForm({
        barcode: trimmed,
        name: "",
        category: "Uncategorized",
        weightPerUnitLbs: 0,
        valuePerUnitUsd: 0,
      });
      setScanLoading(false);
      toast({
        title: "Item not recognized",
        description: "Fill in the item details below to add it to the cart.",
      });
    } catch {
      if (!checkoutActive.current) return;
      toast({
        title: "Lookup failed",
        description: "Could not reach product databases. Try again or add item manually.",
        variant: "destructive",
      });
      setScanLoading(false);
    }
  }

  // Barcode fields and page-level scans feed one queue. Ordinary form editing
  // keeps its characters, Enter and Tab; a queued scan is never dropped.
  const lookupRef = useRef(handleBarcodeScanned);
  lookupRef.current = handleBarcodeScanned;
  const [scanQueue] = useState(() => createScanQueue((code) => lookupRef.current(code)));
  const tabEndsScan = useScanner(scanQueue.push);
  useEffect(() => {
    checkoutActive.current = true;
    return () => {
      checkoutActive.current = false;
      scanQueue.clearPending();
      cancelAllergyDecision.current?.();
    };
  }, [scanQueue]);

  // The Enter key and the Add button share one lock, and one key kept across
  // retries of the same item until it is saved.
  const addGuard = useSaveGuard();
  const { itemSaved } = useRepository();
  function handleAddNewItem() {
    void addGuard.run(addNewItem);
  }

  async function addNewItem(key: string): Promise<boolean | void> {
    if (!newItemForm) return;
    if (!newItemForm.name.trim()) {
      toast({
        title: "Item name required",
        description: "Enter a name for the item before adding to cart.",
      });
      return;
    }
    const form = newItemForm;
    const name = form.name.trim();
    const category = form.category || "Uncategorized";
    const barcode = form.barcode.trim();
    // The create is awaited, and the item goes into the cart only after the
    // server answered with its canonical id.
    const result = await addManualItem(key, {
      saveItem: (idempotencyKey) => {
        const created = addOrUpdateItem({
          name,
          category,
          barcode: barcode || undefined,
          quantity: 0,
          weightPerUnitLbs: form.weightPerUnitLbs,
          valuePerUnitUsd: form.valuePerUnitUsd,
        }, { idempotencyKey });
        return itemSaved(created.id);
      },
      addToCart: (itemId) => addToCart(itemId, 1),
    });
    if (!result.ok) {
      if (result.renew) addGuard.renew();
      if (result.closeForm) setNewItemForm(null);
      toast({ title: "Not added", description: result.text, variant: "destructive" });
      return false;
    }
    if (barcode) {
      upsertBarcodeCache(barcode, {
        name,
        category,
        weightPerUnitLbs: form.weightPerUnitLbs,
        allergens: [],
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    setNewItemForm(null);
    toast({
      title: "Item added to cart",
      description: `${name} saved and added to cart.`,
    });
    setTimeout(() => barcodeInputRef.current?.focus(), 100);
    return true;
  }

  // One save at a time, and a retry keeps the same Idempotency-Key.
  const saveGuard = useSaveGuard();
  // The location read when a logical save began, reused by its retries so an
  // unchanged retry sends an unchanged body.
  const actionLocation = useRef<{ key: string; location: ReturnType<typeof currentLocation> } | null>(null);
  function locationFor(key: string) {
    if (actionLocation.current?.key !== key) actionLocation.current = { key, location: currentLocation() };
    return actionLocation.current.location;
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await saveGuard.run(submitCheckOut);
  }

  async function submitCheckOut(key: string, startedAt: string): Promise<boolean | void> {
    if (!cart.length) {
      toast({
        title: "No items in cart",
        description: "Add at least one item before completing check-out.",
      });
      return;
    }
    if (findOverLimitLine(cart)) {
      toast({
        title: "Quantity too large",
        description: LINE_QUANTITY_LIMIT_MESSAGE,
        variant: "destructive",
      });
      return;
    }

    const clientNameFinal = clientName.trim();
    if (!clientNameFinal) {
      toast({
        title: "Missing client name",
        description: "Enter the client's name before recording this check-out.",
      });
      return;
    }
    const identityError = Object.values(validateIdentityInputs({
      studentId: clientIdentifier,
      email: clientEmail,
      classification: clientClassification,
    }))[0];
    if (identityError) {
      toast({ title: "Check the student details", description: identityError });
      return;
    }
    // A returning student is found by ID or email, so no second record is made,
    // and a conflicting ID and email is refused with the form and cart kept.
    const selectedClient = clientId && clientId !== "new" ? clients.find((c) => c.id === clientId) : undefined;
    const identity = resolveCheckoutIdentity(clients, {
      studentId: clientIdentifier,
      email: clientEmail,
      name: clientNameFinal,
      selected: selectedClient,
    });
    if (!identity.ok) {
      toast({ title: "Check the student details", description: identity.message, variant: "destructive" });
      return;
    }
    const clientPayload = buildCheckoutClient({
      existing: identity.existing,
      name: identity.name,
      studentId: clientIdentifier,
      email: clientEmail,
      classification: clientClassification,
      contact: clientContact,
      // Seeded by the save key, so a retry after a failed save sends the same identifier.
      random: () => key,
    });

    // No stock validation — checkout always proceeds.
    // If inventory is insufficient, it will be auto-adjusted.

    if (fulfillingRequestId) {
      try {
        // Honor any quantities the staff edited in the cart by mapping each cart
        // line back to its originating request item id.
        const fulfillItems = cart
          .map((c) => ({ id: requestItemIdByInventoryId[c.itemId], fulfilledQuantity: c.quantity }))
          .filter((it): it is { id: string; fulfilledQuantity: number } => Boolean(it.id));
        const res = await apiRequest(
          "POST",
          `/api/requests/${fulfillingRequestId}/fulfill`,
          fulfillItems.length > 0 ? { items: fulfillItems } : undefined,
        );
        // The receipt shows what the server saved, never the cart.
        const saved: unknown = await res.json().catch(() => null);
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
        setReceipt(receiptFromFulfilled(saved, new Date().toISOString()));
        toast({
          title: "Request fulfilled",
          description: `Request marked as completed for ${savedCheckOutName(saved, clientNameFinal)}.`,
        });
        setCart([]);
        setIsEmergency(false);
        setFulfillingRequestId(null);
        setRequestItemIdByInventoryId({});
        return true;
      } catch (e) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error("Failed to mark request as fulfilled:", e);
        }
        // A lost response or a 5xx may already have completed the request, so the lists are refreshed.
        queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        const failure = fulfilFailure(e);
        toast({ title: failure.title, description: failure.description, variant: "destructive" });
      }
      return;
    }

    const location = locationFor(key);

    let result: { client: typeof clients[number]; saved?: unknown };
    try {
      result = await withIdempotencyKey(key, () => recordOutbound({
        client: clientPayload,
        items: cart,
        location,
        isEmergency,
        timestamp: startedAt,
      }));
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error("Failed to record check-out:", e);
      }
      if (isEarlierSaveRecorded(e)) {
        // A held person create may hide a visit already recorded under this key,
        // so that visit is read back under the old key before the key is renewed.
        let earlier: EarlierCheckOut;
        try {
          earlier = await settleEarlierSave(e, key);
        } catch (settleError) {
          // The visit may already be recorded. The old key and the cart are kept.
          const failure = checkOutFailure(settleError, null);
          toast({ title: failure.title, description: failure.description, variant: "destructive" });
          return;
        }
        saveGuard.renew();
        // The receipt shows what the earlier try recorded, never the edited cart.
        const earlierReceipt = receiptFromSaved(earlier.recorded, clients, new Date().toISOString());
        if (earlierReceipt) setReceipt(earlierReceipt);
        if (earlier.kind === "visit") {
          // The cart shown was not saved. It is cleared so one more Save cannot record it again.
          setCart([]);
          queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
          queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
        }
        if (earlier.kind === "visit") {
          toast({ title: "Already recorded", description: earlierSaveText(earlier.recorded, "out") });
        } else {
          toast({ title: "Not saved", description: earlierSaveText(earlier.recorded, "out"), variant: "destructive" });
        }
        return;
      }
      // A lost response, a 5xx or a timeout may already be recorded. The cart and key are kept.
      const failure = checkOutFailure(e, duplicateRefusal(e) ?? clientUpdateFailureText(e));
      toast({
        title: failure.title,
        description: failure.description,
        variant: "destructive",
      });
      return;
    }

    if (result?.client) {
      // The receipt shows what the server saved, never the cart.
      setReceipt(receiptFromSaved(result.saved, [result.client, ...clients], new Date().toISOString()));

      toast({
        title: isEmergency ? "Emergency shop recorded" : "Check-out recorded",
        description: `Distribution recorded for ${savedCheckOutName(result.saved, result.client.name)}${isEmergency ? " (Emergency Shop Appointment)" : ""}${location ? " with location" : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setCart([]);
      setIsEmergency(false);
      // Finding J, a kept selection would take the next student's name and
      // email onto this person. The receipt shows who was served.
      setClientFromId("");
      return true;
    }
  }

  const totalUnits = cart.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <Card className="glass-panel" data-testid="card-check-out">
      <CardHeader>
        <CardTitle className="section-heading flex items-center gap-2">
          <ShoppingCartIcon className="h-4 w-4 text-[hsl(22_92%_60%)]" />
          Build distribution cart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <section className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)]">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-search-trigger" data-testid="label-client">
                  Client (type to search students + partners)
                </label>
                <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="client-search-trigger"
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={clientPickerOpen}
                      className="w-full justify-between font-normal"
                      data-testid="button-client-search"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {clientId === "new" ? (
                          <>+ New client</>
                        ) : clientId ? (
                          (() => {
                            const c = clients.find((x) => x.id === clientId);
                            if (!c) return "Select client or type a name...";
                            return (
                              <>
                                <span className="truncate">{c.name}</span>
                                <span className="text-muted-foreground text-xs truncate">· {c.identifier}</span>
                                {c.clientType === "partner" && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                    <Handshake className="h-2.5 w-2.5 mr-0.5" />
                                    Partner
                                  </Badge>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground">Select client or type a name...</span>
                        )}
                      </span>
                      <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
                    <Command
                      filter={(value, search) => {
                        // value is the option's `value` prop (we encode searchable text into it)
                        return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                      }}
                    >
                      <CommandInput placeholder="Search by name, ID, email, phone, org..." data-testid="input-client-search" />
                      <CommandList>
                        <CommandEmpty>
                          <div className="py-3 text-sm text-muted-foreground">
                            No match. Use <strong>+ New client</strong> below to add them.
                          </div>
                        </CommandEmpty>
                        <CommandGroup heading="Add">
                          <CommandItem
                            value="new client add"
                            onSelect={() => {
                              setClientFromId("new");
                              setClientPickerOpen(false);
                            }}
                            data-testid="option-client-new"
                          >
                            <PlusCircle className="mr-2 h-4 w-4" />
                            + New client
                          </CommandItem>
                        </CommandGroup>
                        {(() => {
                          const students = sortedClients.filter((c) => !c.clientType || c.clientType === "student");
                          const partners = sortedClients.filter((c) => c.clientType === "partner");
                          const renderRow = (c: typeof sortedClients[number]) => {
                            // Pack every searchable field into the value so cmdk's fuzzy filter can match on it
                            const haystack = [
                              c.name,
                              c.identifier,
                              c.email ?? "",
                              c.phone ?? "",
                              c.contact ?? "",
                              c.organization ?? "",
                              c.partnershipType ?? "",
                            ].join(" ");
                            return (
                              <CommandItem
                                key={c.id}
                                value={`${haystack} ${c.id}`}
                                onSelect={() => {
                                  setClientFromId(c.id);
                                  setClientPickerOpen(false);
                                }}
                                data-testid={`option-client-${c.id}`}
                              >
                                <CheckIcon
                                  className={`mr-2 h-4 w-4 ${clientId === c.id ? "opacity-100" : "opacity-0"}`}
                                />
                                <span className="truncate">{c.name}</span>
                                <span className="text-muted-foreground text-xs ml-2 truncate">· {c.identifier}</span>
                                {c.organization && (
                                  <span className="text-muted-foreground text-xs ml-1 truncate">· {c.organization}</span>
                                )}
                                {c.clientType === "partner" && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-2">
                                    Partner
                                  </Badge>
                                )}
                              </CommandItem>
                            );
                          };
                          return (
                            <>
                              {students.length > 0 && (
                                <CommandGroup heading="Students">
                                  {students.map(renderRow)}
                                </CommandGroup>
                              )}
                              {partners.length > 0 && (
                                <CommandGroup heading="Partner organizations">
                                  {partners.map(renderRow)}
                                </CommandGroup>
                              )}
                            </>
                          );
                        })()}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-name" data-testid="label-client-name">
                  Client name
                </label>
                <Input
                  id="client-name"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                  data-testid="input-client-name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-id" data-testid="label-client-identifier">
                  Student ID (optional)
                </label>
                <Input
                  id="client-id"
                  value={clientIdentifier}
                  onChange={(e) => setClientIdentifier(e.target.value)}
                  data-testid="input-client-identifier"
                />
                {validateIdentityInputs({ studentId: clientIdentifier }).studentId && (
                  <p className="text-xs text-destructive" data-testid="error-client-identifier">
                    {validateIdentityInputs({ studentId: clientIdentifier }).studentId}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-email" data-testid="label-client-email">
                  Email (optional)
                </label>
                <Input
                  id="client-email"
                  inputMode="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  data-testid="input-client-email"
                />
                {validateIdentityInputs({ email: clientEmail }).email && (
                  <p className="text-xs text-destructive" data-testid="error-client-email">
                    {validateIdentityInputs({ email: clientEmail }).email}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-classification" data-testid="label-client-classification">
                  Classification
                </label>
                <Select value={clientClassification} onValueChange={setClientClassification}>
                  <SelectTrigger id="client-classification" data-testid="select-client-classification">
                    <SelectValue placeholder="Select classification" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c} data-testid={`option-classification-${c}`}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="client-contact" data-testid="label-client-contact">
                  Contact (optional)
                </label>
                <Input
                  id="client-contact"
                  value={clientContact}
                  onChange={(e) => setClientContact(e.target.value)}
                  data-testid="input-client-contact"
                />
              </div>

              {/* Emergency Shop Appointment toggle. When checked, this check-out is tagged
                  separately in transaction history and counted in the Emergencies report. */}
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                  isEmergency ? "border-red-300 bg-red-50/60" : "border-dashed border-border/70"
                }`}
              >
                <Checkbox
                  id="checkout-emergency"
                  checked={isEmergency}
                  onCheckedChange={(v) => setIsEmergency(v === true)}
                  data-testid="checkbox-emergency-shop"
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-0.5">
                  <label
                    htmlFor="checkout-emergency"
                    className="text-sm font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <SirenIcon className={`h-3.5 w-3.5 ${isEmergency ? "text-red-600" : "text-muted-foreground"}`} />
                    Emergency Shop Appointment
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Tracks this visit separately in reports as an emergency distribution.
                  </p>
                  {selectedClientEmergencyCount > 0 && (
                    <div className="pt-1">
                      <Badge variant="destructive" className="text-[10px] h-5">
                        <SirenIcon className="h-3 w-3 mr-1" />
                        Flagged student · {selectedClientEmergencyCount} prior emergenc{selectedClientEmergencyCount === 1 ? "y" : "ies"}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Approved Requests — load into cart */}
              <ApprovedRequestsSection
                onLoad={(req: any) => {
                  // Auto-fill client
                  const existingClient = clients.find((c: any) => c.identifier === req.clientIdentifier || c.id === req.clientId);
                  if (existingClient) {
                    setClientFromId(existingClient.id);
                  } else {
                    setClientId("new");
                    setClientName(req.clientName || "");
                    setClientIdentifier(req.clientIdentifier || "");
                    setClientContact("");
                  }
                  // Auto-fill cart from approved items, and remember each cart line's
                  // originating request-item id so edited quantities can be sent on fulfill.
                  const newCart: { itemId: string; quantity: number }[] = [];
                  const reqItemMap: Record<string, string> = {};
                  for (const item of (req.items || [])) {
                    if (item.approvedQuantity > 0 || item.approved_quantity > 0) {
                      const invId = item.inventoryItemId || item.inventory_item_id;
                      newCart.push({ itemId: invId, quantity: item.approvedQuantity || item.approved_quantity });
                      if (invId && item.id) reqItemMap[invId] = item.id;
                    }
                  }
                  setCart(newCart);
                  setRequestItemIdByInventoryId(reqItemMap);
                  setFulfillingRequestId(req.id);
                  toast({ title: "Request loaded", description: `${req.clientName || req.client_name}'s approved items loaded into cart. Will be marked fulfilled after checkout.` });
                }}
              />

              {/* Quick-Pick Bundles */}
              {itemGroups.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <LayersIcon className="h-3.5 w-3.5 text-[hsl(22_92%_60%)]" />
                    Quick-Pick Bundles
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {itemGroups.map((group) => (
                      <Button
                        key={group.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto py-1.5 px-2.5 text-xs flex flex-col items-start gap-0.5"
                        onClick={() => addBundleToCart(group)}
                        data-testid={`button-bundle-${group.id}`}
                      >
                        <span className="font-medium">{group.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {group.items.length} item{group.items.length === 1 ? "" : "s"}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="item-select" data-testid="label-add-item">
                  Add item to cart
                </label>
                <div className="flex flex-wrap gap-2">
                  <Select onValueChange={(id) => addToCart(id)}>
                    <SelectTrigger id="item-select" className="min-w-0 flex-1" data-testid="select-cart-item">
                      <SelectValue placeholder="Choose item" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedInventory.map((i) => (
                        <SelectItem key={i.id} value={i.id} data-testid={`option-cart-item-${i.id}`}>
                          {i.brand ? `${i.brand} - ` : ""}{i.name} • {i.quantity} on hand
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2 relative w-full sm:w-auto">
                    <Input
                      ref={barcodeInputRef}
                      type="text"
                      placeholder="Scan barcode"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || (e.key === "Tab" && tabEndsScan(e.currentTarget.value))) {
                          e.preventDefault();
                          const code = e.key === "Enter" ? barcode : e.currentTarget.value;
                          if (code.trim()) {
                            scanQueue.push(code);
                            setBarcode("");
                          }
                        }
                      }}
                      className="w-full sm:w-40 min-w-0"
                      aria-busy={scanLoading}
                      autoFocus
                      data-barcode-input="true"
                      data-testid="input-barcode"
                    />
                    {scanLoading && (
                      <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {scanLoading
                    ? "Looking up barcode..."
                    : "USB Scanner: Focus scan field and Enter. Auto-lookup enabled."}
                </p>
              </div>

              {/* Manual new item button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full flex items-center gap-1.5 text-xs"
                onClick={() => setNewItemForm({ barcode: "", name: "", category: "Uncategorized", weightPerUnitLbs: 0, valuePerUnitUsd: 0 })}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                New item not in system
              </Button>

              {/* Manual item entry form */}
              {newItemForm && (
                <div className="border border-dashed rounded-lg p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Enter item details</p>
                    <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setNewItemForm(null)}>
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="grid gap-2 grid-cols-2">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs font-medium">Item name *</label>
                      <Input
                        value={newItemForm.name}
                        onChange={(e) => setNewItemForm(p => p ? { ...p, name: e.target.value } : p)}
                        placeholder="e.g. Canned Soup, Rice (5 lb bag)"
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddNewItem(); } }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Category</label>
                      <Select
                        value={newItemForm.category}
                        onValueChange={(val) => setNewItemForm(p => p ? { ...p, category: val } : p)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Barcode (optional)</label>
                      <Input
                        value={newItemForm.barcode}
                        onChange={(e) => setNewItemForm(p => p ? { ...p, barcode: e.target.value } : p)}
                        placeholder="UPC / barcode"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Weight/unit (lbs)</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={newItemForm.weightPerUnitLbs}
                        onChange={(e) => setNewItemForm(p => p ? { ...p, weightPerUnitLbs: Number(e.target.value) || 0 } : p)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Value/unit ($)</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={newItemForm.valuePerUnitUsd}
                        onChange={(e) => setNewItemForm(p => p ? { ...p, valuePerUnitUsd: Number(e.target.value) || 0 } : p)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <Button type="button" size="sm" className="w-full" onClick={handleAddNewItem}>
                    Save item &amp; add to cart
                  </Button>
                </div>
              )}

              <CartTable cart={cart} setCart={setCart} />
            </div>
          </section>

          {fulfillingRequestId && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5 flex items-center gap-1.5">
              <PackageIcon className="h-3.5 w-3.5" />
              Fulfilling approved request. Status will update to Completed after checkout.
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-muted-foreground" data-testid="text-check-out-help">
              This will reduce inventory and log an OUT transaction linked to this client.
            </p>
            <Button type="submit" disabled={!cart.length} data-testid="button-save-check-out">
              Complete check-out ({totalUnits} units)
            </Button>
          </div>
        </form>

        <Dialog open={!!allergyWarning} onOpenChange={(open) => { if (!open) allergyWarning?.onCancel(); }}>
          <DialogContent className="border-red-500 border-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangleIcon className="h-5 w-5" />
                Allergy Warning
              </DialogTitle>
              <DialogDescription>
                This item matches allergies listed for <strong>{clientName}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
               <div className="space-y-2">
                 <p className="text-sm">Item: <strong>{allergyWarning?.itemName}</strong></p>
                 <div className="text-sm">Matched Allergens:
                    <div className="flex flex-wrap gap-1 mt-1">
                        {allergyWarning?.itemAllergens.map(a => (
                            <span key={a} className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-semibold">{a}</span>
                        ))}
                    </div>
                 </div>
               </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => allergyWarning?.onCancel()}>Cancel</Button>
              <Button variant="destructive" onClick={() => allergyWarning?.onConfirm()}>
                Confirm & Add Anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Receipt Dialog */}
        <Dialog open={!!receipt} onOpenChange={(open) => { if (!open) setReceipt(null); }}>
          <DialogContent
            className="max-w-md max-h-[85vh] overflow-y-auto"
            onPointerDownCapture={receiptWindow.cancel}
            onPointerEnter={receiptWindow.cancel}
            onPointerMove={receiptWindow.cancel}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PrinterIcon className="h-5 w-5" />
                Distribution Receipt
              </DialogTitle>
              <DialogDescription>
                Review and print the receipt for this distribution.
              </DialogDescription>
            </DialogHeader>
            {receiptWindow.secondsLeft !== null && (
              <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="text-receipt-countdown">
                Closes in {receiptWindow.secondsLeft} {receiptWindow.secondsLeft === 1 ? "second" : "seconds"}. Tap or hover to keep it open.
              </p>
            )}
            {receipt && <ReceiptContent receipt={receipt} />}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setReceipt(null)}>Close</Button>
              <Button
                onClick={() => {
                  const printArea = document.getElementById("receipt-print-area");
                  if (!printArea) return;
                  const printWindow = window.open("", "_blank", "width=400,height=600");
                  if (!printWindow) return;
                  printWindow.document.write(`
                    <!DOCTYPE html>
                    <html><head><title>Receipt</title>
                    <style>
                      body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; max-width: 380px; margin: 0 auto; color: #111; }
                      h2 { text-align: center; margin: 0 0 2px; font-size: 16px; }
                      .org-info { text-align: center; font-size: 11px; color: #555; margin-bottom: 12px; line-height: 1.5; }
                      .divider { border-top: 1px dashed #999; margin: 10px 0; }
                      .field { font-size: 12px; margin: 4px 0; }
                      .field strong { display: inline-block; width: 60px; }
                      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
                      th { text-align: left; font-size: 11px; border-bottom: 1px solid #333; padding: 4px 0; }
                      th:last-child { text-align: right; }
                      td { font-size: 12px; padding: 3px 0; }
                      td:last-child { text-align: right; }
                      .footer { text-align: center; font-size: 10px; color: #777; margin-top: 16px; }
                    </style>
                    </head><body>
                    ${printArea.innerHTML}
                    </body></html>
                  `);
                  printWindow.document.close();
                  printWindow.focus();
                  printWindow.print();
                  printWindow.close();
                }}
                data-testid="button-print-receipt"
              >
                <PrinterIcon className="h-4 w-4 mr-1.5" />
                Print Receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {!receipt && receiptWindow.lastReceipt && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              receiptWindow.markReprint();
              setReceipt(receiptWindow.lastReceipt);
            }}
            data-testid="button-reprint-last-receipt"
          >
            <PrinterIcon className="h-4 w-4 mr-1.5" />
            Reprint last receipt
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CartTable({
  cart,
  setCart,
}: {
  cart: { itemId: string; quantity: number }[];
  setCart: React.Dispatch<React.SetStateAction<{ itemId: string; quantity: number }[]>>;
}) {
  const { inventory } = useRepository();

  function updateQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((c) => c.itemId !== itemId));
    } else {
      setCart((prev) => prev.map((c) => (c.itemId === itemId ? { ...c, quantity } : c)));
    }
  }

  return (
    <Card className="border-dashed" data-testid="card-check-out-cart">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
          <span>Cart</span>
          <span className="pill-muted" data-testid="text-cart-lines">
            {cart.length} line{cart.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cart.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-4 text-center text-xs text-muted-foreground"
                  data-testid="text-cart-empty"
                >
                  No items in cart yet.
                </TableCell>
              </TableRow>
            )}
            {cart.map((line) => {
              const item = inventory.find((i) => i.id === line.itemId);
              if (!item) return null;
              return (
                <TableRow key={line.itemId} data-testid={`row-cart-${line.itemId}`}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium" data-testid={`text-cart-item-name-${line.itemId}`}>
                        {item.brand ? `${item.brand} - ` : ""}{item.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground" data-testid={`text-cart-item-category-${line.itemId}`}>
                        {item.category || "Uncategorized"}
                        {item.packageType && item.packageType !== "single" && (
                          <> • {item.packageType.replace(/_/g, " ")} ({item.unitCount})</>
                        )}
                        {item.netWeightG ? (
                          <> • {item.netWeightG >= 1000 ? `${(item.netWeightG / 1000).toFixed(1)}kg` : `${Math.round(item.netWeightG)}g`}{item.weightIsEstimated ? " ~est" : ""}</>
                        ) : item.weightPerUnitLbs > 0 ? (
                          <> • {item.weightPerUnitLbs.toFixed(2)} lbs/unit</>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs" data-testid={`text-cart-item-available-${line.itemId}`}>
                    {item.quantity}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateQuantity(line.itemId, Number(e.target.value) || 0)}
                      className="h-7 w-20 ml-auto text-right"
                      data-testid={`input-cart-quantity-${line.itemId}`}
                    />
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => updateQuantity(line.itemId, 0)}
                      data-testid={`button-remove-cart-item-${line.itemId}`}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReceiptContent({ receipt }: { receipt: ReceiptData }) {
  const { data: orgSettings = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings");
      return res.json();
    },
  });

  const orgName = orgSettings.orgName || "Morgan State University Food Resource Center";
  const orgAddress = orgSettings.orgAddress || "";
  const orgPhone = orgSettings.orgPhone || "";
  const orgEmail = orgSettings.orgEmail || "";

  const date = new Date(receipt.timestamp);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const totalItems = receipt.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div id="receipt-print-area" className="space-y-3 py-2">
      <div className="text-center space-y-0.5">
        <h2 className="text-base font-bold">{orgName}</h2>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {orgAddress && <p>{orgAddress}</p>}
          {(orgPhone || orgEmail) && (
            <p>{[orgPhone, orgEmail].filter(Boolean).join(" | ")}</p>
          )}
        </div>
      </div>

      <div className="border-t border-dashed" />

      <div className="space-y-1 text-sm">
        <div><strong>Client:</strong> {receipt.clientName}</div>
        <div><strong>ID:</strong> {receipt.clientIdentifier}</div>
        <div><strong>Date:</strong> {formattedDate}</div>
        <div><strong>Time:</strong> {formattedTime}</div>
      </div>

      <div className="border-t border-dashed" />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1 font-medium text-xs">Item</th>
            <th className="text-right py-1 font-medium text-xs">Qty</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item, idx) => (
            <tr key={idx} className="border-b border-dashed last:border-0">
              <td className="py-1">{item.name}</td>
              <td className="text-right py-1">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed" />

      <div className="flex justify-between text-sm font-medium">
        <span>Total items</span>
        <span>{totalItems}</span>
      </div>

      <div className="text-center text-[10px] text-muted-foreground pt-2">
        <p>Thank you for visiting {orgName}.</p>
        <p>This receipt is for record-keeping purposes only. No pricing applies.</p>
      </div>
    </div>
  );
}

function ApprovedRequestsSection({ onLoad }: { onLoad: (req: any) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: approvedRequests = [] } = useQuery<any[]>({
    queryKey: ["/api/requests", "approved-for-checkout"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/requests?status=approved");
      const approved = await res.json();
      const res2 = await apiRequest("GET", "/api/requests?status=partially_approved");
      const partial = await res2.json();
      const res3 = await apiRequest("GET", "/api/requests?status=ready_for_pickup");
      const ready = await res3.json();
      return [...approved, ...partial, ...ready];
    },
  });

  if (approvedRequests.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="text-sm font-medium flex items-center gap-1.5 text-green-700 hover:underline"
        onClick={() => setExpanded(!expanded)}
      >
        <PackageIcon className="h-3.5 w-3.5" />
        Approved Requests ({approvedRequests.length})
        <span className="text-xs text-muted-foreground ml-1">{expanded ? "hide" : "show"}</span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {approvedRequests.map((req: any) => (
            <div key={req.id} className="flex items-center justify-between border rounded px-3 py-2 text-xs bg-green-50/50">
              <div>
                <span className="font-medium">{req.clientName || req.client_name}</span>
                <span className="text-muted-foreground ml-2">
                  {(req.items?.length ?? 0)} item(s)
                </span>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-green-700 hover:underline"
                onClick={() => onLoad(req)}
              >
                Load into Cart
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
