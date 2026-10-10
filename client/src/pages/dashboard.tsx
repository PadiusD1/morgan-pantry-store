import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRepository, useInventorySummary, isLowStock } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRightIcon, ArrowUpRightIcon, ArrowRightIcon } from "lucide-react";
import { donutSlices } from "@/lib/donut";
import { WeeklyMovementChart, CategoryInventoryChart } from "@/components/operating-charts";
import { sourceNameOf } from "@shared/donation-source";
import { REPORT_TIME_ZONE, reportDateKey } from "@shared/reporting";

export default function DashboardPage() {
  const { inventory, transactions, clients } = useRepository();
  const summary = useInventorySummary();
  const lowStockItems = useMemo(() => inventory.filter(isLowStock).slice(0, 5), [inventory]);
  const recentTx = transactions.slice(0, 8);
  const today = reportDateKey(new Date())!;
  const todaysVisits = transactions.filter(t => t.type === "OUT" && reportDateKey(t.timestamp) === today);
  const categoryData = useMemo(() => donutSlices(inventory), [inventory]);
  const weeklyActivity = useMemo(() => {
    const totals = new Map<string, { inbound: number; outbound: number }>();
    for (const tx of transactions) {
      const date = reportDateKey(tx.timestamp);
      if (!date) continue;
      const total = totals.get(date) ?? { inbound: 0, outbound: 0 };
      const units = tx.items.reduce((sum, item) => sum + item.quantity, 0);
      if (tx.type === "IN") total.inbound += units;
      else total.outbound += units;
      totals.set(date, total);
    }
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (6 - index));
      const values = totals.get(reportDateKey(date)!) ?? { inbound: 0, outbound: 0 };
      return { day: date.toLocaleDateString(undefined, { weekday: "short", timeZone: REPORT_TIME_ZONE }), ...values };
    });
  }, [transactions, today]);
  const metrics = [
    { id: "card-inventory-summary", valueId: "text-distinct-items", label: "Inventory items", value: summary.distinctItems.toLocaleString(), note: `${summary.totalUnits.toLocaleString()} total units on hand` },
    { id: "card-total-weight", valueId: "text-total-weight", label: "Weight in stock", value: `${summary.totalWeightLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs`, note: "Approximate total based on item weights" },
    { id: "card-today-visits", valueId: "text-today-visits-count", label: "Today's visits", value: todaysVisits.length.toLocaleString(), note: "Distribution check-outs recorded today" },
    { id: "card-total-clients", valueId: "text-total-clients", label: "Registered clients", value: clients.length.toLocaleString(), note: "Saved client records, including partners" },
  ];
  return <div className="space-y-5">
    <section className="sbd-operating-metrics" aria-label="Pantry at a glance">{metrics.map(metric => <div className="sbd-operating-metric" key={metric.id} data-testid={metric.id}>
      <h2>{metric.label}</h2><p className="sbd-operating-number" data-testid={metric.valueId}>{metric.value}</p><p>{metric.note}</p>
    </div>)}</section>
    <RequestMetrics />
    <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)]">
      <Card className="glass-panel" data-testid="card-recent-activity">
        <CardHeader className="flex flex-row items-center justify-between py-4 px-4 border-b border-border"><CardTitle className="section-heading">Recent activity</CardTitle><Badge variant="outline" className="text-[11px]" data-testid="badge-recent-activity-count">{recentTx.length} most recent moves</Badge></CardHeader>
        <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Summary</TableHead><TableHead className="text-right">Units</TableHead></TableRow></TableHeader><TableBody>
          {recentTx.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground" data-testid="text-no-activity">No activity recorded yet. Use Check-In or Check-Out to start logging moves.</TableCell></TableRow>}
          {recentTx.map(tx => {
            const units = tx.items.reduce((sum, item) => sum + item.quantity, 0);
            const extra = tx.items.length - 1;
            const date = new Date(tx.timestamp);
            return <TableRow key={tx.id} data-testid={`row-activity-${tx.id}`}>
              <TableCell className="whitespace-nowrap text-xs">{date.toLocaleDateString(undefined, { timeZone: REPORT_TIME_ZONE })} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: REPORT_TIME_ZONE })}</TableCell>
              <TableCell><span className={`${tx.type === "IN" ? "badge-blue" : "badge-orange"} inline-flex items-center gap-1`} data-testid={`badge-activity-type-${tx.id}`}>{tx.type === "IN" ? <ArrowUpRightIcon className="h-3 w-3" /> : <ArrowDownRightIcon className="h-3 w-3" />}{tx.type}</span></TableCell>
              <TableCell className="text-sm"><div className="truncate-2" data-testid={`text-activity-summary-${tx.id}`}>{tx.type === "OUT" && tx.clientName && <span className="font-medium mr-1">{tx.clientName}</span>}{sourceNameOf(tx) && <span className="font-medium mr-1">{sourceNameOf(tx)}</span>}{tx.items[0]?.name}{extra > 0 && <span className="text-muted-foreground"> + {extra} more</span>}</div></TableCell>
              <TableCell className="text-right text-sm" data-testid={`text-activity-units-${tx.id}`}>{units}</TableCell>
            </TableRow>;
          })}
        </TableBody></Table></CardContent>
      </Card>
      <Card className="glass-panel" data-testid="card-low-stock">
        <CardHeader className="flex flex-row items-center justify-between py-4 px-4 border-b border-border"><CardTitle className="section-heading">Low stock alerts</CardTitle><Badge variant="outline" className="text-[11px]" data-testid="badge-low-stock-count">{lowStockItems.length} shown</Badge></CardHeader>
        <CardContent className="p-0">{lowStockItems.length === 0 ? <div className="py-6 px-4 text-sm text-muted-foreground" data-testid="text-no-low-stock">No items are currently below their reorder threshold.</div> : <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-right">On hand</TableHead></TableRow></TableHeader><TableBody>{lowStockItems.map(item => <TableRow key={item.id} className="low-stock-row" data-testid={`row-low-stock-${item.id}`}>
          <TableCell><span className="text-sm font-medium" data-testid={`text-low-stock-name-${item.id}`}>{item.name}</span></TableCell><TableCell className="text-xs text-muted-foreground" data-testid={`text-low-stock-category-${item.id}`}>{item.category || "Uncategorized"}</TableCell><TableCell className="text-right text-sm font-semibold" data-testid={`text-low-stock-quantity-${item.id}`}>{item.quantity}</TableCell>
        </TableRow>)}</TableBody></Table>}</CardContent>
        <div className="px-4 py-3 border-t border-border"><Link href="/inventory" className="text-xs font-semibold text-primary">Review inventory <span aria-hidden="true">→</span></Link></div>
      </Card>
    </section>
    <section className="grid gap-4 md:grid-cols-2" data-testid="section-charts">
      <Card className="glass-panel" data-testid="card-weekly-activity-chart"><CardHeader className="py-4 px-4 border-b border-border"><CardTitle className="section-heading">Weekly activity (units)</CardTitle></CardHeader><CardContent className="pt-4 px-4">{weeklyActivity.every(day => day.inbound === 0 && day.outbound === 0) ? <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-weekly-data">No activity in the past 7 days.</p> : <WeeklyMovementChart days={weeklyActivity} />}</CardContent></Card>
      <Card className="glass-panel" data-testid="card-category-chart"><CardHeader className="py-4 px-4 border-b border-border"><CardTitle className="section-heading">Inventory by category</CardTitle></CardHeader><CardContent className="pt-4 px-4">{categoryData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-category-data">No inventory data available.</p> : <CategoryInventoryChart categories={categoryData} />}</CardContent></Card>
    </section>
  </div>;
}

type RequestStats = { pendingRequests: number; approvedReadyForPickup: number; todayRequests: number; expiredNoShowCount: number };
function RequestMetrics() {
  const { data: stats, isError, refetch } = useQuery<RequestStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/stats")).json(),
    staleTime: 0,
    refetchOnMount: "always",
  });
  if (isError) return <Card className="glass-panel"><CardContent className="py-3 px-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-destructive">Could not load request metrics.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>;
  if (!stats || stats.pendingRequests === undefined) return null;
  const items = [
    { href: "/requests?status=pending", label: "Pending Requests", value: stats.pendingRequests },
    { href: "/requests?status=pickup", label: "Ready for Pickup", value: stats.approvedReadyForPickup },
    { href: "/requests", label: "Today's Requests", value: stats.todayRequests },
    { href: "/requests", label: "Expired / No-Show", value: stats.expiredNoShowCount },
  ];
  return <section className="sbd-request-metrics" aria-label="Request queue">{items.map(item => <Link key={item.label} href={item.href} className="sbd-request-link"><div><strong>{(item.value ?? 0).toLocaleString()}</strong><span>{item.label}</span></div><ArrowRightIcon aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>)}</section>;
}
