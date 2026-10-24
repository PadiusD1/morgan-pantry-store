import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useRepository } from "@/lib/repository";
import { useDonationSources } from "@/lib/donation-source";
import { canUseServerExports, downloadCsvText } from "@/lib/download";
import { printBoardDocument } from "@/lib/board-print";
import { eventWhen, useEventSession, useEvents } from "@/lib/events";
import {
  ALL_EVENT_BOARD_DATA, EVENT_BOARD_OPTIONS, RANK_METRIC_LABELS, TOP_CONTRIBUTOR_CHOICES, buildEventBoard, eventBoardCsv, eventBoardSections, hasEventBoardSection,
  type EventBoardKey, type EventScope, type RankMetric,
} from "@shared/event-board";
import { eventBoardHtml } from "@shared/event-board-document";
import { reportFilenameRange, type ReportRange } from "@shared/reporting";
import { DownloadIcon, PrinterIcon, Loader2Icon } from "lucide-react";

const PREVIEW_ROWS = 12;

/**
 * Event and contributor reporting for the board. The screen, the CSV and the
 * printed document are all made from one buildEventBoard result with one
 * selection, so an export never shows anything the screen did not.
 */
export function EventBoardReport({ range }: { range: ReportRange }) {
  const repo = useRepository();
  const { user } = useAuth();
  const { toast } = useToast();
  const canExport = canUseServerExports(user?.role);
  const session = useEventSession();
  const events = useEvents();
  const sources = useDonationSources();
  const [selection, setSelection] = useState<EventBoardKey[]>([...ALL_EVENT_BOARD_DATA]);
  const [scopeKind, setScopeKind] = useState<"all" | "events">("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [rankMetric, setRankMetric] = useState<RankMetric>("units");
  const [topN, setTopN] = useState(10);

  const scope: EventScope = scopeKind === "all" ? { kind: "all" } : { kind: "events", ids: chosen, includeUnassigned };
  const ready = !events.isPending && !events.isError && !sources.isPending && !sources.isError;
  const report = useMemo(() => {
    if (!ready) return null;
    return buildEventBoard({
      transactions: repo.transactions,
      events: events.data ?? [],
      donors: (sources.data ?? []).filter((option) => option.kind === "donor").map((option) => ({ id: option.id, name: option.name })),
      clients: repo.clients.map((client) => ({ id: client.id, name: client.name, clientType: client.clientType ?? null })),
      range, scope, rankMetric,
    });
    // The scope object is rebuilt each render from the values listed here.
  }, [ready, repo.transactions, repo.clients, events.data, sources.data, range.from, range.to, scopeKind, chosen, includeUnassigned, rankMetric]);

  if (session.data && !session.data.ready) return null;

  const sections = report && hasEventBoardSection(selection) ? eventBoardSections(report, selection, topN) : [];
  const exportable = !!report && sections.length > 0 && (scopeKind === "all" || chosen.length > 0 || includeUnassigned);

  function toggle(key: EventBoardKey, on: boolean) {
    setSelection((previous) => on ? [...previous, key] : previous.filter((value) => value !== key));
  }

  function exportCsv() {
    if (!report || !exportable) return;
    try {
      downloadCsvText(eventBoardCsv(report, selection, topN), `frc-events-and-contributors-${reportFilenameRange(range)}.csv`);
      toast({ title: "Event report exported", description: "The selected event data downloaded without student details." });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Please retry the export.", variant: "destructive" });
    }
  }

  function printReport() {
    if (!report || !exportable) return;
    try {
      printBoardDocument(eventBoardHtml(report, selection, topN));
    } catch (error) {
      toast({ title: "Print not opened", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" });
    }
  }

  return (
    <Card className="glass-panel" data-testid="card-event-board">
      <CardHeader className="border-b border-border/80 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="section-heading">Events and contributors</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Distributions and donations by event, unique clients served, and the donors and partners behind them, for the dates above.</p>
          </div>
          {canExport && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!exportable} onClick={exportCsv} data-testid="button-export-event-csv"><DownloadIcon className="mr-2 h-4 w-4" />Download event CSV</Button>
            <Button type="button" disabled={!exportable} onClick={printReport} data-testid="button-print-event-board"><PrinterIcon className="mr-2 h-4 w-4" />Print / save PDF</Button>
          </div>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4">
        {(events.isPending || sources.isPending) && <p className="text-sm text-muted-foreground" role="status"><Loader2Icon className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading events and contributors</p>}
        {(events.isError || sources.isError) && (
          <div role="alert" className="space-y-2" data-testid="event-board-error">
            <p className="text-sm text-destructive">Event figures could not be loaded, so none are shown. Do not report zeros for this period.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { void events.refetch(); void sources.refetch(); }}>Retry</Button>
          </div>
        )}
        {report && <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <fieldset className="space-y-2 rounded-md border p-3" data-testid="event-board-scope">
              <legend className="px-1 text-sm font-semibold">Events to include</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="event-scope" checked={scopeKind === "all"} onChange={() => setScopeKind("all")} data-testid="radio-event-scope-all" />All events and activity without an event</label>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="event-scope" checked={scopeKind === "events"} onChange={() => setScopeKind("events")} data-testid="radio-event-scope-chosen" />Only the events I choose</label>
              {scopeKind === "events" && (
                <div className="max-h-56 space-y-1 overflow-y-auto border-t pt-2" data-testid="event-board-event-list">
                  {(events.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No events have been created yet.</p>}
                  {(events.data ?? []).map((event) => (
                    <label key={event.id} className="flex min-h-10 cursor-pointer items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={chosen.includes(event.id)} onChange={(e) => setChosen((previous) => e.target.checked ? [...previous, event.id] : previous.filter((id) => id !== event.id))} data-testid={`checkbox-board-event-${event.id}`} />
                      <span><span className="font-medium">{event.name}</span> <span className="text-xs text-muted-foreground">{eventWhen(event)}{event.status === "closed" ? ", ended" : ""}</span></span>
                    </label>
                  ))}
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 border-t pt-1 text-sm">
                    <input type="checkbox" checked={includeUnassigned} onChange={(e) => setIncludeUnassigned(e.target.checked)} data-testid="checkbox-board-unassigned" />
                    Activity not assigned to an event
                  </label>
                </div>
              )}
            </fieldset>
            <fieldset className="space-y-3 rounded-md border p-3" data-testid="event-board-selection">
              <legend className="px-1 text-sm font-semibold">Choose data for the board</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {EVENT_BOARD_OPTIONS.map((option) => (
                  <label key={option.key} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={selection.includes(option.key)} onChange={(e) => toggle(option.key, e.target.checked)} data-testid={`event-board-select-${option.key}`} />
                    {option.label}
                  </label>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="event-board-rank">Rank contributors by</label>
                  <Select value={rankMetric} onValueChange={(value) => setRankMetric(value as RankMetric)}>
                    <SelectTrigger id="event-board-rank" data-testid="select-event-board-rank"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RANK_METRIC_LABELS) as RankMetric[]).map((metric) => <SelectItem key={metric} value={metric}>{RANK_METRIC_LABELS[metric]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="event-board-top">Contributors listed</label>
                  <Select value={String(topN)} onValueChange={(value) => setTopN(Number(value))}>
                    <SelectTrigger id="event-board-top" data-testid="select-event-board-top"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TOP_CONTRIBUTOR_CHOICES.map((choice) => <SelectItem key={choice} value={String(choice)}>{choice === 0 ? "All contributors" : `Top ${choice}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">The CSV and the PDF contain exactly this selection. No student name, ID or contact detail is included.</p>
            </fieldset>
          </div>

          {!hasEventBoardSection(selection) && <p role="status" className="text-sm">Select at least one section to populate the event report.</p>}
          {scopeKind === "events" && chosen.length === 0 && !includeUnassigned && <p role="status" className="text-sm">Choose at least one event to include.</p>}

          <div className="space-y-5" data-testid="event-board-preview">
            {sections.map((section) => (
              <section key={section.key} data-testid={`event-board-section-${section.key}`}>
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>{section.columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {section.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                        <TableRow key={index}>{row.map((cell, column) => <TableCell key={column} className={column === 0 ? "font-medium" : undefined}>{cell}</TableCell>)}</TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {section.rows.length === 0 && <p className="py-2 text-xs text-muted-foreground">No recorded activity in this section for the selected dates and events.</p>}
                {section.rows.length > PREVIEW_ROWS && <p className="text-xs text-muted-foreground">Showing {PREVIEW_ROWS} of {section.rows.length} rows. The CSV and PDF include every row.</p>}
                {section.note && <p className="mt-1 text-xs text-muted-foreground">{section.note}</p>}
              </section>
            ))}
          </div>
          {(report.coverage.ambiguousInbound > 0 || report.coverage.unattributedInbound > 0 || report.coverage.unknownEventEntries > 0) && (
            <p className="rounded-md border p-2 text-xs" data-testid="text-event-board-coverage">
              {report.coverage.ambiguousInbound > 0 && `${report.coverage.ambiguousInbound} donation entries name a source shared by several records and are credited to no one. `}
              {report.coverage.unattributedInbound > 0 && `${report.coverage.unattributedInbound} entries received have no identifiable donor or partner. `}
              {report.coverage.unknownEventEntries > 0 && `${report.coverage.unknownEventEntries} entries name an event missing from the loaded list. Refresh before sharing.`}
            </p>
          )}
        </>}
      </CardContent>
    </Card>
  );
}
