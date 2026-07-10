import React from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useClientWithHistory, useRepository } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import { StatusBadge } from "@/components/request/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, Building2Icon, ClipboardListIcon, TruckIcon } from "lucide-react";

export default function PartnerDetailPage() {
  const [, params] = useRoute<{ id: string }>("/partners/:id");
  const { client: partner, visits } = useClientWithHistory(params?.id);
  const { transactions } = useRepository();

  const { data: requests = [] } = useQuery<any[]>({
    queryKey: ["/api/requests/lookup", partner?.identifier],
    queryFn: async () => {
      if (!partner?.identifier) return [];
      const res = await apiRequest("GET", `/api/requests/lookup/${encodeURIComponent(partner.identifier)}`);
      return res.json();
    },
    enabled: !!partner?.identifier,
  });

  if (!partner || partner.clientType !== "partner") {
    return (
      <Card className="glass-panel" data-testid="card-partner-not-found">
        <CardHeader>
          <CardTitle className="section-heading">Partner not found</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm" data-testid="button-back-to-partners">
            <Link href="/partners">Back to partners</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totalUnits = visits.reduce((sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity, 0), 0);
  const totalWeight = visits.reduce(
    (sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity * item.weightPerUnitLbs, 0),
    0,
  );
  const totalValue = visits.reduce(
    (sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity * item.valuePerUnitUsd, 0),
    0,
  );
  const contributions = transactions.filter(
    (tx) =>
      tx.type === "IN" &&
      (tx.clientId === partner.id || tx.donor?.trim().toLowerCase() === partner.name.trim().toLowerCase()),
  );
  const contributionUnits = contributions.reduce((sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity, 0), 0);
  const contributionWeight = contributions.reduce(
    (sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity * item.weightPerUnitLbs, 0),
    0,
  );
  const contributionValue = contributions.reduce(
    (sum, tx) => sum + tx.items.reduce((s, item) => s + item.quantity * item.valuePerUnitUsd, 0),
    0,
  );
  const lastContribution = contributions[0]?.timestamp ? new Date(contributions[0].timestamp).toLocaleDateString() : "Never";
  const lastDistribution = visits[0]?.timestamp ? new Date(visits[0].timestamp).toLocaleDateString() : "Never";

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="px-1.5 h-7 text-xs" data-testid="button-back-to-partners-top">
        <Link href="/partners">
          <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" /> Back to partners
        </Link>
      </Button>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="glass-panel" data-testid="card-partner-gives-us">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <TruckIcon className="h-4 w-4 rotate-180" />
              They Give Us
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-5">
            <div>
              <p className="text-2xl font-semibold">{contributions.length}</p>
              <p className="text-xs text-muted-foreground">Check-ins</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{contributionUnits}</p>
              <p className="text-xs text-muted-foreground">Units</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{contributionWeight.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Lbs</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">${contributionValue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Value</p>
            </div>
            <div>
              <p className="text-sm font-semibold">{lastContribution}</p>
              <p className="text-xs text-muted-foreground">Last gift</p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-partner-receives-from-us">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <TruckIcon className="h-4 w-4" />
              They Receive From Us
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-5">
            <div>
              <p className="text-2xl font-semibold">{visits.length}</p>
              <p className="text-xs text-muted-foreground">Check-outs</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{totalUnits}</p>
              <p className="text-xs text-muted-foreground">Units</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{totalWeight.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Lbs</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">${totalValue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Value</p>
            </div>
            <div>
              <p className="text-sm font-semibold">{lastDistribution}</p>
              <p className="text-xs text-muted-foreground">Last received</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-panel" data-testid="card-partner-summary">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Building2Icon className="h-4 w-4" />
              {partner.name}
            </span>
            <Badge variant={partner.status === "active" ? "default" : "secondary"} className="text-[10px] h-5 px-1.5">
              {partner.status ?? "active"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-2 text-sm">
          <div><strong>Identifier:</strong> {partner.identifier}</div>
          {partner.organization && <div><strong>Organization:</strong> {partner.organization}</div>}
          {partner.partnershipType && <div><strong>Partnership type:</strong> {partner.partnershipType}</div>}
          {partner.contact && <div><strong>Contact:</strong> {partner.contact}</div>}
          {partner.phone && <div><strong>Phone:</strong> {partner.phone}</div>}
          {partner.email && <div><strong>Email:</strong> {partner.email}</div>}
          {partner.address && <div><strong>Address:</strong> {partner.address}</div>}
          {partner.notes && (
            <div>
              <strong>Notes:</strong>
              <p className="text-muted-foreground mt-0.5 bg-muted/50 rounded p-2 text-xs">{partner.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-partner-contributions">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <TruckIcon className="h-4 w-4 rotate-180" />
            Contributions to FRC ({contributions.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Items Given</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contributions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No contributions from this partner recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {contributions.map((tx) => {
                const units = tx.items.reduce((sum, item) => sum + item.quantity, 0);
                const weight = tx.items.reduce((sum, item) => sum + item.quantity * item.weightPerUnitLbs, 0);
                const value = tx.items.reduce((sum, item) => sum + item.quantity * item.valuePerUnitUsd, 0);
                const first = tx.items[0];
                const extra = tx.items.length - 1;
                const date = new Date(tx.timestamp);
                return (
                  <TableRow key={tx.id} data-testid={`row-partner-contribution-${tx.id}`}>
                    <TableCell className="text-xs">
                      {date.toLocaleDateString()} {"\u00B7"} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{tx.source ?? "Partner Donation"}</TableCell>
                    <TableCell className="text-sm">
                      {first?.name ?? "No items"}
                      {extra > 0 && <span className="text-muted-foreground"> + {extra} more</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">{units}</TableCell>
                    <TableCell className="text-right text-sm">{weight > 0 ? `${weight.toFixed(1)} lbs` : "\u2014"}</TableCell>
                    <TableCell className="text-right text-sm">{value > 0 ? `$${value.toFixed(2)}` : "\u2014"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-partner-distributions">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <TruckIcon className="h-4 w-4" />
            Donated to Partner ({visits.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Items Received</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No donations to this partner recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {visits.map((tx) => {
                const units = tx.items.reduce((sum, item) => sum + item.quantity, 0);
                const weight = tx.items.reduce((sum, item) => sum + item.quantity * item.weightPerUnitLbs, 0);
                const value = tx.items.reduce((sum, item) => sum + item.quantity * item.valuePerUnitUsd, 0);
                const first = tx.items[0];
                const extra = tx.items.length - 1;
                const date = new Date(tx.timestamp);
                return (
                  <TableRow key={tx.id} data-testid={`row-partner-distribution-${tx.id}`}>
                    <TableCell className="text-xs">
                      {date.toLocaleDateString()} {"\u00B7"} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {first?.name ?? "No items"}
                      {extra > 0 && <span className="text-muted-foreground"> + {extra} more</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">{units}</TableCell>
                    <TableCell className="text-right text-sm">{weight > 0 ? `${weight.toFixed(1)} lbs` : "\u2014"}</TableCell>
                    <TableCell className="text-right text-sm">{value > 0 ? `$${value.toFixed(2)}` : "\u2014"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card className="glass-panel" data-testid="card-partner-requests">
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
                {requests.map((request: any) => {
                  const date = new Date(request.createdAt ?? request.created_at);
                  return (
                    <TableRow key={request.id}>
                      <TableCell className="text-xs">
                        {date.toLocaleDateString()} {"\u00B7"} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">{request.reason}</TableCell>
                      <TableCell className="text-xs">{request.items?.length ?? 0} item(s)</TableCell>
                      <TableCell><StatusBadge status={request.status} /></TableCell>
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
