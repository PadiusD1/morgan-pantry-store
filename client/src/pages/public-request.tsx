import React, { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { IdentificationStep } from "@/components/request/IdentificationStep";
import { ItemBrowser } from "@/components/request/ItemBrowser";
import { ReasonStep } from "@/components/request/ReasonStep";
import { SuccessStep } from "@/components/request/SuccessStep";
import { StatusBadge, type RequestStatus } from "@/components/request/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftIcon, SearchIcon, Loader2, PackageIcon } from "lucide-react";

type ClientData = { clientName: string; clientIdentifier: string; clientEmail?: string; clientPhone?: string; clientId?: string };
type CartEntry = { item: any; quantity: number };

export default function PublicRequestPage({ variant = "default" }: { variant?: "default" | "kiosk" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"welcome" | "identify" | "browse" | "reason" | "confirm" | "success" | "history">("welcome");
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [reason, setReason] = useState("");
  const [studentNote, setStudentNote] = useState("");
  const [requestId, setRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState("");
  const [historyData, setHistoryData] = useState<any[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isKiosk = variant === "kiosk";
  const textSize = isKiosk ? "text-lg" : "text-base";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setItemsLoading(true);
        setItemsError(null);
        const res = await fetch("/api/public/inventory");
        if (!res.ok) {
          throw new Error(`Failed to load inventory (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) {
          setItemsError(err instanceof Error ? err.message : "Could not load items");
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateCart = useCallback((itemId: string, item: any, quantity: number) => {
    setCart((prev) => {
      const next = new Map(prev);
      if (quantity <= 0) { next.delete(itemId); } else { next.set(itemId, { item, quantity }); }
      return next;
    });
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => { const next = new Map(prev); next.delete(itemId); return next; });
  }, []);

  async function handleSubmit() {
    if (!clientData || cart.size === 0 || !reason.trim()) return;
    setSubmitting(true);
    try {
      const body = {
        clientName: clientData.clientName,
        clientIdentifier: clientData.clientIdentifier,
        clientEmail: clientData.clientEmail || undefined,
        clientPhone: clientData.clientPhone || undefined,
        clientId: clientData.clientId || undefined,
        reason: reason.trim(),
        studentNote: studentNote.trim() || undefined,
        items: Array.from(cart.entries()).map(([id, entry]) => ({
          inventoryItemId: id,
          itemName: entry.item.name,
          itemCategory: entry.item.category,
          requestedQuantity: entry.quantity,
        })),
      };
      const res = await apiRequest("POST", "/api/requests", body);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Submit failed");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setRequestId(data.id);
      setStep("success");
    } catch (e: any) {
      toast({ title: "Error", description: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function lookupHistory() {
    if (!historyId.trim()) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/requests/lookup/${encodeURIComponent(historyId.trim())}`);
      if (!res.ok) {
        throw new Error(`Lookup failed (${res.status})`);
      }
      const data = await res.json();
      setHistoryData(Array.isArray(data) ? data : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load history.";
      toast({ title: "Error", description: message, variant: "destructive" });
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function reset() {
    setStep("welcome");
    setClientData(null);
    setCart(new Map());
    setReason("");
    setStudentNote("");
    setRequestId("");
    setHistoryData(null);
    setHistoryId("");
  }

  return (
    <div className={`min-h-screen bg-background ${isKiosk ? "text-xl" : ""}`}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <PackageIcon className="h-6 w-6" />
        <div>
          <h1 className="font-semibold text-lg">Morgan State FRC</h1>
          <p className="text-xs opacity-80">Food Resource Center - Item Request</p>
        </div>
      </div>

      <div className={`max-w-2xl mx-auto px-4 py-6 ${textSize}`}>
        {/* Welcome */}
        {step === "welcome" && (
          <div className="text-center space-y-6 py-12">
            <h2 className={`font-semibold ${isKiosk ? "text-3xl" : "text-2xl"}`}>Request Items from the FRC</h2>
            <p className="text-muted-foreground">Browse available items and submit a request. An administrator will review and approve your request.</p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <Button size="lg" className={isKiosk ? "h-14 text-lg" : ""} onClick={() => setStep("identify")}>Start a Request</Button>
              <Button size="lg" variant="outline" className={isKiosk ? "h-14 text-lg" : ""} onClick={() => setStep("history")}>Check My Requests</Button>
            </div>
          </div>
        )}

        {/* Identify */}
        {step === "identify" && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setStep("welcome")}><ArrowLeftIcon className="h-4 w-4 mr-1" /> Back</Button>
            <IdentificationStep
              variant={variant}
              onNext={(data) => { setClientData(data); setStep("browse"); }}
              onCheckHistory={() => setStep("history")}
            />
          </div>
        )}

        {/* Browse */}
        {step === "browse" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep("identify")}><ArrowLeftIcon className="h-4 w-4 mr-1" /> Back</Button>
              <div className="text-sm text-muted-foreground">{cart.size} item(s) selected</div>
            </div>
            {itemsLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading available items...</div>
            ) : itemsError ? (
              <div className="text-center py-12 space-y-3">
                <p className="text-sm text-destructive">{itemsError}</p>
                <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No items are currently available. Please check back later.</div>
            ) : (
              <ItemBrowser variant={variant} items={items} cart={cart} onUpdateCart={updateCart} />
            )}
            {cart.size > 0 && (
              <div className="sticky bottom-0 bg-background border-t pt-3 pb-2">
                <Button className="w-full" size="lg" onClick={() => setStep("reason")}>
                  Continue with {cart.size} item(s)
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Reason */}
        {step === "reason" && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setStep("browse")}><ArrowLeftIcon className="h-4 w-4 mr-1" /> Back</Button>
            <ReasonStep
              variant={variant}
              cart={cart}
              reason={reason}
              onReasonChange={setReason}
              studentNote={studentNote}
              onStudentNoteChange={setStudentNote}
              onSubmit={() => setStep("confirm")}
              onBack={() => setStep("browse")}
              submitting={false}
            />
          </div>
        )}

        {/* Confirm */}
        {step === "confirm" && clientData && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setStep("reason")}><ArrowLeftIcon className="h-4 w-4 mr-1" /> Back</Button>
            <Card className="glass-panel">
              <CardContent className="pt-4 space-y-4">
                <h3 className="font-semibold text-lg">Review Your Request</h3>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Your Info</p>
                  <p className="text-sm">{clientData.clientName} ({clientData.clientIdentifier})</p>
                  {clientData.clientEmail && <p className="text-xs text-muted-foreground">{clientData.clientEmail}</p>}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Items ({cart.size})</p>
                  {Array.from(cart.entries()).map(([id, entry]) => (
                    <div key={id} className="flex justify-between text-sm py-1 border-b border-border/50">
                      <span>{entry.item.name}</span>
                      <span className="text-muted-foreground">x{entry.quantity}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">Reason</p>
                  <p className="text-sm">{reason}</p>
                </div>
                {studentNote.trim() && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase">Your Note</p>
                    <p className="text-sm whitespace-pre-wrap">{studentNote}</p>
                  </div>
                )}
                <Button className="w-full" size="lg" disabled={submitting} onClick={handleSubmit}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirm and Submit
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <SuccessStep variant={variant} requestId={requestId} onNewRequest={reset} onCheckStatus={() => { setHistoryId(clientData?.clientIdentifier ?? ""); setStep("history"); }} />
        )}

        {/* History */}
        {step === "history" && (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setStep("welcome")}><ArrowLeftIcon className="h-4 w-4 mr-1" /> Back</Button>
            <h3 className="font-semibold text-lg">Check Request Status</h3>
            <div className="flex gap-2">
              <Input placeholder="Enter your Student ID" value={historyId} onChange={(e) => setHistoryId(e.target.value)} className={isKiosk ? "h-14 text-lg" : ""} />
              <Button onClick={lookupHistory} disabled={historyLoading || !historyId.trim()} className={isKiosk ? "h-14 px-6" : ""}>
                {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              </Button>
            </div>
            {historyData !== null && (
              historyData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No requests found for this ID.</p>
              ) : (
                <div className="space-y-3">
                  {historyData.map((r: any) => (
                    <Card key={r.id} className="glass-panel">
                      <CardContent className="py-3 px-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.createdAt ?? r.created_at).toLocaleString()}
                          </span>
                          <StatusBadge status={r.status as RequestStatus} />
                        </div>
                        <p className="text-sm">{r.reason}</p>
                        {r.items?.map((item: any) => (
                          <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                            <span>{item.itemName ?? item.item_name}</span>
                            <span>
                              Qty: {item.requestedQuantity ?? item.requested_quantity}
                              {(item.approvedQuantity ?? item.approved_quantity) != null
                                ? ` (Approved: ${item.approvedQuantity ?? item.approved_quantity})`
                                : ""}
                            </span>
                          </div>
                        ))}
                        {(r.adminNote ?? r.admin_note) && (
                          <p className="text-xs border-l-2 border-muted pl-2 text-muted-foreground">
                            Admin: {r.adminNote ?? r.admin_note}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
