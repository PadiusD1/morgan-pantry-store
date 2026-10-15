import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, apiErrorMessage } from '@/lib/auth';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
type Status = { turnstile: { required: boolean; configured: boolean }; posthog: { configured: boolean; mode: string }; resend: { configured: boolean; ledgerReady: boolean; counts: { status: string; count: number }[] }; distributedRateLimitConfigured: boolean; cloudflareWaf: string; databaseTlsVerification: boolean };
export function IntegrationStatus() {
  const { user } = useAuth(); const [open, setOpen] = useState(false); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const keys = useRef({ resend: crypto.randomUUID(), posthog: crypto.randomUUID() });
  const { data, isError, refetch } = useQuery<Status>({ queryKey: ['/api/integrations/status'], enabled: open && user?.role === 'admin', staleTime: 0 });
  if (user?.role !== 'admin') return null;
  async function test(service: 'resend' | 'posthog' | 'retry') {
    if (pending) return; setPending(true); setMessage('');
    try {
      const response = service === 'retry' ? await apiRequest('POST', '/api/integrations/email/retry') : await apiRequest('POST', '/api/integrations/test', { service, key: keys.current[service] });
      const result = await response.json(); setMessage(JSON.stringify(result)); await refetch();
    } catch (error) { setMessage(apiErrorMessage(error, 'The integration check failed.')); }
    finally { setPending(false); }
  }
  return <details className="border rounded p-4" data-testid="integration-status" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Production integrations and delivery status</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>Configuration is not proof of a working external account, inbox delivery, DNS/WAF protection or complete security review. Secrets remain in the hosting environment, never in this form.</p>
      <Button variant="outline" onClick={() => refetch()} disabled={pending}>Refresh integration status</Button>
      {isError && <p role="alert">Status could not be verified. Retry; no success is assumed.</p>}
      {data && <>
        <p>Cloudflare Turnstile: {data.turnstile.configured ? 'configured; verify a real login' : data.turnstile.required ? 'incomplete; authentication fails closed' : 'not configured'}.</p>
        <p>Cloudflare DNS/WAF: {data.cloudflareWaf}</p>
        <p>PostHog: {data.posthog.configured ? 'configured' : 'not configured or disabled'}. {data.posthog.mode}</p>
        <p>Resend: {data.resend.configured ? 'configured' : 'not configured or disabled'}. Delivery ledger: {data.resend.ledgerReady ? 'present' : 'migration 0002 required before automated email'}.</p>
        <p>Email state: {data.resend.counts.map(row => `${row.status}: ${row.count}`).join('; ') || 'No tracked attempts'}. Accepted means provider accepted, not confirmed inbox delivery. Uncertain attempts are retried with the same key; old uncertain attempts are held for provider reconciliation.</p>
        <p>Distributed login/signup limiter: {data.distributedRateLimitConfigured ? 'credentials configured; live enforcement still needs verification' : 'not configured; only per-instance fallback'}.</p>
        <p>Database certificate verification: {data.databaseTlsVerification ? 'enabled; verify provider CA' : 'not enabled; separately validate the provider CA before changing'}.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !data.posthog.configured} onClick={() => test('posthog')}>Send anonymous analytics test</Button>
          <Button disabled={pending || !data.resend.configured} onClick={() => test('resend')}>Send test email to my account</Button>
          <Button variant="outline" disabled={pending || !data.resend.configured || !data.resend.ledgerReady} onClick={() => test('retry')}>Retry up to 3 queued emails</Button>
        </div>
        <p>These buttons contact the configured providers. They do not create accounts, purchase plans or send test messages to students.</p>
      </>}
      {message && <p role="status" className="break-words">{message}</p>}
    </div>
  </details>;
}
