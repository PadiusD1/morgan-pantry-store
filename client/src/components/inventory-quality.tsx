import { nextReviewId, qualityMatches, type QualityFilter } from '@/lib/quality-queue';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiRequest, saveErrorMessage } from '@/lib/queryClient';
import { OPEN_PICKER_FRESHNESS } from '@/lib/shared-freshness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductPhotoEditor } from './product-photo-editor';

type HistoryMode = 'future_only' | 'missing_only' | 'replace_incorrect';
type Row = { id: string; name: string; barcode?: string | null; brand?: string | null; category?: string; quantity?: number; reservedQuantity?: number; packageType?: string | null; unitCount?: number | null; updatedAt: string; weightPerUnitLbs: string; valuePerUnitUsd: string; missingWeight: boolean; missingValue: boolean; imageUrl: string | null; weightLbs: number | null; weightSource: string | null; valueUsd: number | null; valueSource: string | null; measurementHistory?: Array<{ at: string; reason?: string; history?: { mode: string; counts?: { rows: number; transactions: number } } }> };
type Audit = { total: number; missingWeight: number; missingValue: number; missingPhoto: number; items: Row[] };
type Preview = { expectedUpdatedAt: string; historyFingerprint: string; mode: string; range: { from?: string; to?: string }; counts: { rows: number; transactions: number; weightRows: number; weightTransactions: number; valueRows: number; valueTransactions: number }; totals: { beforeWeightLbs: number; afterWeightLbs: number; beforeValueUsd: number; afterValueUsd: number }; maxRows: number; canApply: boolean };
type Draft = { item: Row; weight: string; value: string; weightSource: string; valueSource: string; weightEstimated: boolean; valueEstimated: boolean; mode: HistoryMode; from: string; to: string; reason: string; samePackage: boolean; replaceConfirmed: boolean; preview?: Preview };
type Filter = QualityFilter;
const PAGE_SIZE = 10;
function freshDraft(item: Row): Draft {
  return { item, weight: item.missingWeight && item.weightLbs ? String(item.weightLbs) : '', value: item.missingValue && item.valueUsd ? String(item.valueUsd) : '', weightSource: item.weightSource ?? '', valueSource: item.valueSource ?? '', weightEstimated: false, valueEstimated: true, mode: 'future_only', from: '', to: '', reason: 'Fill missing measurements from this reviewed inventory package.', samePackage: false, replaceConfirmed: false };
}
function positiveMeasurement(value: string, decimals: number, maximum: number) {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && n > 0 && n <= maximum && Math.abs(n * 10 ** decimals - Math.round(n * 10 ** decimals)) < 0.000001;
}
function failureMessage(error: unknown, fallback: string) {
  const special = saveErrorMessage(error, fallback);
  if (special !== fallback) return special;
  if (error instanceof Error) {
    try { const body = JSON.parse(error.message.replace(/^\d+:\s*/, '')); if (typeof body.message === 'string') return `${body.message} Your entries are kept.`; } catch { /* Use the bounded fallback. */ }
  }
  return fallback;
}
function formatNumber(value: number, maximumFractionDigits = 2) { return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value); }

export function InventoryQuality() {
  const { user } = useAuth(); const qc = useQueryClient();
  const allowed = user?.role === 'admin' || user?.role === 'staff';
  const { data, isPending, isError, isFetching, refetch } = useQuery<Audit>({ queryKey: ['/api/inventory/quality'], enabled: allowed, ...OPEN_PICKER_FRESHNESS });
  const [open, setOpen] = useState(false); const [search, setSearch] = useState(''); const [filter, setFilter] = useState<Filter>('incomplete'); const [page, setPage] = useState(0);
  // Drafts own the reviewed version. Neither a refetch nor browsing another row
  // silently advances that version or replaces the staff member's entries.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [id, setId] = useState('');
  const draft = drafts[id]; const selected = draft?.item; const latest = data?.items.find(item => item.id === id);
  const [pending, setPending] = useState<'preview' | 'save' | 'photo' | null>(null); const [message, setMessage] = useState(''); const [messageIsError, setMessageIsError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null); const focusReview = useRef(false);
  useEffect(() => { if (focusReview.current && open && selected) { heading.current?.focus(); focusReview.current = false; } }, [open, selected]);
  function selectItem(row: Row | undefined, reset = false, reveal = false) {
    setId(row?.id ?? ''); setMessage(''); setMessageIsError(false);
    if (row) setDrafts(current => reset || !current[row.id] ? { ...current, [row.id]: freshDraft(row) } : current);
    if (reveal) { setOpen(true); if (open && selected?.id === row?.id) heading.current?.focus(); else focusReview.current = true; }
  }
  function edit(patch: Partial<Draft>, keepPreview = false) {
    setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch, ...(keepPreview ? {} : { preview: undefined, replaceConfirmed: false }) } }));
    setMessage(''); setMessageIsError(false);
  }
  function changeFilter(next: Filter) { setFilter(next); setPage(0); }
  const items = data?.items ?? [];
  const missingBoth = items.filter(item => item.missingWeight && item.missingValue).length;
  const filtered = items.filter(item => qualityMatches(item, filter, search));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const measurementValid = !!draft && (!!draft.weight || !!draft.value) && (!draft.weight || (positiveMeasurement(draft.weight, 4, 99999) && draft.weightSource.trim().length >= 8)) && (!draft.value || (positiveMeasurement(draft.value, 2, 999999) && draft.valueSource.trim().length >= 8));
  const historyValid = !!draft && draft.reason.trim().length >= 8 && (!draft.from || !draft.to || draft.from <= draft.to);
  const history = draft?.mode !== 'future_only';
  const canSave = measurementValid && (!history || (historyValid && !!draft?.preview?.canApply && draft.samePackage && (draft.mode !== 'replace_incorrect' || draft.replaceConfirmed)));
  function body() {
    if (!draft) return {};
    return { expectedUpdatedAt: draft.item.updatedAt,
      ...(draft.weight ? { weightPerUnitLbs: Number(draft.weight), weightSource: draft.weightSource, weightIsEstimated: draft.weightEstimated } : {}),
      ...(draft.value ? { valuePerUnitUsd: Number(draft.value), valueSource: draft.valueSource, costIsEstimated: draft.valueEstimated } : {}),
      ...(history ? { history: { mode: draft.mode, ...(draft.from ? { from: draft.from } : {}), ...(draft.to ? { to: draft.to } : {}), reason: draft.reason, confirmedSamePackage: draft.samePackage, confirmedReplace: draft.replaceConfirmed, ...(draft.preview ? { expectedFingerprint: draft.preview.historyFingerprint } : {}) } } : {}),
    };
  }
  async function preview() {
    if (!draft || pending || !measurementValid || !historyValid) return;
    setPending('preview'); setMessage(''); setMessageIsError(false);
    try { const result = await (await apiRequest('POST', `/api/inventory/${id}/measurements/preview`, body())).json() as Preview; edit({ preview: result, replaceConfirmed: false }, true); }
    catch (error) { setMessage(failureMessage(error, 'Could not preview historical corrections. Your entries are kept.')); setMessageIsError(true); }
    finally { setPending(null); }
  }
  async function save() {
    if (!draft || pending || !canSave) return;
    setPending('save'); setMessage(''); setMessageIsError(false);
    try {
      const receipt = await (await apiRequest('PATCH', `/api/inventory/${id}/measurements`, body())).json() as { updatedAt: string };
      // The write receipt is authoritative even if the following refresh fails.
      // Retiring this submitted draft must not depend on selecting the next row.
      const committed: Row = { ...draft.item, updatedAt: receipt.updatedAt,
        ...(draft.weight ? { weightPerUnitLbs: draft.weight, missingWeight: false } : {}),
        ...(draft.value ? { valuePerUnitUsd: draft.value, missingValue: false } : {}),
      };
      setDrafts(current => ({ ...current, [id]: freshDraft(committed) }));
      await qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && ['/api/inventory', '/api/transactions', '/api/reports', '/api/donors', '/api/clients', '/api/partners', '/api/dashboard'].some(prefix => (query.queryKey[0] as string).startsWith(prefix)) });
      const refreshed = qc.getQueryData<Audit>(['/api/inventory/quality'])?.items;
      if (refreshed) {
        const savedRow = refreshed.find(item => item.id === id);
        if (savedRow && new Date(savedRow.updatedAt) >= new Date(receipt.updatedAt)) setDrafts(current => ({ ...current, [id]: freshDraft(savedRow) }));
        const nextId = nextReviewId(items, refreshed, id, filter, search);
        selectItem(nextId === id ? committed : refreshed.find(item => item.id === nextId), false, true);
      }
      setMessage(history ? 'Saved reviewed measurements and the previewed historical corrections. Stock, quantities and recipients were not changed.' : 'Saved. Current stock and historical transaction measurements were not changed.');
    } catch (error) { setMessage(failureMessage(error, 'Could not save measurements. Your entries are kept.')); setMessageIsError(true); }
    finally { setPending(null); }
  }
  if (!allowed) return null;
  return <section className="min-w-0 rounded border p-4 space-y-4" data-testid="inventory-quality" aria-labelledby="inventory-quality-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="inventory-quality-title" className="text-lg font-semibold">Inventory data quality</h2><p className="text-sm text-muted-foreground">Find missing weights and prices, or review an incorrect saved measurement.</p></div><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={!!pending || isFetching} onClick={() => refetch()}>Refresh completeness check</Button></div>
    {isPending && <p role="status">Checking saved inventory…</p>}
    {isError && <p role="alert">The quality check could not load. {data ? 'The totals below are from the last successful check.' : 'No completeness total is available.'}</p>}
    {data && <>
      <div className="grid gap-2 sm:grid-cols-3" aria-label="Missing measurement totals">
        {([{ key: 'weight', label: 'Missing weight', count: data.missingWeight }, { key: 'value', label: 'Missing price', count: data.missingValue }, { key: 'both', label: 'Missing both', count: missingBoth }] as const).map(metric => <button key={metric.key} type="button" aria-pressed={filter === metric.key} onClick={() => changeFilter(metric.key)} className="min-h-11 min-w-0 border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" disabled={!!pending}><span className="block text-2xl font-semibold tabular-nums">{metric.count}</span><span className="text-sm">{metric.label}</span></button>)}
      </div>
      <p className="text-sm text-muted-foreground">{data.total} items checked. Counts include items with no current stock. {data.missingPhoto} without an available photo source.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm">Search review items<Input type="search" aria-label="Search review items" className="min-h-11" placeholder="Item name, brand, category or barcode" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
        <label className="min-w-0 space-y-1 text-sm">Items to show<select aria-label="Items to show" className="h-11 w-full min-w-0 rounded border bg-background px-2" value={filter} onChange={e => changeFilter(e.target.value as Filter)}><option value="incomplete">Missing weight or price</option><option value="weight">Missing weight</option><option value="value">Missing price</option><option value="both">Missing both</option><option value="photo">Missing photo</option><option value="all">All items, including corrections</option></select></label>
      </div>
      <p className="text-sm" role="status">{filtered.length ? `Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length} matching items.` : 'No items match this search and filter. Choose All items to review an existing measurement.'}</p>
      <ul className="divide-y border" aria-label="Inventory measurement review queue">{visible.map(item => <li key={item.id} className="min-w-0 p-3"><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 basis-40"><p className="break-words font-medium">{item.name}</p><p className="break-all text-xs text-muted-foreground">{item.barcode ? `Barcode ${item.barcode}` : 'No barcode saved'}</p><p className="text-sm">{item.missingWeight ? 'Weight missing' : `${formatNumber(Number(item.weightPerUnitLbs), 4)} lb`} · {item.missingValue ? 'Price missing' : `$${Number(item.valuePerUnitUsd).toFixed(2)}`}</p><p className="text-xs text-muted-foreground">{typeof item.quantity === 'number' ? `${item.quantity} in stock${typeof item.reservedQuantity === 'number' ? `; ${item.reservedQuantity} reserved` : ''}` : 'Current stock unavailable'}{item.packageType ? ` · ${item.packageType.replaceAll('_', ' ')}${item.unitCount && item.unitCount > 1 ? ` of ${item.unitCount}` : ''}` : ''}</p></div><Button variant={id === item.id ? 'secondary' : 'outline'} className="min-h-11" disabled={!!pending} aria-label={`Review measurements for ${item.name}`} onClick={() => selectItem(item, false, true)}>Review</Button></div></li>)}</ul>
      {filtered.length > PAGE_SIZE && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous review items</Button><span className="text-sm">Page {currentPage + 1} of {Math.ceil(filtered.length / PAGE_SIZE)}</span><Button variant="outline" className="min-h-11" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next review items</Button></div>}
    </>}
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="border-t pt-3">
      <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Complete item weights, estimated values and photos</summary>
      {open && data && <div className="mt-3 min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">Review the actual package and a dated price source. Fluid ounces measure volume, not weight. Leave unknown measurements unresolved. Enter only the fields you intend to change.</p>
        <label className="block min-w-0 space-y-1 text-sm">Item to complete<select aria-label="Item to complete" className="h-11 w-full min-w-0 rounded border bg-background px-2" value={id} disabled={!!pending} onChange={e => selectItem(data.items.find(item => item.id === e.target.value))}><option value="">Select an item</option>{selected && !latest && <option value={selected.id}>{selected.name} [previously selected]</option>}{data.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {draft && selected && <div className="min-w-0 space-y-3" aria-busy={!!pending}>
          <h3 ref={heading} tabIndex={-1} className="break-words font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Review: {selected.name}</h3>
          {latest && latest.updatedAt !== selected.updatedAt && <div role="status" className="space-y-2 border p-3 text-sm"><p>This item changed since your review began. Your entries have been kept. Review the latest saved values before retrying; this will replace this item’s current draft.</p><Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={!!pending} onClick={() => selectItem(latest, true)}>Review latest saved values</Button></div>}
          {!latest && <p role="status" className="text-sm">This item is no longer in the returned inventory. Your draft is kept; refresh and verify the item before saving.</p>}
          <p className="text-sm">Recorded per inventory unit: {Number(selected.weightPerUnitLbs).toFixed(4)} lbs; ${Number(selected.valuePerUnitUsd).toFixed(2)}. One unit must mean one package, not both a case and an individual item.</p>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 space-y-1 text-sm">Reviewed weight per unit (lbs)<Input aria-label="Reviewed weight per unit" className="min-h-11" type="number" min="0.0001" max="99999" step="0.0001" value={draft.weight} onChange={e => edit({ weight: e.target.value })} disabled={!!pending} aria-invalid={!!draft.weight && !positiveMeasurement(draft.weight, 4, 99999)} /></label>
            <label className="min-w-0 space-y-1 text-sm">Reviewed estimated value per unit ($)<Input aria-label="Reviewed estimated value per unit" className="min-h-11" type="number" min="0.01" max="999999" step="0.01" value={draft.value} onChange={e => edit({ value: e.target.value })} disabled={!!pending} aria-invalid={!!draft.value && !positiveMeasurement(draft.value, 2, 999999)} /></label>
            <label className="min-w-0 space-y-1 text-sm">Weight source / method<Input aria-label="Weight source" className="min-h-11" value={draft.weightSource} onChange={e => edit({ weightSource: e.target.value })} disabled={!!pending} required={!!draft.weight} aria-describedby="measurement-help" placeholder="Package label or scale; date" /></label>
            <label className="min-w-0 space-y-1 text-sm">Value source / method<Input aria-label="Value source" className="min-h-11" value={draft.valueSource} onChange={e => edit({ valueSource: e.target.value })} disabled={!!pending} required={!!draft.value} aria-describedby="measurement-help" placeholder="Retailer, package size, date; estimate method" /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.weightEstimated} onChange={e => edit({ weightEstimated: e.target.checked })} disabled={!!pending} />Weight is estimated, not measured</label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.valueEstimated} onChange={e => edit({ valueEstimated: e.target.checked })} disabled={!!pending} />Value is estimated, not a verified unit cost</label>
          </div>
          <p id="measurement-help" className="text-sm text-muted-foreground">Enter a positive weight with up to four decimal places or a price with up to two. Each entered measurement needs a source of at least eight characters.</p>
          <fieldset className="min-w-0 space-y-3 border p-3" disabled={!!pending}><legend className="px-1 text-sm font-medium">Historical measurements</legend>
            <label className="block space-y-1 text-sm">Correction scope<select aria-label="Correction scope" className="h-11 w-full min-w-0 rounded border bg-background px-2" value={draft.mode} onChange={e => edit({ mode: e.target.value as HistoryMode, samePackage: false, reason: e.target.value === 'replace_incorrect' ? '' : 'Fill missing measurements from this reviewed inventory package.' })}><option value="missing_only">Fill missing past measurements and future inventory</option><option value="replace_incorrect">Replace incorrect past measurements and future inventory</option><option value="future_only">Current item and future transactions</option></select></label>
            {history && <>
              <p className="text-sm">{draft.mode === 'replace_incorrect' ? 'Replacement changes previously recorded measurements in the selected period. Use it only when the new figure corrects those records, not because today’s retail price changed.' : 'Fill only missing historical measurements for each entered field. Existing positive historical values remain as recorded.'} Stock, quantities, dates and linked recipients remain unchanged.</p>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 space-y-1 text-sm">Historical start date<Input aria-label="Historical start date" type="date" className="min-h-11 max-w-full" value={draft.from} onChange={e => edit({ from: e.target.value })} /></label><label className="min-w-0 space-y-1 text-sm">Historical end date<Input aria-label="Historical end date" type="date" className="min-h-11 max-w-full" value={draft.to} onChange={e => edit({ to: e.target.value })} /></label></div>
              <p className="text-xs text-muted-foreground">Dates are inclusive in Baltimore time (America/New_York). Blank dates include all history. Narrow the dates if a preview exceeds 1,000 changed lines.</p>
              {draft.from && draft.to && draft.from > draft.to && <p role="alert" className="text-sm">The historical start date must be on or before the end date.</p>}
              <label className="block space-y-1 text-sm">Correction reason<Input aria-label="Correction reason" className="min-h-11" required minLength={8} value={draft.reason} onChange={e => edit({ reason: e.target.value })} aria-describedby="history-review-help" placeholder="Explain what was missing or incorrect" /></label>
              <Button variant="outline" className="min-h-11 h-auto whitespace-normal" onClick={preview} disabled={!!pending || !measurementValid || !historyValid}>{pending === 'preview' ? 'Checking affected history…' : 'Preview historical corrections'}</Button>
              {draft.preview && <div className="space-y-2 border p-3 text-sm" data-testid="measurement-history-preview" role="status"><p className="font-medium">{draft.preview.counts.rows} historical lines across {draft.preview.counts.transactions} transactions would change.</p><p>Weight: {draft.preview.counts.weightRows} lines. Price: {draft.preview.counts.valueRows} lines.</p><p>Selected history weight: {formatNumber(draft.preview.totals.beforeWeightLbs, 4)} → {formatNumber(draft.preview.totals.afterWeightLbs, 4)} lb. Selected history value: ${Number(draft.preview.totals.beforeValueUsd).toFixed(2)} → ${Number(draft.preview.totals.afterValueUsd).toFixed(2)}.</p><p>Period: {draft.from || 'all earlier history'} through {draft.to || 'all later history'} (Baltimore time).</p>{!draft.preview.canApply && <p>Too many historical lines to apply together. Narrow the dates and preview again.</p>}</div>}
              <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.samePackage} onChange={e => edit({ samePackage: e.target.checked }, true)} />I verified that these historical entries use this same package and measurement basis.</label>
              {draft.mode === 'replace_incorrect' && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={draft.replaceConfirmed} disabled={!draft.preview?.canApply} onChange={e => edit({ replaceConfirmed: e.target.checked }, true)} />I reviewed the preview and confirm replacing the incorrect historical measurements.</label>}
              <p id="history-review-help" className="text-xs text-muted-foreground">A reason of at least eight characters, a current preview and the package confirmation are required before saving. Editing the figures, source, dates or reason requires a new preview.</p>
            </>}
          </fieldset>
          {!canSave && <p id="measurement-save-help" className="text-sm" role="status">{!measurementValid ? 'Enter a positive weight or price and a source of at least eight characters for each entered number.' : !historyValid ? 'Check the correction reason and date range.' : !draft.preview?.canApply ? 'Preview the historical corrections before saving, or choose Future inventory only.' : !draft.samePackage ? 'Confirm that the historical entries use the same package.' : 'Confirm the replacement of historical measurements.'}</p>}
          <Button aria-describedby="measurement-save-help" className="min-h-11 h-auto whitespace-normal" onClick={save} disabled={!!pending || !canSave}>{pending === 'save' ? 'Saving…' : 'Save reviewed measurements'}</Button>
          {selected.measurementHistory?.length ? <div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">Recent measurement corrections</h4><ul className="space-y-2 text-sm">{selected.measurementHistory.slice(-5).reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><p>{new Date(entry.at).toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern · {entry.history?.mode === 'replace_incorrect' ? 'Historical replacement' : entry.history?.mode === 'missing_only' ? 'Missing history filled' : 'Inventory measurement update'}</p>{entry.reason && <p className="break-words">{entry.reason}</p>}{entry.history?.counts && <p>{entry.history.counts.rows} historical lines across {entry.history.counts.transactions} transactions.</p>}</li>)}</ul></div> : null}
          <ProductPhotoEditor key={selected.id} item={selected} disabled={!!pending} onBusyChange={busy => setPending(busy ? 'photo' : null)} onSaved={updatedAt => {
            // The upload compares the draft version on the server. Only our own
            // successful photo write can advance it without discarding edits.
            setDrafts(current => ({ ...current, [id]: { ...current[id], item: { ...current[id].item, updatedAt }, preview: undefined, replaceConfirmed: false } }));
            const refreshed = qc.getQueryData<Audit>(['/api/inventory/quality'])?.items;
            if (refreshed && !draft.weight && !draft.value) {
              const nextId = nextReviewId(items, refreshed, id, filter, search);
              if (nextId !== id) selectItem(refreshed.find(item => item.id === nextId), false, true);
            }
            setMessage('Photo saved. Your measurement entries are kept.');
          }} />
        </div>}
      </div>}
    </details>
    {message && <p role={messageIsError ? 'alert' : 'status'} className="text-sm">{message}</p>}
  </section>;
}
