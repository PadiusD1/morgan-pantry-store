import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useRepository } from "@/lib/repository";
import { useDonationSources } from "@/lib/donation-source";
import { canUseServerExports, downloadCsvText } from "@/lib/download";
import { relationshipCsv, type RelationshipRecord } from "@shared/relationship-report";
import { reportFilenameRange, reportRangeError } from "@shared/reporting";

export function DirectoryReport({ kind, records, directory = records }: { kind: "donor" | "partner"; records: RelationshipRecord[]; directory?: RelationshipRecord[] }) {
  const { user } = useAuth();
  const { transactions } = useRepository();
  const sources = useDonationSources();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const error = reportRangeError({ from, to });
  if (!canUseServerExports(user?.role)) return null;
  return <details className="rounded border p-4" data-testid={`${kind}-directory-report`}>
    <summary className="cursor-pointer font-medium">Independent {kind} report</summary>
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">Exports the {records.length} directory records matching the search above, including new additions with no activity. Dates limit movements, not directory membership. Contacts and student identities are excluded.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">From date<Input aria-label={`${kind} report from date`} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="space-y-1 text-sm">To date<Input aria-label={`${kind} report to date`} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {sources.isPending && <p role="status">Loading source identities for accurate attribution…</p>}
      {sources.isError && <div role="alert">Source identities could not be loaded. Retry before exporting. <Button variant="outline" onClick={() => void sources.refetch()}>Retry report sources</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={!!error || sources.isPending || sources.isError} onClick={() => downloadCsvText(relationshipCsv(kind, records, transactions, { from, to }, directory, new Date(), sources.data), `frc-${kind}-directory-${reportFilenameRange({ from, to })}.csv`)}>Download {kind} report CSV</Button>
    </div>
  </details>;
}
