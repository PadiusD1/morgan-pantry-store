/** Environment values are server-only except the intentionally public Turnstile site key. */
export function integrationConfig(env: NodeJS.ProcessEnv = process.env) {
  const anyTurnstile = !!(env.TURNSTILE_SITE_KEY || env.TURNSTILE_SECRET_KEY || env.TURNSTILE_ALLOWED_HOSTNAMES);
  const hostnames = (env.TURNSTILE_ALLOWED_HOSTNAMES ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  const posthogHost = env.POSTHOG_HOST ?? 'https://us.i.posthog.com';
  let publicOrigin: string | null = null;
  try { const u = new URL(env.FRC_PUBLIC_URL ?? ''); if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash) publicOrigin = u.origin; } catch { /* unconfigured */ }
  return {
    turnstile: { required: anyTurnstile, ready: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && hostnames.length && hostnames.every(h => /^[a-z0-9.-]+$/.test(h) && !['localhost', '127.0.0.1'].includes(h))), siteKey: env.TURNSTILE_SITE_KEY ?? '', hostnames },
    posthog: { ready: env.FRC_ANALYTICS_ENABLED === 'true' && !!env.POSTHOG_PROJECT_TOKEN && ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(posthogHost), host: posthogHost },
    resend: { ready: env.FRC_EMAIL_ENABLED === 'true' && !!env.RESEND_API_KEY && !!env.RESEND_FROM_EMAIL && !!publicOrigin, publicOrigin },
    distributedRateLimitConfigured: !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
  };
}

export async function verifyTurnstile(token: unknown, action: 'login' | 'signup', env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): Promise<boolean> {
  const config = integrationConfig(env).turnstile;
  if (!config.required) return true;
  if (!config.ready || typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }), signal: AbortSignal.timeout(5000) });
    const value = await response.json() as { success?: boolean; hostname?: string; action?: string };
    return response.ok && value.success === true && value.action === action && config.hostnames.includes((value.hostname ?? '').toLowerCase());
  } catch { return false; }
}

export type FrcEvent = 'food_request_submitted' | 'food_request_updated' | 'integration_test';
/** No user identity, request IDs, URLs, text fields, IP addresses or recorded sessions. */
export async function captureOperationalEvent(event: FrcEvent, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): Promise<'disabled' | 'accepted' | 'failed'> {
  const config = integrationConfig(env).posthog;
  if (!config.ready) return 'disabled';
  try {
    const response = await request(`${config.host}/i/v0/e`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: env.POSTHOG_PROJECT_TOKEN, event, properties: { distinct_id: crypto.randomUUID(), '$process_person_profile': false, '$geoip_disable': true, application: 'morgan-frc', synthetic: event === 'integration_test' } }), signal: AbortSignal.timeout(2000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || (body.quota_limited && Object.keys(body.quota_limited).length > 0)) return 'failed';
    return 'accepted';
  } catch { return 'failed'; }
}
