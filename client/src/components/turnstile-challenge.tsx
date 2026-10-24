import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
type Widget = { render: (node: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Widget } }
let scriptPromise: Promise<Widget> | null = null;
function loadWidget(): Promise<Widget> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Widget>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error('Security check timed out. Retry.')); }, 15000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = () => { clearTimeout(timeout); window.turnstile ? resolve(window.turnstile) : reject(new Error('Security check unavailable.')); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Security check blocked or unavailable.')); };
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}
/** undefined blocks submission, empty string means the server explicitly disabled the widget. */
export function TurnstileChallenge({ action, reset, onToken }: { action: 'login' | 'signup'; reset: number; onToken: (value: string | undefined) => void }) {
  const { data, isError, refetch } = useQuery<{ required: boolean; ready: boolean; siteKey: string }>({ queryKey: ['/api/auth/security-config'], staleTime: 0, retry: 1 });
  const target = useRef<HTMLDivElement>(null); const [message, setMessage] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    onToken(undefined); setMessage('');
    if (!data) return;
    if (!data.required) { onToken(''); return; }
    if (!data.ready) { setMessage('The security check is not fully configured. Contact FRC staff.'); return; }
    let stopped = false; let widget: Widget | undefined; let id: string | undefined;
    void loadWidget().then(api => {
      if (stopped || !target.current) return;
      widget = api;
      id = api.render(target.current, { sitekey: data.siteKey, action, size: 'flexible', callback: (token: string) => { if (!stopped) { onToken(token); setMessage(''); } }, 'expired-callback': () => { if (!stopped) onToken(undefined); }, 'error-callback': () => { if (!stopped) { onToken(undefined); setMessage('Security check failed. Retry.'); } } });
    }).catch(error => { if (!stopped) setMessage(error.message); });
    return () => { stopped = true; if (widget && id) widget.remove(id); };
  }, [data?.required, data?.ready, data?.siteKey, action, reset, retry, onToken]);
  if (data && !data.required) return null;
  return <div className="space-y-2 text-sm" aria-label="Security verification">
    <div ref={target} />
    {!data && !isError && <p role="status">Loading security check…</p>}
    {(message || isError) && <><p role="alert">{message || 'Could not load the security configuration.'}</p><Button type="button" variant="outline" onClick={() => { void refetch(); setRetry(v => v + 1); }}>Retry security check</Button></>}
  </div>;
}
