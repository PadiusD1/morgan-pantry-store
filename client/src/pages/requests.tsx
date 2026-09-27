import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { StatusBadge } from "@/components/request/StatusBadge";
import type { ApiRequest, ApiRequestItem } from "@/lib/api-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { requestActionErrorText, requestActionErrorTitle, requestActionSuccessText } from "@/lib/request-action";
import {
  InboxIcon, CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronRightIcon,
  Loader2, ClockIcon, PackageIcon, UserXIcon, BanIcon, SearchIcon,
} from "lucide-react";

const STATUS_FILTERS = ["all", "pending", "under_review", "approved", "partially_approved", "ready_for_pickup", "denied", "completed", "expired", "no_show", "cancelled"] as const;

export default function RequestsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const initial = new URLSearchParams(window.location.search).get("status");
    return initial && STATUS_FILTERS.includes(initial as any) ? initial : "all";
  });
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<ApiRequest | null>(null);
  const [denyTarget, setDenyTarget] = useState<ApiRequest | null>(null);
  const [fulfillTarget, setFulfillTarget] = useState<ApiRequest | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const { data: requests = [], isLoading } = useQuery<ApiRequest[]>({
    queryKey: ["/api/requests", statusFilter],
    queryFn: async () => {
      if (statusFilter === "pending") {
        const pendingRes = await apiRequest("GET", "/api/requests?status=pending");
        const pending = await pendingRes.json();
        const reviewRes = await apiRequest("GET", "/api/requests?status=under_review");
        const review = await reviewRes.json();
        return [...pending, ...review];
      }
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await apiRequest("GET", `/api/requests${params}`);
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.toLowerCase();
    return requests.filter(
      (r) => r.clientName?.toLowerCase().includes(q) || r.clientIdentifier?.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q),
    );
  }, [requests, search]);

  const stats = useMemo(() => {
    const all = requests;
    return {
      pending: all.filter((r) => r.status === "pending" || r.status === "under_review").length,
      approved: all.filter((r) => ["approved", "partially_approved", "ready_for_pickup"].includes(r.status)).length,
      completed: all.filter((r) => r.status === "completed").length,
      denied: all.filter((r) => r.status === "denied").length,
    };
  }, [requests]);

  async function doAction(id: string, action: string, body?: any) {
    setActionLoading(true);
    try {
      const res = await apiRequest("POST", `/api/requests/${id}/${action}`, body);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Action failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Success", description: requestActionSuccessText(action) });
    } catch (e: any) {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: requestActionErrorTitle(e), description: requestActionErrorText(e), variant: "destructive" });
    } finally {
      setActionLoading(false);
      setApproveTarget(null);
      setDenyTarget(null);
      setDenyReason("");
      setApproveNote("");
    }
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className="space-y-4">
      {/* Student Portal Link */}
      <Card className="glass-panel border-blue-200 bg-blue-50/30">
        <CardContent className="py-3 px-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-medium">Student Request Portal</p>
            <p className="text-xs text-muted-foreground">
              Share this link with students: <code className="bg-muted px-1 rounded text-[11px] break-all">{window.location.origin}/portal</code>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href="/portal" target="_blank" rel="noopener">Open Portal</a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              navigator.clipboard.writeText(window.location.origin + "/portal");
              toast({ title: "Link copied", description: "Portal URL copied to clipboard." });
            }}>Copy Link</Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pending", value: stats.pending, icon: ClockIcon, color: "text-amber-600" },
          { label: "Approved / Ready", value: stats.approved, icon: CheckCircleIcon, color: "text-green-600" },
          { label: "Completed", value: stats.completed, icon: PackageIcon, color: "text-emerald-600" },
          { label: "Denied", value: stats.denied, icon: XCircleIcon, color: "text-red-600" },
        ].map((s) => (
          <Card key={s.label} className="glass-panel">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.color}`} />
              <div>
                <p className="text-2xl font-semibold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {STATUS_FILTERS.map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)} className="capitalize text-xs">
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </Button>
        ))}
        <div className="ml-auto relative">
          <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 w-56" />
        </div>
      </div>

      {/* Table */}
      <Card className="glass-panel">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <InboxIcon className="h-4 w-4" />
            Requests ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No requests found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <React.Fragment key={r.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                      <TableCell className="px-2">
                        {expandedId === r.id ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.clientName}</div>
                        <div className="text-xs text-muted-foreground">{r.clientIdentifier}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.items?.length ?? "?"} item(s)</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{r.reason}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</TableCell>
                      <TableCell><StatusBadge status={r.status as any} /></TableCell>
                      <TableCell className="text-right space-x-1">
                        {(r.status === "pending" || r.status === "under_review") && (
                          <>
                            <Button size="sm" variant="outline" className="text-xs h-7 max-md:min-h-[40px] max-md:px-3" onClick={(e) => { e.stopPropagation(); setApproveTarget(r); }}>Approve</Button>
                            <Button size="sm" variant="outline" className="text-xs h-7 text-red-600 max-md:min-h-[40px] max-md:px-3" onClick={(e) => { e.stopPropagation(); setDenyTarget(r); }}>Deny</Button>
                          </>
                        )}
                        {["approved", "partially_approved", "ready_for_pickup"].includes(r.status) && (
                          <>
                            <Button size="sm" variant="outline" className="text-xs h-7 text-green-700 max-md:min-h-[40px] max-md:px-3" onClick={(e) => { e.stopPropagation(); setFulfillTarget(r); }}>Fulfill</Button>
                            <Button size="sm" variant="ghost" className="text-xs h-7 max-md:min-h-[40px] max-md:px-3" onClick={(e) => { e.stopPropagation(); doAction(r.id, "no-show"); }}>No-Show</Button>
                            <Button size="sm" variant="ghost" className="text-xs h-7 text-slate-500 max-md:min-h-[40px] max-md:px-3" onClick={(e) => { e.stopPropagation(); doAction(r.id, "cancel"); }}>Cancel</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedId === r.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <ExpandedDetail request={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={!!approveTarget} onOpenChange={() => setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Request</DialogTitle>
            <DialogDescription>Approve {approveTarget?.clientName}'s request. Items will be reserved from inventory.</DialogDescription>
          </DialogHeader>
          {approveTarget?.items && (
            <div className="space-y-2 text-sm">
              {approveTarget.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <span>{item.itemName}</span>
                  <span className="text-muted-foreground">Qty: {item.requestedQuantity}</span>
                </div>
              ))}
            </div>
          )}
          <Input placeholder="Admin note (optional)" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button disabled={actionLoading} onClick={() => approveTarget && doAction(approveTarget.id, "approve", { adminNote: approveNote || undefined })}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deny Dialog */}
      <Dialog open={!!denyTarget} onOpenChange={() => setDenyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Request</DialogTitle>
            <DialogDescription>Deny {denyTarget?.clientName}'s request. A reason is required.</DialogDescription>
          </DialogHeader>
          <textarea
            className="w-full border rounded-md p-2 text-sm min-h-[80px] bg-background"
            placeholder="Reason for denial (required)"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={actionLoading || !denyReason.trim()} onClick={() => denyTarget && doAction(denyTarget.id, "deny", { adminNote: denyReason.trim() })}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Deny Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fulfill Dialog */}
      <Dialog open={!!fulfillTarget} onOpenChange={() => setFulfillTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Fulfillment</DialogTitle>
            <DialogDescription>
              Mark {fulfillTarget?.clientName}'s request as fulfilled. This will create an OUT transaction and update inventory.
            </DialogDescription>
          </DialogHeader>
          {fulfillTarget?.items && (
            <div className="space-y-1 text-sm border rounded p-3">
              {fulfillTarget.items.filter((i: ApiRequestItem) => (i.approvedQuantity ?? 0) > 0).map((item: ApiRequestItem) => (
                <div key={item.id} className="flex justify-between">
                  <span>{item.itemName}</span>
                  <span className="text-muted-foreground">Qty: {item.approvedQuantity}</span>
                </div>
              ))}
              {fulfillTarget.items.filter((i: ApiRequestItem) => (i.approvedQuantity ?? 0) > 0).length === 0 && (
                <p className="text-xs text-muted-foreground">No approved items found.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFulfillTarget(null)}>Cancel</Button>
            <Button disabled={actionLoading} onClick={async () => {
              if (fulfillTarget) {
                await doAction(fulfillTarget.id, "fulfill");
                setFulfillTarget(null);
                setStatusFilter("all");
              }
            }}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Confirm Fulfillment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpandedDetail({ request }: { request: ApiRequest }) {
  const { data: detail } = useQuery<ApiRequest>({
    queryKey: ["/api/requests", request.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/requests/${request.id}`);
      return res.json();
    },
  });

  const items = detail?.items ?? request.items ?? [];
  const auditLog = detail?.auditLog ?? [];

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Requester</h4>
          <p className="text-sm">{request.clientName} ({request.clientIdentifier})</p>
          {request.clientEmail && <p className="text-xs text-muted-foreground">{request.clientEmail}</p>}
          {request.clientPhone && <p className="text-xs text-muted-foreground">{request.clientPhone}</p>}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reason</h4>
          <p className="text-sm">{request.reason}</p>
        </div>
        {(() => {
          // Server returns snake_case from raw SQL; the typed API uses camelCase.
          const note = (request as any).studentNote ?? (request as any).student_note;
          if (!note) return null;
          return (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Student Note</h4>
              <p className="text-sm whitespace-pre-wrap">{note}</p>
            </div>
          );
        })()}
        {request.adminNote && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Admin Note</h4>
            <p className="text-sm">{request.adminNote}</p>
          </div>
        )}
        {request.pickupDeadline && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup Deadline</h4>
            <p className="text-sm">{new Date(request.pickupDeadline).toLocaleString()}</p>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Items</h4>
          <div className="space-y-1">
            {items.map((item: ApiRequestItem) => (
              <div key={item.id} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                <span>{item.itemName}</span>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>Req: {item.requestedQuantity}</span>
                  {item.approvedQuantity != null && <span className="text-green-700">App: {item.approvedQuantity}</span>}
                  {item.fulfilledQuantity != null && <span className="text-blue-700">Ful: {item.fulfilledQuantity}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {auditLog.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Audit Log</h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {auditLog.map((entry: any) => (
                <div key={entry.id} className="text-xs border-l-2 border-muted pl-2 py-0.5">
                  <span className="font-medium">{entry.action}</span>
                  {entry.newStatus && <span className="text-muted-foreground"> &rarr; {entry.newStatus}</span>}
                  <span className="text-muted-foreground ml-2">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
