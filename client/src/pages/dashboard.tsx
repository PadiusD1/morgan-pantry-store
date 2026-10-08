import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRepository, useInventorySummary, isLowStock } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRightIcon, ArrowUpRightIcon, ClockIcon, InboxIcon, PackageIcon, UsersIcon, WeightIcon, BarChart3Icon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { DONUT_OTHER, donutSlices } from "@/lib/donut";
import { sourceNameOf } from "@shared/donation-source";
import { REPORT_TIME_ZONE, reportDateKey } from "@shared/reporting";

export default function DashboardPage() {
  const { inventory, transactions, clients } = useRepository();
  const summary = useInventorySummary();

  const lowStockItems = inventory.filter(isLowStock).slice(0, 5);
  const recentTx = transactions.slice(0, 8);

  // Use the same Baltimore calendar as the board and annual reports.
  const now = new Date();
  const today = reportDateKey(now)!;
  const todaysVisits = transactions.filter((t) => t.type === "OUT" && reportDateKey(t.timestamp) === today);

  // Category breakdown for pie chart
  const categoryData = useMemo(() => donutSlices(inventory), [inventory]);

  // Weekly activity for bar chart (last 7 days)
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
    const days: { day: string; inbound: number; outbound: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = reportDateKey(d);
      const label = d.toLocaleDateString(undefined, { weekday: "short", timeZone: REPORT_TIME_ZONE });
      const { inbound, outbound } = totals.get(dateStr!) ?? { inbound: 0, outbound: 0 };
      days.push({ day: label, inbound, outbound });
    }
    return days;
  }, [transactions, today]);

  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <Card className="glass-panel" data-testid="card-inventory-summary">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <PackageIcon className="h-3.5 w-3.5" />
              Inventory items
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold" data-testid="text-distinct-items">
              {summary.distinctItems}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.totalUnits.toLocaleString()} total units on hand
            </p>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-total-weight">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <WeightIcon className="h-3.5 w-3.5" />
              Weight in stock
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold" data-testid="text-total-weight">
              {summary.totalWeightLbs.toFixed(1)} <span className="text-sm">lbs</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Approximate total based on item weights
            </p>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-today-visits">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ArrowDownRightIcon className="h-3.5 w-3.5" />
              Today's visits
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold" data-testid="text-today-visits-count">
              {todaysVisits.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Distribution check-outs recorded today
            </p>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-total-clients">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <UsersIcon className="h-3.5 w-3.5" />
              Registered clients
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold" data-testid="text-total-clients">
              {clients.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Unique clients with at least one record</p>
          </CardContent>
        </Card>
      </section>

      <RequestMetrics />

      <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)]">
        <Card className="glass-panel" data-testid="card-recent-activity">
          <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <ClockIcon className="h-4 w-4 text-[hsl(221_63%_30%)]" />
              Recent activity
            </CardTitle>
            <Badge variant="outline" className="text-[11px]" data-testid="badge-recent-activity-count">
              {recentTx.length} most recent moves
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTx.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground" data-testid="text-no-activity">
                      No activity recorded yet. Use Check-In or Check-Out to start logging moves.
                    </TableCell>
                  </TableRow>
                )}
                {recentTx.map((tx) => {
                  const units = tx.items.reduce((sum, i) => sum + i.quantity, 0);
                  const firstItem = tx.items[0];
                  const extraCount = tx.items.length - 1;
                  const date = new Date(tx.timestamp);
                  return (
                    <TableRow key={tx.id} data-testid={`row-activity-${tx.id}`}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            tx.type === "IN"
                              ? "badge-blue inline-flex items-center gap-1"
                              : "badge-orange inline-flex items-center gap-1"
                          }
                          data-testid={`badge-activity-type-${tx.id}`}
                        >
                          {tx.type === "IN" ? (
                            <ArrowUpRightIcon className="h-3 w-3" />
                          ) : (
                            <ArrowDownRightIcon className="h-3 w-3" />
                          )}
                          {tx.type === "IN" ? "IN" : "OUT"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="truncate-2" data-testid={`text-activity-summary-${tx.id}`}>
                          {tx.type === "OUT" && tx.clientName && (
                            <span className="font-medium mr-1">{tx.clientName}</span>
                          )}
                          {sourceNameOf(tx) && <span className="font-medium mr-1">{sourceNameOf(tx)}</span>}
                          {firstItem?.name}
                          {extraCount > 0 && <span className="text-muted-foreground"> + {extraCount} more</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm" data-testid={`text-activity-units-${tx.id}`}>
                        {units}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-low-stock">
          <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <PackageIcon className="h-4 w-4 text-[hsl(22_92%_60%)]" />
              Low stock alerts
            </CardTitle>
            <Badge variant="outline" className="text-[11px]" data-testid="badge-low-stock-count">
              {lowStockItems.length} flagged
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {lowStockItems.length === 0 ? (
              <div className="py-6 px-4 text-sm text-muted-foreground" data-testid="text-no-low-stock">
                No items are currently below their reorder threshold.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockItems.map((item) => (
                    <TableRow key={item.id} className="low-stock-row" data-testid={`row-low-stock-${item.id}`}>
                      <TableCell>
                        <span className="text-sm font-medium" data-testid={`text-low-stock-name-${item.id}`}>
                          {item.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" data-testid={`text-low-stock-category-${item.id}`}>
                        {item.category || "Uncategorized"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold" data-testid={`text-low-stock-quantity-${item.id}`}>
                        {item.quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2" data-testid="section-charts">
        <Card className="glass-panel" data-testid="card-weekly-activity-chart">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <BarChart3Icon className="h-4 w-4" />
              Weekly activity (units)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {weeklyActivity.every((d) => d.inbound === 0 && d.outbound === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-weekly-data">
                No activity in the past 7 days.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyActivity} barGap={2}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="inbound" name="Received" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outbound" name="Distributed" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-category-chart">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading flex items-center gap-1.5">
              <PackageIcon className="h-4 w-4" />
              Inventory by category
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {categoryData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-category-data">
                No inventory data available.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {categoryData.map((slice, idx) => (
                      <Cell key={slice.name} fill={slice.name === DONUT_OTHER ? "#9ca3af" : PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value: string) =>
                      `${value} ${categoryData.find((s) => s.name === value)?.percent ?? 0}%`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function RequestMetrics() {
  const { data: stats, isError, refetch } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard/stats");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (isError) {
    return (
      <Card className="glass-panel">
        <CardContent className="py-3 px-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-destructive">Could not load request metrics.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.pendingRequests === undefined) return null;

  return (
    <section className="grid gap-3 md:grid-cols-4">
      <Link href="/requests?status=pending" className="block">
      <Card className="glass-panel h-full transition-colors hover:bg-muted/40">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <InboxIcon className="h-5 w-5 text-amber-600" />
          <div>
            <p className="text-2xl font-semibold">{stats.pendingRequests ?? 0}</p>
            <p className="text-xs text-muted-foreground">Pending Requests</p>
          </div>
        </CardContent>
      </Card>
      </Link>
      <Link href="/requests?status=pickup" className="block">
      <Card className="glass-panel h-full transition-colors hover:bg-muted/40">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <CheckCircleIcon className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-2xl font-semibold">{stats.approvedReadyForPickup ?? 0}</p>
            <p className="text-xs text-muted-foreground">Ready for Pickup</p>
          </div>
        </CardContent>
      </Card>
      </Link>
      <Link href="/requests" className="block">
      <Card className="glass-panel h-full transition-colors hover:bg-muted/40">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <ClockIcon className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-2xl font-semibold">{stats.todayRequests ?? 0}</p>
            <p className="text-xs text-muted-foreground">Today's Requests</p>
          </div>
        </CardContent>
      </Card>
      </Link>
      <Link href="/requests" className="block">
      <Card className="glass-panel h-full transition-colors hover:bg-muted/40">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <AlertTriangleIcon className="h-5 w-5 text-orange-600" />
          <div>
            <p className="text-2xl font-semibold">{stats.expiredNoShowCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Expired / No-Show</p>
          </div>
        </CardContent>
      </Card>
      </Link>
    </section>
  );
}
