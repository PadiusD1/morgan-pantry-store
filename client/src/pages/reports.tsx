import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRepository } from "@/lib/repository";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canUseServerExports, downloadBlob, downloadCsvText, downloadServerCsv } from "@/lib/download";
import { printBoardSummary } from "@/lib/board-print";
import {
  boardSummaryCsv, buildBoardReport, detailedReportCsv, filterReportTransactions,
  reportDateKey, reportDatePreset, reportFilenameRange, reportRangeError, reportYears,
} from "@shared/reporting";
import { SirenIcon, CalendarDaysIcon, DownloadIcon, PrinterIcon, FileBarChartIcon, Loader2Icon } from "lucide-react";

type EmergencyClient = {
  client_id: string;
  client_name: string;
  client_identifier: string;
  emergency_count: number;
  last_emergency_at: string | null;
};
type EmergencyReport = { totalEmergencies: number; flaggedStudents: EmergencyClient[]; perClient: EmergencyClient[] };

const count = (value: number) => value.toLocaleString("en-US");
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const REPORT_PAGE_SIZE = 50;
const NO_EMERGENCIES: EmergencyClient[] = [];

function useReportPage<T>(rows: T[]) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows]);
  const lastPage = Math.max(0, Math.ceil(rows.length / REPORT_PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  return { rows: rows.slice(current * REPORT_PAGE_SIZE, (current + 1) * REPORT_PAGE_SIZE), page: current, setPage, lastPage, count: rows.length };
}

function ReportPager({ pagination, label }: { pagination: { page: number; setPage: (page: number) => void; lastPage: number; count: number }; label: string }) {
  if (pagination.count <= REPORT_PAGE_SIZE) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
      <p className="text-xs text-muted-foreground" role="status">Showing {pagination.page * REPORT_PAGE_SIZE + 1}–{Math.min((pagination.page + 1) * REPORT_PAGE_SIZE, pagination.count)} of {count(pagination.count)}. Exports include all rows.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-label={`Previous ${label} page`} disabled={pagination.page === 0} onClick={() => pagination.setPage(pagination.page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" aria-label={`Next ${label} page`} disabled={pagination.page === pagination.lastPage} onClick={() => pagination.setPage(pagination.page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export default function ReportsPage() {
  const repo = useRepository();
  const { toast } = useToast();
  const { user } = useAuth();
  const canExportServer = canUseServerExports(user?.role);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [monthlyYear, setMonthlyYear] = useState(() => reportDateKey(new Date())!.slice(0, 4));
  const [monthlyExport, setMonthlyExport] = useState<"all" | "emergency" | null>(null);
  const rangeError = reportRangeError({ from, to });

  const { data: emergencyReport, isError: emergencyError, isPending: emergencyPending, isFetching: emergencyFetching, refetch: refetchEmergencies } = useQuery<EmergencyReport>({
    queryKey: ["/api/reports/emergencies"],
    queryFn: async () => (await apiRequest("GET", "/api/reports/emergencies")).json(),
  });
  const yearsWithData = useMemo(() => reportYears(repo.transactions), [repo.transactions]);
  const board = useMemo(() => buildBoardReport(repo.transactions, repo.inventory, { from, to }), [repo.transactions, repo.inventory, from, to]);
  const rangeTx = useMemo(() => filterReportTransactions(repo.transactions, { from, to }).filter((tx) => tx.type === "OUT"), [repo.transactions, from, to]);
  const byItem = board.items;
  const byClient = useMemo(() => {
    const names = new Map(repo.clients.map((client) => [client.id, client.name]));
    const map = new Map<string, { name: string; visits: number; units: number }>();
    for (const tx of rangeTx) {
      const id = tx.clientId || `unlinked:${tx.clientName || tx.id}`;
      const name = tx.clientName || (tx.clientId && names.get(tx.clientId)) || "Unlinked client";
      const current = map.get(id) || { name, visits: 0, units: 0 };
      current.visits += 1;
      current.units += tx.items.reduce((sum, item) => sum + item.quantity, 0);
      map.set(id, current);
    }
    return [...map.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  }, [rangeTx, repo.clients]);
  const emergencyRangeStats = useMemo(() => ({
    count: board.distribution.emergencyVisits,
    units: rangeTx.filter((tx) => tx.isEmergency).reduce((sum, tx) => sum + tx.items.reduce((units, item) => units + item.quantity, 0), 0),
  }), [rangeTx, board]);
  const itemPage = useReportPage(byItem);
  const clientPage = useReportPage(byClient);
  const emergencyPage = useReportPage(emergencyReport?.perClient ?? NO_EMERGENCIES);

  function showExportError(error: unknown) {
    toast({ title: "Export failed", description: error instanceof Error ? error.message : "Please retry the export.", variant: "destructive" });
  }

  function exportBoard(print = false) {
    if (!canExportServer || rangeError) return;
    try {
      const report = buildBoardReport(repo.transactions, repo.inventory, { from, to });
      if (print) printBoardSummary(report);
      else {
        downloadCsvText(boardSummaryCsv(report), `frc-board-summary-${reportFilenameRange({ from, to })}.csv`);
        toast({ title: "Board summary exported", description: "Service totals, monthly activity, and current stock downloaded without client details." });
      }
    } catch (error) { showExportError(error); }
  }

  async function downloadMonthlyCsv(emergencyOnly: boolean) {
    if (!canExportServer || monthlyExport) return;
    setMonthlyExport(emergencyOnly ? "emergency" : "all");
    try {
      const params = new URLSearchParams({ year: monthlyYear });
      if (emergencyOnly) params.set("emergency", "1");
      await downloadServerCsv(`/api/reports/monthly-csv?${params}`, `frc-monthly-summary-${monthlyYear}${emergencyOnly ? "-emergencies" : ""}.csv`);
      toast({ title: "Monthly summary exported", description: `${monthlyYear} ${emergencyOnly ? "emergency " : ""}item summary downloaded.` });
    } catch (error) { showExportError(error); }
    finally { setMonthlyExport(null); }
  }

  function exportJson() {
    if (!canExportServer) return;
    try {
      // Preserve the original top-level data keys, without serializing context methods.
      const payload = {
        formatVersion: 1, exportedAt: new Date().toISOString(),
        inventory: repo.inventory, clients: repo.clients, transactions: repo.transactions,
        settings: repo.settings, barcodeCache: repo.barcodeCache, sources: repo.sources, categories: repo.categories,
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `frc-data-snapshot-${reportDateKey(new Date())}.json`);
      toast({ title: "Data snapshot exported", description: "All loaded inventory, client, transaction, and local-setting records downloaded." });
    } catch (error) { showExportError(error); }
  }

  function exportCsv() {
    if (!canExportServer || rangeError) return;
    try {
      const { csv, lineCount } = detailedReportCsv(repo.transactions, repo.clients, { from, to });
      downloadCsvText(csv, `frc-transactions-${reportFilenameRange({ from, to })}.csv`);
      toast({ title: "Export complete", description: `Exported ${lineCount} transaction item rows for the selected period.` });
    } catch (error) { showExportError(error); }
  }

  function setPreset(preset: "month" | "previous-month" | "year" | "all") {
    const dates = reportDatePreset(preset);
    setFrom(dates.from);
    setTo(dates.to);
  }

  return (
    <div className="space-y-4">
      <Card className="glass-panel" data-testid="card-report-filters">
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="from" data-testid="label-report-from">From date</label>
              <Input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-invalid={!!rangeError} aria-describedby={rangeError ? "report-date-error" : "report-date-help"} data-testid="input-report-from" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="to" data-testid="label-report-to">To date</label>
              <Input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-invalid={!!rangeError} aria-describedby={rangeError ? "report-date-error" : "report-date-help"} data-testid="input-report-to" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setPreset("month")}>This month</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("previous-month")}>Last month</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("year")}>Year to date</Button>
            <Button size="sm" variant="ghost" onClick={() => setPreset("all")}>All dates</Button>
          </div>
          <p id="report-date-help" className="text-xs text-muted-foreground">Both dates are inclusive, using Baltimore time. Blank dates include all available records.</p>
          {rangeError && <p id="report-date-error" role="alert" className="text-sm text-destructive" data-testid="report-date-error">{rangeError}</p>}
        </CardContent>
      </Card>

      {!rangeError && <Card className="glass-panel" data-testid="card-board-summary">
        <CardHeader className="border-b border-border/80 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="section-heading flex items-center gap-2"><FileBarChartIcon className="h-5 w-5" />Board summary</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground" data-testid="text-board-period">{board.periodLabel}</p>
            </div>
            {canExportServer && <div className="flex flex-wrap gap-2">
              <Button onClick={() => exportBoard()} data-testid="button-export-board-csv"><DownloadIcon className="mr-2 h-4 w-4" />Download board CSV</Button>
              <Button variant="outline" onClick={() => exportBoard(true)} data-testid="button-print-board"><PrinterIcon className="mr-2 h-4 w-4" />Print / save PDF</Button>
            </div>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {[
              ["Distribution visits", count(board.distribution.entries), "visits"],
              ["Identified clients served", count(board.distribution.knownClients), "clients"],
              ["Units distributed", count(board.distribution.units), "units"],
              ["Weight distributed", `${board.distribution.weightLbs.toFixed(1)} lbs`, "weight"],
              ["Estimated value distributed", money(board.distribution.valueUsd), "value"],
              ["Emergency visits", count(board.distribution.emergencyVisits), "emergencies"],
            ].map(([label, value, id]) => (
              <div key={id} className="min-w-0 rounded-lg border border-border/80 bg-background/60 p-3">
                <p className="break-words text-xl font-semibold sm:text-2xl" data-testid={`text-board-${id}`}>{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Board files include service totals, monthly activity, distributed items, and stock levels. Client names, student IDs, contacts, and locations are excluded.</p>
          {board.distribution.unlinkedVisits > 0 && <p className="text-xs text-muted-foreground">{count(board.distribution.unlinkedVisits)} visits have no linked client record and are excluded from the identified-client count.</p>}
          {(board.distribution.unvaluedUnits > 0 || board.distribution.unweighedUnits > 0) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950" data-testid="text-report-missing-values">Data quality: {count(board.distribution.unvaluedUnits)} distributed units have no positive recorded unit value; {count(board.distribution.unweighedUnits)} have no positive recorded unit weight. Totals may be understated.</p>
          )}
        </CardContent>
      </Card>}

      {canExportServer && <Card className="glass-panel" data-testid="card-report-monthly-summary">
        <CardHeader className="border-b border-border/80 px-4 py-3">
          <CardTitle className="section-heading flex items-center gap-1.5"><CalendarDaysIcon className="h-4 w-4" />Annual item summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="monthly-year">Reporting year</label>
              <select id="monthly-year" className="flex h-9 w-full min-w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" value={monthlyYear} onChange={(event) => setMonthlyYear(event.target.value)} disabled={!!monthlyExport} data-testid="select-monthly-year">
                {yearsWithData.map((year) => <option key={year} value={String(year)}>{year}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={() => downloadMonthlyCsv(false)} disabled={!!monthlyExport} data-testid="button-export-monthly-csv">
              {monthlyExport === "all" && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}Download monthly item CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadMonthlyCsv(true)} disabled={!!monthlyExport} data-testid="button-export-monthly-emergency-csv">
              {monthlyExport === "emergency" ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <SirenIcon className="mr-2 h-4 w-4" />}Emergency items CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Uses the full selected year, independent of the dates above. Includes item quantities, weighted average estimated unit values, category subtotals, monthly totals, and a year total.</p>
        </CardContent>
      </Card>}

      {canExportServer && <Card className="glass-panel">
        <CardContent className="px-4 py-4">
          <details data-testid="details-data-tools">
            <summary className="cursor-pointer text-sm font-semibold">Operational exports and data snapshot</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">Detailed transaction files include client information and item-level IN and OUT activity for the selected dates. Use the board summary when sharing board updates.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={exportCsv} disabled={!!rangeError} data-testid="button-export-csv">Detailed transactions CSV</Button>
                <Button type="button" variant="outline" onClick={exportJson} data-testid="button-export-json">Download data snapshot JSON</Button>
              </div>
              <p className="text-xs text-muted-foreground">The JSON snapshot includes all loaded inventory, clients, transactions, and local settings, regardless of the date filter. It is not a full database backup.</p>
              <div className="rounded-md border border-border/80 bg-muted/30 p-3">
                <label className="text-xs font-medium" htmlFor="import-json" data-testid="label-import-json">JSON restore unavailable</label>
                <Input id="import-json" type="file" accept="application/json" disabled aria-describedby="import-unavailable-message" data-testid="input-import-json" className="mt-2" />
                <p id="import-unavailable-message" className="mt-2 text-xs text-muted-foreground">Replaying a snapshot can duplicate records and change stock counts. An administrator must plan a database restore before historical transactions are reimported. Existing snapshots remain downloadable.</p>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>}

      {!rangeError && <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass-panel" data-testid="card-report-inventory-summary">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading">Inventory now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm py-4 px-4">
            <div data-testid="text-report-items-count">Distinct items: {count(board.inventory.itemTypes)}</div>
            <div data-testid="text-report-total-units">
              Total units on hand: {count(board.inventory.units)}
            </div>
            <div data-testid="text-report-total-weight">
              Total weight on hand: {board.inventory.weightLbs.toFixed(1)} lbs
            </div>
            <div>Estimated value on hand: {money(board.inventory.valueUsd)}</div>
            <div>{board.inventory.lowStockItems} low-stock items · {board.inventory.outOfStockItems} out-of-stock items</div>
            <p className="pt-1 text-xs text-muted-foreground">Current stock is independent of the selected reporting period.</p>
          </CardContent>
        </Card>

        <Card className="glass-panel" data-testid="card-report-totals-range">
          <CardHeader className="py-3 px-4 border-b border-border/80">
            <CardTitle className="section-heading">Movement within period</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm py-4 px-4">
            <div data-testid="text-report-range-tx-count">Distribution visits: {count(board.distribution.entries)}</div>
            <div data-testid="text-report-range-weight">
              Total weight distributed: {board.distribution.weightLbs.toFixed(1)} lbs
            </div>
            <div data-testid="text-report-range-value">
              Estimated value distributed: {money(board.distribution.valueUsd)}
            </div>
            <div>Stock received: {count(board.receiving.units)} units · {board.receiving.weightLbs.toFixed(1)} lbs</div>
            <div>Estimated value received: {money(board.receiving.valueUsd)}</div>
            <p className="pt-1 text-xs text-muted-foreground">Received stock includes donations, purchases, transfers, and other sources.</p>
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
                <TableHead className="text-right">Estimated value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byItem.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-6 text-center text-sm text-muted-foreground"
                    data-testid="text-report-no-item"
                  >
                    No distributions for this period.
                  </TableCell>
                </TableRow>
              )}
              {itemPage.rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-report-item-${row.id}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right text-sm">{count(row.quantity)}</TableCell>
                  <TableCell className="text-right text-sm">{money(row.valueUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ReportPager pagination={itemPage} label="distributed items" />
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
            <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center border-b border-border/60">
              <p className="text-sm text-destructive">Could not load the lifetime emergency report.</p>
              <Button size="sm" variant="outline" onClick={() => refetchEmergencies()} disabled={emergencyFetching}>Retry</Button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-4 py-3 border-b border-border/60 bg-red-50/40">
            <div data-testid="text-emergency-range-count">
              <p className="text-2xl font-semibold">{emergencyRangeStats.count}</p>
              <p className="text-xs text-muted-foreground">Emergency visits in range</p>
            </div>
            <div data-testid="text-emergency-range-units">
              <p className="text-2xl font-semibold">{emergencyRangeStats.units}</p>
              <p className="text-xs text-muted-foreground">Units distributed (emergency)</p>
            </div>
            <div data-testid="text-emergency-total">
              <p className="text-2xl font-semibold">{emergencyError ? "Unavailable" : emergencyPending ? "Loading…" : emergencyReport?.totalEmergencies ?? "Unavailable"}</p>
              <p className="text-xs text-muted-foreground">Lifetime emergency visits</p>
            </div>
          </div>
          <p className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">The client table below covers all recorded emergency visits, independent of the date filter.</p>
          {!emergencyError && !emergencyPending && <Table>
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
              {emergencyPage.rows.map((row) => (
                <TableRow key={row.client_id || row.client_name} data-testid={`row-emergency-${row.client_id || row.client_name}`}>
                  <TableCell className="text-sm">{row.client_name || "Unlinked client"}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{row.client_identifier || "—"}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{row.emergency_count}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {row.last_emergency_at ? new Date(row.last_emergency_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }) : "—"}
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
          </Table>}
          {!emergencyError && !emergencyPending && <ReportPager pagination={emergencyPage} label="emergency clients" />}
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
              {clientPage.rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-report-client-${row.id}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right text-sm">{row.visits}</TableCell>
                  <TableCell className="text-right text-sm">{row.units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ReportPager pagination={clientPage} label="distribution clients" />
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
