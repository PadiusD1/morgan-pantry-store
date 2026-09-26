import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import { toApiInventoryBody, toApiClientBody } from "@/lib/api-types";
import type { InventoryItem, ClientRecord, Transaction } from "@/lib/repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canUseServerExports, downloadBlob, downloadCsvText, downloadServerCsv } from "@/lib/download";
import { csvRow } from "@shared/csv";
import { SirenIcon, CalendarDaysIcon } from "lucide-react";

type EmergencyClient = {
  client_id: string;
  client_name: string;
  client_identifier: string;
  emergency_count: number;
  last_emergency_at: string | null;
};

type EmergencyReport = {
  totalEmergencies: number;
  flaggedStudents: EmergencyClient[];
  perClient: EmergencyClient[];
};

export default function ReportsPage() {
  const repo = useRepository();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canExportServer = canUseServerExports(user?.role);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [monthlyYear, setMonthlyYear] = useState<string>(String(new Date().getFullYear()));

  const { data: emergencyReport, isError: emergencyError, refetch: refetchEmergencies } = useQuery<EmergencyReport>({
    queryKey: ["/api/reports/emergencies"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/emergencies");
      return res.json();
    },
  });

  const yearsWithData = useMemo(() => {
    const set = new Set<number>();
    for (const tx of repo.transactions) {
      if (tx.type !== "OUT") continue;
      const d = new Date(tx.timestamp);
      if (!Number.isNaN(d.getTime())) set.add(d.getFullYear());
    }
    if (set.size === 0) set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [repo.transactions]);

  const rangeTx = useMemo(() => {
    return repo.transactions.filter((tx) => {
      if (tx.type !== "OUT") return false;
      // Use local date for filtering so it matches the date picker values
      const d = new Date(tx.timestamp);
      const dateOnly = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (from && dateOnly < from) return false;
      if (to && dateOnly > to) return false;
      return true;
    });
  }, [repo.transactions, from, to]);

  const byItem = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number }>();
    for (const tx of rangeTx) {
      for (const item of tx.items) {
        const current = map.get(item.itemId) || { name: item.name, quantity: 0 };
        current.quantity += item.quantity;
        map.set(item.itemId, current);
      }
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [rangeTx]);

  const byClient = useMemo(() => {
    const map = new Map<string, { name: string; visits: number; units: number }>();
    for (const tx of rangeTx) {
      const id = tx.clientId || tx.clientName || "unknown";
      const name = tx.clientName || "Unknown";
      const units = tx.items.reduce((sum, i) => sum + i.quantity, 0);
      const current = map.get(id) || { name, visits: 0, units: 0 };
      current.visits += 1;
      current.units += units;
      map.set(id, current);
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [rangeTx]);

  const totals = useMemo(() => {
    let totalWeight = 0;
    let totalValue = 0;
    for (const tx of rangeTx) {
      for (const item of tx.items) {
        totalWeight += item.weightPerUnitLbs * item.quantity;
        totalValue += item.valuePerUnitUsd * item.quantity;
      }
    }
    return { totalWeight, totalValue };
  }, [rangeTx]);

  const emergencyRangeStats = useMemo(() => {
    const emergencyTxs = rangeTx.filter((t) => t.isEmergency);
    let units = 0;
    let value = 0;
    for (const tx of emergencyTxs) {
      for (const item of tx.items) {
        units += item.quantity;
        value += item.valuePerUnitUsd * item.quantity;
      }
    }
    return { count: emergencyTxs.length, units, value };
  }, [rangeTx]);

  async function downloadMonthlyCsv(opts: { emergencyOnly?: boolean }) {
    try {
      const params = new URLSearchParams();
      if (monthlyYear) params.set("year", monthlyYear);
      if (opts.emergencyOnly) params.set("emergency", "1");
      const url = `/api/reports/monthly-csv?${params.toString()}`;
      await downloadServerCsv(url, `frc-monthly-summary-${monthlyYear}${opts.emergencyOnly ? "-emergencies" : ""}.csv`);
      toast({
        title: "Monthly summary exported",
        description: opts.emergencyOnly
          ? "Emergency-only monthly summary CSV downloaded."
          : "Monthly summary CSV downloaded.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Monthly CSV export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    }
  }

  function exportJson() {
    const payload = JSON.stringify(repo, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    downloadBlob(blob, "morgan-state-repository-export.json");
  }

  function exportCsv() {
    try {
      const rows: string[] = [];
      rows.push("type,timestamp,latitude,longitude,accuracy,client,clientIdentifier,itemName,quantity,weightPerUnitLbs,valuePerUnitUsd");
      for (const tx of repo.transactions) {
        const lat = tx.location?.latitude ?? "";
        const long = tx.location?.longitude ?? "";
        const acc = tx.location?.accuracy ?? "";

        for (const item of tx.items) {
          // Prefer stored clientName first (survives client deletion), fall back to lookup
          const clientRecord = tx.clientId ? repo.clients.find((c) => c.id === tx.clientId) : undefined;
          const client = tx.clientName ?? clientRecord?.name ?? "";
          const identifier = clientRecord?.identifier ?? "";
          rows.push(
            csvRow([
              tx.type,
              tx.timestamp,
              lat,
              long,
              acc,
              client,
              identifier,
              item.name,
              item.quantity,
              item.weightPerUnitLbs,
              item.valuePerUnitUsd,
            ]),
          );
        }
      }
      downloadCsvText(rows.join("\r\n"), `frc-export-${new Date().toISOString().split("T")[0]}.csv`);
      toast({ title: "Export complete", description: `Exported ${rows.length - 1} transaction rows.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "CSV export failed";
      toast({ title: "Export failed", description: message, variant: "destructive" });
    }
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        // Import inventory items
        const idMap = new Map<string, string>();
        if (Array.isArray(parsed.inventory)) {
          for (const item of parsed.inventory as InventoryItem[]) {
            const res = await apiRequest("POST", "/api/inventory", toApiInventoryBody(item));
            const created = await res.json();
            idMap.set(item.id, created.id);
          }
        }

        // Import clients
        const clientIdMap = new Map<string, string>();
        if (Array.isArray(parsed.clients)) {
          for (const client of parsed.clients as ClientRecord[]) {
            const res = await apiRequest("POST", "/api/clients", toApiClientBody(client));
            const created = await res.json();
            clientIdMap.set(client.id, created.id);
          }
        }

        // Import transactions
        if (Array.isArray(parsed.transactions)) {
          for (const tx of parsed.transactions as Transaction[]) {
            await apiRequest("POST", "/api/transactions", {
              type: tx.type,
              timestamp: tx.timestamp,
              source: tx.source ?? null,
              donor: tx.donor ?? null,
              clientId: (tx.clientId && clientIdMap.get(tx.clientId)) ?? tx.clientId ?? null,
              clientName: tx.clientName ?? null,
              latitude: tx.location?.latitude ?? null,
              longitude: tx.location?.longitude ?? null,
              accuracy: tx.location?.accuracy ?? null,
              items: tx.items.map((ti) => ({
                inventoryItemId: idMap.get(ti.itemId) ?? ti.itemId,
                name: ti.name,
                quantity: ti.quantity,
                weightPerUnitLbs: String(ti.weightPerUnitLbs),
                valuePerUnitUsd: String(ti.valuePerUnitUsd),
              })),
            });
          }
        }

        qc.invalidateQueries({ queryKey: ["/api/inventory"] });
        qc.invalidateQueries({ queryKey: ["/api/clients"] });
        qc.invalidateQueries({ queryKey: ["/api/transactions"] });
      } catch {
        alert("Could not import data. Ensure the JSON file is a valid export.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-report-filters">
        <CardContent className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="from" data-testid="label-report-from">
              From date
            </label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-report-from"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="to" data-testid="label-report-to">
              To date
            </label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-report-to"
            />
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <Button type="button" variant="outline" onClick={exportJson} data-testid="button-export-json">
              Export JSON
            </Button>
            <Button type="button" variant="outline" onClick={exportCsv} data-testid="button-export-csv">
              Export CSV
            </Button>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="import-json"
              data-testid="label-import-json"
            >
              Import JSON backup
            </label>
            <Input id="import-json" type="file" accept="application/json" onChange={handleImport} data-testid="input-import-json" />
          </div>
        </CardContent>
      </Card>

      {/* Monthly summary CSV exporter — keeps the existing detailed CSV intact and adds
          a separate, month-grouped summary report with category subtotals and a year total. */}
      {canExportServer && (
      <Card className="glass-panel" data-testid="card-report-monthly-summary">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <CalendarDaysIcon className="h-4 w-4" />
            Monthly summary CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 py-4 px-4 md:grid-cols-[160px_minmax(0,1fr)] md:items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="monthly-year">Year</label>
            <select
              id="monthly-year"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={monthlyYear}
              onChange={(e) => setMonthlyYear(e.target.value)}
              data-testid="select-monthly-year"
            >
              {yearsWithData.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadMonthlyCsv({ emergencyOnly: false })}
              data-testid="button-export-monthly-csv"
            >
              Export Monthly Summary CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadMonthlyCsv({ emergencyOnly: true })}
              data-testid="button-export-monthly-emergency-csv"
            >
              <SirenIcon className="h-4 w-4 mr-1" />
              Emergencies only (monthly)
            </Button>
            <p className="text-[11px] text-muted-foreground self-center">
              Items, unit cost, category subtotals, monthly totals, and a year grand total.
              The detailed CSV above stays untouched.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-panel" data-testid="card-report-inventory-summary">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading">Inventory summary (current)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm py-4 px-4">
            <div data-testid="text-report-items-count">Distinct items: {repo.inventory.length}</div>
            <div data-testid="text-report-total-units">
              Total units on hand: {repo.inventory.reduce((sum, i) => sum + i.quantity, 0)}
            </div>
            <div data-testid="text-report-total-weight">
              Total weight on hand: {repo.inventory
                .reduce((sum, i) => sum + i.quantity * i.weightPerUnitLbs, 0)
                .toFixed(1)}{" "}
              lbs
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-report-totals-range">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading">Distributed totals (range)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm py-4 px-4">
            <div data-testid="text-report-range-tx-count">OUT transactions: {rangeTx.length}</div>
            <div data-testid="text-report-range-weight">
              Total weight distributed: {totals.totalWeight.toFixed(1)} lbs
            </div>
            <div data-testid="text-report-range-value">
              Estimated value distributed: ${totals.totalValue.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-panel" data-testid="card-report-by-item">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading">Distribution by item</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Total units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byItem.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-report-no-item"
                  >
                    No OUT transactions for this range.
                  </TableCell>
                </TableRow>
              )}
              {byItem.map((row) => (
                <TableRow key={row.id} data-testid={`row-report-item-${row.id}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right text-sm">{row.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Emergency Shop Appointments — own category in reports + flagged students */}
      <Card className="glass-panel border-red-200/70" data-testid="card-report-emergencies">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading flex items-center gap-1.5">
            <SirenIcon className="h-4 w-4 text-red-600" />
            Emergency Shop Appointments
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {emergencyError && (
            <div className="flex flex-col items-center gap-2 py-6 text-center border-b border-border/60">
              <p className="text-sm text-destructive">Could not load the emergency report.</p>
              <Button size="sm" variant="outline" onClick={() => refetchEmergencies()}>Retry</Button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-border/60 bg-red-50/40">
            <div data-testid="text-emergency-range-count">
              <p className="text-2xl font-semibold">{emergencyRangeStats.count}</p>
              <p className="text-xs text-muted-foreground">Emergency visits in range</p>
            </div>
            <div data-testid="text-emergency-range-units">
              <p className="text-2xl font-semibold">{emergencyRangeStats.units}</p>
              <p className="text-xs text-muted-foreground">Units distributed (emergency)</p>
            </div>
            <div data-testid="text-emergency-total">
              <p className="text-2xl font-semibold">{emergencyReport?.totalEmergencies ?? 0}</p>
              <p className="text-xs text-muted-foreground">Lifetime emergency visits</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student / client</TableHead>
                <TableHead className="hidden md:table-cell">Identifier</TableHead>
                <TableHead className="text-right">Emergency count</TableHead>
                <TableHead className="hidden md:table-cell">Last emergency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(emergencyReport?.perClient?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-no-emergencies"
                  >
                    No Emergency Shop Appointments recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {emergencyReport?.perClient?.map((row) => (
                <TableRow key={row.client_id || row.client_name} data-testid={`row-emergency-${row.client_id || row.client_name}`}>
                  <TableCell className="text-sm">{row.client_name}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{row.client_identifier || "—"}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{row.emergency_count}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {row.last_emergency_at ? new Date(row.last_emergency_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    {row.emergency_count > 1 ? (
                      <Badge variant="destructive" className="text-[10px] h-5">
                        <SirenIcon className="h-3 w-3 mr-1" />
                        Flagged
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] h-5">Single visit</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="glass-panel" data-testid="card-report-by-client">
        <CardHeader className="py-3 px-4 border-b border-border/80">
          <CardTitle className="section-heading">Distribution by client</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Total units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byClient.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-report-no-client"
                  >
                    No client visits for this range.
                  </TableCell>
                </TableRow>
              )}
              {byClient.map((row) => (
                <TableRow key={row.id} data-testid={`row-report-client-${row.id}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right text-sm">{row.visits}</TableCell>
                  <TableCell className="text-right text-sm">{row.units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
