import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogQuality } from "@shared/catalog";
import { useAuth } from "@/lib/auth";
import { apiRequest, saveErrorMessage } from "@/lib/queryClient";
import { downloadServerCsv } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
type Quality = ReturnType<typeof catalogQuality>;
type Row = Quality["rows"][number];

export function CatalogQualityPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [weight, setWeight] = useState(""); const [value, setValue] = useState("");
  const [photo, setPhoto] = useState(""); const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  const staff = user?.role === "staff" || user?.role === "admin";
  const quality = useQuery<Quality>({ queryKey: ["/api/catalog/quality"], enabled: open && staff, staleTime: 0 });
  if (!staff) return null;
  const rows = (quality.data?.rows ?? []).filter(r => `${r.name} ${r.barcode ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  function edit(row: Row) { setEditing(row); setWeight(""); setValue(""); setPhoto(""); setEvidence(""); }
  async function refreshItem() {
    if (!editing || saving) return;
    try {
      const response = await apiRequest("GET", `/api/inventory/${editing.id}`);
      const saved = await response.json();
      setEditing(current => current ? { ...current, updatedAt: saved.updatedAt, weightPerUnitLbs: saved.weightPerUnitLbs, valuePerUnitUsd: saved.valuePerUnitUsd } : null);
      toast({ title: "Current data refreshed", description: "Your entries are kept. Compare them with the saved values before saving again." });
    } catch (err) { toast({ title: "Refresh failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" }); }
  }
  async function save() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/inventory/${editing.id}/catalog`, {
        expectedUpdatedAt: editing.updatedAt, evidence,
        ...(weight.trim() ? { weightPerUnitLbs: Number(weight), weightIsEstimated: true } : {}),
        ...(value.trim() ? { valuePerUnitUsd: Number(value), costIsEstimated: true } : {}),
        ...(photo.trim() ? { imageUrl: photo.trim(), imageAlt: editing.name, imageSource: evidence.slice(0,300) } : {}),
      });
      setEditing(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["/api/inventory"] }), qc.invalidateQueries({ queryKey: ["/api/catalog/quality"] })]);
      toast({ title: "Catalog data saved", description: "New checkouts use these values. Earlier receipt snapshots are unchanged." });
    } catch (err) { toast({ title: "Catalog not saved", description: saveErrorMessage(err, "Refresh and review the item before trying again."), variant: "destructive" }); }
    finally { setSaving(false); }
  }
  return <section aria-label="Catalog completeness" className="rounded-md border p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Complete weights, values and photos</h2><p className="text-sm text-muted-foreground">Use package measurements and documented estimates, not invented totals.</p></div><Button variant="outline" size="sm" onClick={() => setOpen(!open)} data-testid="button-catalog-review">{open ? "Hide review" : "Review missing data"}</Button></div>
    {open && <>
      {quality.isPending && <p role="status">Loading catalog review…</p>}
      {quality.isError && <p role="alert">The review could not be loaded. <button onClick={() => void quality.refetch()}>Retry</button></p>}
      {quality.data && <>
        <p data-testid="catalog-gap-counts" className="text-sm">{quality.data.missingWeight} missing weights · {quality.data.missingValue} missing values · {quality.data.missingPhoto} missing photo links · {quality.data.total} total items</p>
        <div className="flex flex-wrap gap-2"><Input aria-label="Find catalog item" value={query} onChange={e => setQuery(e.target.value)} className="max-w-sm" /><Button size="sm" variant="outline" onClick={() => void quality.refetch()}>Refresh review</Button><Button size="sm" variant="outline" onClick={() => void downloadServerCsv("/api/catalog/quality.csv", "FRC_Catalog_Gaps.csv").catch(err => toast({ title: "Export failed", description: err.message, variant: "destructive" }))}>Export all gaps</Button></div>
        <p className="text-xs text-muted-foreground">Showing {Math.min(rows.length, 50)} of {rows.length} matching items. Search to narrow the review. The export includes every gap. A saved photo link does not guarantee the image is reachable.</p>
        <ul className="divide-y">{rows.slice(0,50).map(row => <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm"><div className="min-w-0 break-words">{row.name}<p className="text-xs text-muted-foreground">Missing: {row.gaps.join(", ")}</p></div><Button size="sm" variant="outline" onClick={() => edit(row)} data-testid={`edit-catalog-${row.id}`}>Complete data</Button></li>)}</ul>
        {!rows.length && <p>No catalog gaps match this search.</p>}
      </>}
    </>}
    <Dialog open={!!editing} onOpenChange={v => { if (!v && !saving) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Complete catalog data</DialogTitle><DialogDescription>{editing?.name}. Leave an entry blank to keep its saved value. Weights must be per checkout unit, in pounds. Do not treat fluid ounces as weight.</DialogDescription></DialogHeader>
      <p className="text-sm">Currently saved: {editing?.weightPerUnitLbs} lbs per unit; ${editing?.valuePerUnitUsd} per unit.</p>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => void refreshItem()}>Refresh saved item</Button>
      <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3">
        <fieldset disabled={saving} className="space-y-3"><legend className="sr-only">Catalog measurements, photo and source</legend>
        <div><label htmlFor="catalog-weight">Unit weight (lbs)</label><Input id="catalog-weight" type="number" min="0.0001" step="0.0001" value={weight} onChange={e => setWeight(e.target.value)} /></div>
        <div><label htmlFor="catalog-value">Estimated unit value (USD)</label><Input id="catalog-value" type="number" min="0.01" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></div>
        <div><label htmlFor="catalog-photo">Product photo URL</label><Input id="catalog-photo" value={photo} onChange={e => setPhoto(e.target.value)} /><p className="text-xs text-muted-foreground">Use the exact product photo from images.openfoodfacts.org or a hosted /item-photos/ file. No search-result or tracking URLs.</p></div>
        <div><label htmlFor="catalog-evidence">Source and date for these entries</label><Input id="catalog-evidence" required minLength={5} maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Package label / price source, package size, checked date" /></div>
        <p className="text-xs text-muted-foreground">Staff-entered measurements and values are marked estimated. No stock quantity or historical transaction is changed.</p>
        <Button type="submit" disabled={saving || !evidence.trim() || (!weight.trim() && !value.trim() && !photo.trim())}>{saving ? "Saving…" : "Save catalog data"}</Button>
        </fieldset>
      </form>
    </DialogContent></Dialog>
  </section>;
}
