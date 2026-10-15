import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiRequest, saveErrorMessage } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductPhotoEditor } from './product-photo-editor';

type Row = { id: string; name: string; updatedAt: string; weightPerUnitLbs: string; valuePerUnitUsd: string; missingWeight: boolean; missingValue: boolean; imageUrl: string | null; weightLbs: number | null; weightSource: string | null; valueUsd: number | null; valueSource: string | null };
type Audit = { total: number; missingWeight: number; missingValue: number; missingPhoto: number; items: Row[] };
export function InventoryQuality() {
  const { user } = useAuth(); const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // The version being reviewed is a snapshot, not a live query row. A refetch
  // must not erase entries/feedback or silently advance optimistic concurrency.
  const [selected, setSelected] = useState<Row | undefined>();
  const id = selected?.id ?? '';
  const { data, isPending, isError, refetch } = useQuery<Audit>({ queryKey: ['/api/inventory/quality'], enabled: open && (user?.role === 'admin' || user?.role === 'staff'), staleTime: 0 });
  const [weight, setWeight] = useState(''); const [value, setValue] = useState('');
  const [weightSource, setWeightSource] = useState(''); const [valueSource, setValueSource] = useState('');
  const [weightEstimated, setWeightEstimated] = useState(false); const [valueEstimated, setValueEstimated] = useState(true);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const latest = data?.items.find(item => item.id === id);
  function selectItem(row: Row | undefined) {
    setSelected(row);
    setWeight(row?.missingWeight && row.weightLbs ? String(row.weightLbs) : '');
    setValue(row?.missingValue && row.valueUsd ? String(row.valueUsd) : '');
    setWeightSource(row?.weightSource ?? ''); setValueSource(row?.valueSource ?? '');
    setWeightEstimated(false); setValueEstimated(true); setMessage('');
  }
  if (user?.role !== 'admin' && user?.role !== 'staff') return null;
  async function save() {
    if (!selected || pending) return;
    setPending(true); setMessage('');
    try {
      await apiRequest('PATCH', `/api/inventory/${selected.id}/measurements`, { expectedUpdatedAt: selected.updatedAt,
        ...(weight ? { weightPerUnitLbs: Number(weight), weightSource, weightIsEstimated: weightEstimated } : {}),
        ...(value ? { valuePerUnitUsd: Number(value), valueSource, costIsEstimated: valueEstimated } : {}),
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ['/api/inventory'] }), qc.invalidateQueries({ queryKey: ['/api/inventory/quality'] })]);
      // Refreshes no longer schedule an Effect that can erase this success.
      // A now-complete item is allowed to leave the review queue.
      selectItem(qc.getQueryData<Audit>(['/api/inventory/quality'])?.items.find(item => item.id === id));
      setMessage('Saved. Current stock and historical transaction measurements were not changed.');
    } catch (error) { setMessage(saveErrorMessage(error, 'Could not save measurements. Your entries are kept.')); }
    finally { setPending(false); }
  }
  return <details className="rounded border p-4" onToggle={e => setOpen(e.currentTarget.open)} data-testid="inventory-quality">
    <summary className="cursor-pointer font-medium">Complete item weights, estimated values and photos</summary>
    {open && <div className="mt-3 space-y-4">
      {isPending && <p role="status">Checking saved inventory…</p>}
      {isError && <p role="alert">The quality check could not load. No completeness total is available.</p>}
      <Button variant="outline" disabled={pending} onClick={() => refetch()}>Refresh completeness check</Button>
      {data && <>
        <p>{data.total} items. {data.missingWeight} missing positive weight; {data.missingValue} missing positive estimated value; {data.missingPhoto} without an available photo source.</p>
        <p className="text-sm text-muted-foreground">Review the actual package and a dated price source before saving. Package-name suggestions are not automatic corrections. Fluid ounces are volume, not weight. Leave unavailable measurements unresolved rather than inventing zeroes. Photos may still be unavailable at the source.</p>
        <label className="block space-y-1 text-sm">Item to complete
          <select aria-label="Item to complete" className="h-11 w-full rounded border bg-background px-3" value={id} disabled={pending} onChange={e => selectItem(data.items.find(item => item.id === e.target.value))}>
            <option value="">Select an item</option>
            {selected && !latest && <option value={selected.id}>{selected.name} [previously selected; refresh to review status]</option>}
            {data.items.map(item => <option key={item.id} value={item.id}>{item.name} [{[item.missingWeight && 'weight', item.missingValue && 'value', !item.imageUrl && 'photo'].filter(Boolean).join(', ')}]</option>)}
          </select>
        </label>
        {selected && <div className="space-y-3">
          {latest && latest.updatedAt !== selected.updatedAt && <div role="status" className="space-y-2 rounded border p-3 text-sm">
            <p>This item changed since your review began. Your entries have been kept. Review the latest saved values before retrying; this will replace the current draft.</p>
            <Button variant="outline" disabled={pending} onClick={() => selectItem(latest)}>Review latest saved values</Button>
          </div>}
          {selected && !latest && <p className="text-sm">This item is no longer in the completeness queue. Your draft is kept; refresh and verify the item before saving.</p>}
          <p className="text-sm">Recorded per inventory unit: {Number(selected.weightPerUnitLbs).toFixed(4)} lbs; ${Number(selected.valuePerUnitUsd).toFixed(2)}. One unit must mean one package, not both a case and an individual item.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm space-y-1">Reviewed weight per unit (lbs)<Input aria-label="Reviewed weight per unit" type="number" min="0.0001" step="0.0001" value={weight} onChange={e => setWeight(e.target.value)} disabled={pending} /></label>
            <label className="text-sm space-y-1">Reviewed estimated value per unit ($)<Input aria-label="Reviewed estimated value per unit" type="number" min="0.01" step="0.01" value={value} onChange={e => setValue(e.target.value)} disabled={pending} /></label>
            <label className="text-sm space-y-1">Weight source / method<Input aria-label="Weight source" value={weightSource} onChange={e => setWeightSource(e.target.value)} disabled={pending} placeholder="Package label or scale; date" /></label>
            <label className="text-sm space-y-1">Value source / method<Input aria-label="Value source" value={valueSource} onChange={e => setValueSource(e.target.value)} disabled={pending} placeholder="Retailer, package size, date; estimate method" /></label>
            <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={weightEstimated} onChange={e => setWeightEstimated(e.target.checked)} disabled={pending} />Weight is estimated, not measured</label>
            <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={valueEstimated} onChange={e => setValueEstimated(e.target.checked)} disabled={pending} />Value is estimated, not a verified unit cost</label>
          </div>
          <Button onClick={save} disabled={pending || (!weight && !value) || (!!weight && weightSource.trim().length < 8) || (!!value && valueSource.trim().length < 8)}>{pending ? 'Saving…' : 'Save reviewed measurements'}</Button>
          <ProductPhotoEditor key={selected.id} item={selected} />
        </div>}
      </>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>}
  </details>;
}
