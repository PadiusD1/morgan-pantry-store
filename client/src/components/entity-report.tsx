import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, UserSearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SourcePicker } from "@/components/source-picker";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { OPEN_PICKER_FRESHNESS } from "@/lib/shared-freshness";
import { useDonationSources } from "@/lib/donation-source";
import { canUseServerExports, downloadServerCsv } from "@/lib/download";
import { type EntityMovement, type EntityReport as ReportData } from "@shared/entity-report";
import { reportFilenameRange, reportRangeError, type ReportRange } from "@shared/reporting";

/**
 * One record's own activity, for the question "what did this person do".
 *
 * The incoming and outgoing columns are deliberately never summed. A partner
 * organisation both contributes and receives, and one combined figure would
 * make it look like a larger recipient the more it gave.
 */

const ROWS_PER_PAGE = 25;

const count = (value: number) => value.toLocaleString("en-US");
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function MovementColumn({ title, movement, note }: { title: string; movement: EntityMovement; note: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-background/60 p-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Entries</dt>
          <dd className="font-medium">{count(movement.entries)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Active days</dt>
          <dd className="font-medium">{count(movement.activeDays)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Units</dt>
          <dd className="font-medium">{count(movement.units)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="font-medium">{movement.weightLbs.toFixed(1)} lbs</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Recorded value</dt>
          <dd className="font-medium">{money(movement.valueCents)}</dd>
        </div>
        {movement.emergencyEntries > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Emergency entries</dt>
            <dd className="font-medium">{count(movement.emergencyEntries)}</dd>
          </div>
        )}
      </dl>
      {(movement.unweighedUnits > 0 || movement.unvaluedUnits > 0) && (
        <p className="mt-2 text-xs text-amber-900">
          {movement.unweighedUnits > 0 && `${count(movement.unweighedUnits)} units have no recorded weight. `}
          {movement.unvaluedUnits > 0 && `${count(movement.unvaluedUnits)} units have no recorded value. `}
          These totals are understated, not complete.
        </p>
      )}
    </div>
  );
}

export function EntityReport({ range }: { range: ReportRange }) {
  const { user } = useAuth();
  const sourcesQuery = useDonationSources();
  const sources = sourcesQuery.data ?? [];
  const [selectedKey, setSelectedKey] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const rangeError = reportRangeError(range);
  const selected = useMemo(() => sources.find((option) => option.key === selectedKey), [sources, selectedKey]);
  const params = new URLSearchParams({ from: range.from, to: range.to });
  const reportUrl = selected ? `/api/reports/entity/${selected.kind}/${encodeURIComponent(selected.id)}` : "";
  const reportQuery = useQuery<ReportData & { generatedAt: string; reportingTimeZone: string }>({
    queryKey: [reportUrl, range.from, range.to],
    queryFn: async () => (await apiRequest("GET", `${reportUrl}?${params}`)).json(),
    enabled: !!selected && !rangeError,
    ...OPEN_PICKER_FRESHNESS,
  });
  // A failed refresh is not a valid zero or a current report. Preserve the
  // selection, expose Retry, and withhold stale totals until a read succeeds.
  const report = !rangeError && !sourcesQuery.isError && !reportQuery.isError ? reportQuery.data : undefined;
  const entity = report?.entity;
  useEffect(() => { setPage(0); setExportError(""); }, [selectedKey, range.from, range.to]);
  async function exportReport() {
    if (!report || !selected || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      await downloadServerCsv(`${reportUrl}/export?${params}`, `frc-${entity!.kind}-${entity!.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${reportFilenameRange(range)}.csv`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed. Please retry.");
    } finally { setExporting(false); }
  }

  // Staff without export rights still read the figures on screen; only the
  // file, which carries every row and leaves the building, is gated.
  const canExport = canUseServerExports(user?.role);

  const lastPage = report ? Math.max(0, Math.ceil(report.rows.length / ROWS_PER_PAGE) - 1) : 0;
  const currentPage = Math.min(page, lastPage);
  const visibleRows = report ? report.rows.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE) : [];

  return (
    <Card className="glass-panel" data-testid="card-entity-report">
      <CardHeader className="border-b border-border/80 px-4 py-4">
        <CardTitle className="section-heading flex items-center gap-2">
          <UserSearchIcon className="h-5 w-5" aria-hidden="true" />
          One record's activity
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a donor, partner organization or student to see only their own activity for the dates above.
          Contributions to the pantry and distributions from it are reported separately and are never added together.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="entity-report-picker">
            Record
          </label>
          <SourcePicker
            id="entity-report-picker"
            options={sources}
            value={selectedKey}
            disabled={sourcesQuery.isPending || sourcesQuery.isError}
            onSelect={(option) => {
              setSelectedKey(option.key);
              setPage(0);
            }}
            data-testid="picker-entity-report"
          />
        </div>

        {rangeError && (
          <p role="alert" className="text-sm text-destructive">
            {rangeError}
          </p>
        )}

        {sourcesQuery.isPending && <p role="status">Loading the record directory…</p>}
        {sourcesQuery.isError && <div role="alert" className="text-sm text-destructive">
          The record directory could not be loaded. No activity totals are shown.
          <Button variant="outline" onClick={() => void sourcesQuery.refetch()}>Retry directory</Button>
        </div>}
        {selected && !rangeError && reportQuery.isPending && <p role="status">Loading this record's activity…</p>}
        {selected && !rangeError && reportQuery.isError && <div role="alert" className="text-sm text-destructive" data-testid="error-entity-report">
          Could not load this record's activity. {reportQuery.error.message}
          <Button variant="outline" onClick={() => void reportQuery.refetch()}>Retry activity</Button>
        </div>}
        {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
        {!selected && !rangeError && !sourcesQuery.isPending && !sourcesQuery.isError && (
          <p role="status" className="text-sm text-muted-foreground" data-testid="text-entity-report-empty">
            No record selected yet.
          </p>
        )}

        {report && entity && (
          <div className="space-y-4" data-testid="entity-report-body">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold" data-testid="text-entity-report-name">
                {entity.name}
              </h3>
              <Badge variant="secondary" className="text-[10px]">
                {selected!.identityLabel}
              </Badge>
              {entity.identifier && (
                <span className="text-xs text-muted-foreground">{entity.identifier}</span>
              )}
              <span className="text-xs text-muted-foreground">· {report.periodLabel}</span>
              <p className="w-full text-xs text-muted-foreground">Calendar: {report.reportingTimeZone}. Snapshot: {new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}.
                {reportQuery.isFetching ? " Refreshing…" : ""}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MovementColumn
                title="Contributed to the pantry"
                movement={report.incoming}
                note="Stock this record brought in."
              />
              <MovementColumn
                title="Distributed by the pantry"
                movement={report.outgoing}
                note={
                  entity.kind === "donor"
                    ? "A donor record receives nothing, so this is always empty."
                    : "Stock this record received."
                }
              />
            </div>

            {report.coverage.ambiguousLegacyEntries > 0 && (
              <p
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"
                role="status"
                data-testid="text-entity-report-ambiguous"
              >
                {count(report.coverage.ambiguousLegacyEntries)} older incoming entries use this name, but another donor, partner or student record
                shares it. These entries remain unallocated and are excluded here. Reconcile the records to
                attribute them.
              </p>
            )}
            {report.coverage.nameMatchedEntries > 0 && (
              <p className="text-xs text-muted-foreground">
                {count(report.coverage.nameMatchedEntries)} entries are attributed by name alone, because they were
                saved without a source record identifier.
              </p>
            )}

            {canExport && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void exportReport()}
                  disabled={exporting || reportQuery.isFetching}
                  data-testid="button-export-entity-report"
                >
                  <DownloadIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                  {exporting ? 'Preparing CSV…' : "Download this record's CSV"}
                </Button>
                <p className="self-center text-xs text-muted-foreground">
                  The file reads every transaction for the selected dates from a fresh server snapshot. New saves may change its totals.
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground" data-testid="text-entity-report-no-rows">
                        No activity for this record in the selected dates.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleRows.map((row) => (
                    <TableRow key={`${row.transactionId}-${row.direction}`} data-testid={`row-entity-report-${row.transactionId}`}>
                      <TableCell className="text-sm">{row.dateEastern}</TableCell>
                      <TableCell className="text-sm">
                        {row.direction === "incoming" ? "Contributed" : "Received"}
                        {row.isEmergency && <Badge variant="destructive" className="ml-2 h-4 px-1 text-[10px]">Emergency</Badge>}
                      </TableCell>
                      <TableCell className="text-right text-sm">{count(row.units)}</TableCell>
                      <TableCell className="text-right text-sm">{row.weightLbs.toFixed(1)} lbs</TableCell>
                      <TableCell className="text-right text-sm">{money(row.valueCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {report.rows.length > ROWS_PER_PAGE && (
              <nav aria-label="Record activity pages" className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground" role="status">
                  Showing {currentPage * ROWS_PER_PAGE + 1}–
                  {Math.min((currentPage + 1) * ROWS_PER_PAGE, report.rows.length)} of {count(report.rows.length)}.
                  The export includes every row.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>
                    Next
                  </Button>
                </div>
              </nav>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
