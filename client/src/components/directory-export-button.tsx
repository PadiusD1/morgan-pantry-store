import React, { useState } from "react";
import { useAuth } from "@/lib/auth";
import { canUseServerExports, downloadServerCsv } from "@/lib/download";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
export function DirectoryExportButton({ kind }: { kind: "donor" | "partner" }) {
  const { user } = useAuth(); const { toast } = useToast(); const [pending, setPending] = useState(false);
  if (!canUseServerExports(user?.role)) return null;
  async function download() {
    setPending(true);
    try { await downloadServerCsv(`/api/reports/directory.csv?kind=${kind}`, `FRC_${kind}_Directory.csv`); }
    catch (err) { toast({ title: "Directory export failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" }); }
    finally { setPending(false); }
  }
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => void download()} data-testid={`export-${kind}-directory`}>{pending ? "Exporting…" : `Export all ${kind}s`}</Button>;
}
