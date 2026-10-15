import React, { useRef, useState } from 'react';
import { useRepository } from '@/lib/repository';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { cacheSavedDonor } from '@/lib/donor-cache';
import { confirmedDonor } from '@/lib/donor-save';
import { useAuth, apiErrorMessage } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { unregisteredDonors } from '@shared/unregistered-donors';
export function UnregisteredDonors({ donors }: { donors: { name: string }[] }) {
  const { transactions } = useRepository(); const { user } = useAuth();
  const [selected, setSelected] = useState(''); const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const key = useRef(crypto.randomUUID());
  const rows = unregisteredDonors(transactions, donors);
  if (user?.role !== 'staff' && user?.role !== 'admin') return null;
  async function save() {
    if (!selected || pending) return;
    setPending(true);
    try { const response = await apiRequest("POST", "/api/donors", { name: selected, status: "active" }, { idempotencyKey: key.current }); const saved = confirmedDonor(await response.json()); await cacheSavedDonor(queryClient, saved); setMessage(`${saved.name} is on the donor directory. Historical rows remain name-matched until their attribution is reviewed.`); key.current = crypto.randomUUID(); setSelected(''); }
    catch (error) { setMessage(apiErrorMessage(error, 'Could not register this name. Review it and retry.')); }
    finally { setPending(false); }
  }
  return <details className="rounded border p-4" data-testid="unregistered-donors">
    <summary className="font-medium cursor-pointer">Review names from earlier check-ins ({rows.length})</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>These unlinked donation names are in receiving history but not in the donor directory. Review who each name represents before registering it. Partner-linked rows and anonymous entries are excluded. No historical donation or stock is replayed.</p>
      <select aria-label="Unregistered donor name" className="h-11 w-full rounded border bg-background px-3" value={selected} disabled={pending} onChange={e => { setSelected(e.target.value); key.current = crypto.randomUUID(); }}>
        <option value="">Choose a reviewed donor name</option>
        {rows.map(row => <option key={row.name} value={row.name}>{row.name} ({row.entries} earlier entries)</option>)}
      </select>
      <Button onClick={save} disabled={!selected || pending}>{pending ? 'Registering…' : 'Register reviewed name as donor'}</Button>
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
