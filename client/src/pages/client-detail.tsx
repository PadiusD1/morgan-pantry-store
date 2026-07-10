import React from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useClientWithHistory } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import { StatusBadge } from "@/components/request/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, CalendarIcon, PackageIcon, ClipboardListIcon, UserIcon, SirenIcon } from "lucide-react";

export default function ClientDetailPage() {
  const [, params] = useRoute<{ id: string }>("/clients/:id");
  const { client, visits } = useClientWithHistory(params?.id);

  // Fetch request history for this client
  const { data: requests = [] } = useQuery<any[]>({
    queryKey: ["/api/requests/lookup", client?.identifier],
    queryFn: async () => {
      if (!client?.identifier) return [];
      const res = await apiRequest("GET", `/api/requests/lookup/${encodeURIComponent(client.identifier)}`);
      return res.json();
    },
    enabled: !!client?.identifier,
  });

  if (!client) {
    return (
      <Card className="glass-panel" data-testid="card-client-not-found">
        <CardHeader>
          <CardTitle className="section-heading">Client not found</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm" data-testid="button-back-to-clients">
            <Link href="/clients">Back to clients</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totalItems = visits.reduce((sum, tx) => sum + tx.items.reduce((s: number, i: any) => s + i.quantity, 0), 0);
  const lastVisit = visits[0]?.timestamp ? new Date(visits[0].timestamp).toLocaleDateString() : "Never";
  const emergencyVisits = visits.filter((v) => v.isEmergency);
  const emergencyCount = emergencyVisits.length;
  const isFlagged = emergencyCount > 1;

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="px-1.5 h-7 text-xs" data-testid="button-back-to-clients-top">
        <Link href="/clients">
          <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" /> Back to clients
        </Link>
      </Button>

      {isFlagged && (
        <Card className="glass-panel border-red-300 bg-red-50/60" data-testid="card-client-flagged">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <SirenIcon className="h-5 w-5 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-700">
                Flagged student — {emergencyCount} Emergency Shop Appointments
              </p>
              <p className="text-xs text-muted-foreground">
                More than one emergency on record. Review their notes and consider connecting them with case-management support.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="glass-panel">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-semibold">{visits.length}</p>
            <p className="text-xs text-muted-foreground">Total Visits</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-semibold">{totalItems}</p>
            <p className="text-xs text-muted-foreground">Items Received</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="py-3 px-4">
            <p className="text-2xl font-semibold">{requests.length}</p>
            <p className="text-xs text-muted-foreground">Requests</p>
          </CardContent>
        </Card>
        <Card className={`glass-panel ${isFlagged ? "border-red-300" : ""}`} data-testid="card-client-emergency-count">
          <CardContent className="py-3 px-4">
            <p className={`text-2xl font-semibold ${isFlagged ? "text-red-700" : ""}`}>{emergencyCount}</p>
            <p className="text-xs text-muted-foreground">Emergency Shops</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="py-3 px-4">
            <p className="text-sm font-semibold">{lastVisit}</p>
            <p className="text-xs text-muted-foreground">Last Visit</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="py-3 px-4">
            <p className="text-sm font-semibold">{new Date(client.createdAt).toLocaleDateString()}</p>
            <p className="text-xs text-muted-foreground">Member Since</p>
          </CardContent>
        </Card>
      </div>

      {/* Client Profile */}
      <Card className="glass-panel" data-testid="card-client-summary">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <UserIcon className="h-4 w-4" />
            {client.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2 text-sm">
          <div><strong>ID:</strong> {client.identifier}</div>
          {client.phone && <div><strong>Phone:</strong> {client.phone}</div>}
          {client.email && <div><strong>Email:</strong> {client.email}</div>}
          {client.contact && <div><strong>Contact:</strong> {client.contact}</div>}
          {client.address && <div><strong>Address:</strong> {client.address}</div>}
          {client.householdSize && client.householdSize > 1 && <div><strong>Household:</strong> {client.householdSize} members</div>}
          {client.status && <div><strong>Status:</strong> <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-[10px] h-5 ml-1">{client.status}</Badge></div>}
          {client.allergies && client.allergies.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <strong>Allergies:</strong>
              {client.allergies.map((a: string) => (
                <Badge key={a} variant="destructive" className="text-[10px] h-5">{a}</Badge>
              ))}
            </div>
          )}
          {client.notes && (
            <div>
              <strong>Notes:</strong>
              <p className="text-muted-foreground mt-0.5 bg-muted/50 rounded p-2 text-xs">{client.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visit History */}
      <Card className="glass-panel" data-testid="card-client-visits">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <PackageIcon className="h-4 w-4" />
            Visit History ({visits.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground" data-testid="text-client-no-visits">
                    No distribution visits recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {visits.map((tx) => {
                const units = tx.items.reduce((sum: number, i: any) => sum + i.quantity, 0);
                const first = tx.items[0];
                const extra = tx.items.length - 1;
                const date = new Date(tx.timestamp);
                return (
                  <TableRow
                    key={tx.id}
                    data-testid={`row-client-visit-${tx.id}`}
                    className={tx.isEmergency ? "bg-red-50/40" : undefined}
                  >
                    <TableCell className="text-xs">
                      {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {tx.isEmergency && (
                        <Badge variant="destructive" className="ml-2 text-[10px] h-5">
                          <SirenIcon className="h-3 w-3 mr-1" />
                          Emergency
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {first?.name}
                      {extra > 0 && <span className="text-muted-foreground"> + {extra} more</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm" data-testid={`text-client-visit-units-${tx.id}`}>
                      {units}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Request History */}
      {requests.length > 0 && (
        <Card className="glass-panel">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <ClipboardListIcon className="h-4 w-4" />
              Request History ({requests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r: any) => {
                  const date = new Date(r.createdAt ?? r.created_at);
                  const itemCount = r.items?.length ?? 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">
                        {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{r.reason}</TableCell>
                      <TableCell className="text-xs">{itemCount} item(s)</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
