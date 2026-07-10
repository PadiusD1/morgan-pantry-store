import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeftIcon, DownloadIcon, HeartHandshakeIcon, PackageIcon, WeightIcon, DollarSignIcon, CalendarIcon, Loader2 } from "lucide-react";

interface Donor {
  id: string;
  name: string;
  organization?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  status: string;
  createdAt: string;
}

interface DonationHistoryItem {
  id: string;
  date: string;
  items: Array<{ name: string; quantity: number; weight?: number; value?: number }>;
  totalQuantity: number;
  totalWeight?: number;
  totalValue?: number;
}

interface DonorStats {
  totalDonations: number;
  totalItems: number;
  totalWeight: number;
  estimatedValue: number;
}

export default function DonorDetailPage() {
  const [, params] = useRoute<{ id: string }>("/donors/:id");
  const [, navigate] = useLocation();
  const donorId = params?.id;

  const { data: donor, isLoading: loadingDonor, isError: donorError, refetch: refetchDonor } = useQuery<Donor>({
    queryKey: ["/api/donors", donorId],
    enabled: !!donorId,
  });

  const { data: history = [], isLoading: loadingHistory, isError: historyError, refetch: refetchHistory } = useQuery<DonationHistoryItem[]>({
    queryKey: [`/api/donors/${donorId}/history`],
    enabled: !!donorId,
  });

  const stats: DonorStats = React.useMemo(() => {
    let totalDonations = 0;
    let totalItems = 0;
    let totalWeight = 0;
    let estimatedValue = 0;
    for (const entry of history) {
      totalDonations += 1;
      totalItems += entry.totalQuantity ?? entry.items.reduce((s, i) => s + i.quantity, 0);
      totalWeight += entry.totalWeight ?? entry.items.reduce((s, i) => s + (i.weight ?? 0), 0);
      estimatedValue += entry.totalValue ?? entry.items.reduce((s, i) => s + (i.value ?? 0), 0);
    }
    return { totalDonations, totalItems, totalWeight, estimatedValue };
  }, [history]);

  if (loadingDonor) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (donorError) {
    return (
      <Card className="glass-panel" data-testid="card-donor-error">
        <CardHeader>
          <CardTitle className="section-heading">Could not load donor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchDonor()}>Retry</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/donors")}>Back to donors</Button>
        </CardContent>
      </Card>
    );
  }

  if (!donor) {
    return (
      <Card className="glass-panel" data-testid="card-donor-not-found">
        <CardHeader>
          <CardTitle className="section-heading">Donor not found</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/donors")}
            data-testid="button-back-to-donors"
          >
            Back to donors
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="px-1.5 h-7 text-xs"
        onClick={() => navigate("/donors")}
        data-testid="button-back-to-donors-top"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" /> Back to donors
      </Button>

      {/* Summary Stats Bar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="glass-panel" data-testid="card-stat-total-donations">
          <CardContent className="flex items-center gap-3 py-4">
            <HeartHandshakeIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{stats.totalDonations}</div>
              <div className="text-xs text-muted-foreground">Total Donations</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-panel" data-testid="card-stat-total-items">
          <CardContent className="flex items-center gap-3 py-4">
            <PackageIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{stats.totalItems}</div>
              <div className="text-xs text-muted-foreground">Total Items Donated</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-panel" data-testid="card-stat-total-weight">
          <CardContent className="flex items-center gap-3 py-4">
            <WeightIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{stats.totalWeight.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Total Weight (lbs)</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-panel" data-testid="card-stat-estimated-value">
          <CardContent className="flex items-center gap-3 py-4">
            <DollarSignIcon className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">${stats.estimatedValue.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Estimated Value</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Donor Profile */}
      <Card className="glass-panel" data-testid="card-donor-profile">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span>{donor.name}</span>
            <Badge
              variant={donor.status === "active" ? "default" : "secondary"}
              className="text-[10px] h-5 px-1.5"
            >
              {donor.status ?? "active"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm pt-4">
          {donor.organization && (
            <div data-testid="text-donor-org-detail">
              <span className="text-muted-foreground">Organization:</span> {donor.organization}
            </div>
          )}
          {donor.contactName && (
            <div data-testid="text-donor-contact-detail">
              <span className="text-muted-foreground">Contact:</span> {donor.contactName}
            </div>
          )}
          {donor.phone && (
            <div data-testid="text-donor-phone-detail">
              <span className="text-muted-foreground">Phone:</span> {donor.phone}
            </div>
          )}
          {donor.email && (
            <div data-testid="text-donor-email-detail">
              <span className="text-muted-foreground">Email:</span> {donor.email}
            </div>
          )}
          {donor.address && (
            <div data-testid="text-donor-address-detail">
              <span className="text-muted-foreground">Address:</span> {donor.address}
            </div>
          )}
          {donor.notes && (
            <div data-testid="text-donor-notes-detail">
              <span className="text-muted-foreground">Notes:</span> {donor.notes}
            </div>
          )}
          <div className="text-xs text-muted-foreground pt-1" data-testid="text-donor-created-detail">
            <CalendarIcon className="inline h-3 w-3 mr-1" />
            Member since {new Date(donor.createdAt).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>

      {/* Donation Timeline */}
      <Card className="glass-panel" data-testid="card-donor-history">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center justify-between">
            <span>Donation History</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => window.open(`/api/donors/${donorId}/export`)}
              data-testid="button-export-donor"
            >
              <DownloadIcon className="h-3.5 w-3.5 mr-1" />
              Export
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : historyError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <p className="text-sm text-destructive">Could not load donation history.</p>
              <Button size="sm" variant="outline" onClick={() => refetchHistory()}>Retry</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Items Donated</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Weight (lbs)</TableHead>
                  <TableHead className="text-right">Value ($)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-sm text-muted-foreground"
                      data-testid="text-donor-no-donations"
                    >
                      No donations yet.
                    </TableCell>
                  </TableRow>
                )}
                {history.map((entry) => {
                  const date = new Date(entry.date);
                  const itemNames = entry.items.map((i) => i.name);
                  const first = itemNames[0];
                  const extra = itemNames.length - 1;
                  const qty = entry.totalQuantity ?? entry.items.reduce((s, i) => s + i.quantity, 0);
                  const weight = entry.totalWeight ?? entry.items.reduce((s, i) => s + (i.weight ?? 0), 0);
                  const value = entry.totalValue ?? entry.items.reduce((s, i) => s + (i.value ?? 0), 0);
                  return (
                    <TableRow key={entry.id} data-testid={`row-donation-${entry.id}`}>
                      <TableCell className="text-xs">
                        {date.toLocaleDateString()} {"\u00B7"} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {first}
                        {extra > 0 && (
                          <span className="text-muted-foreground"> + {extra} more</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-donation-qty-${entry.id}`}>
                        {qty}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-donation-weight-${entry.id}`}>
                        {weight > 0 ? weight.toFixed(1) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-donation-value-${entry.id}`}>
                        {value > 0 ? `$${value.toFixed(2)}` : "\u2014"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
