import { describe, it, expect, vi } from 'vitest';
import { integrationConfig, verifyTurnstile, captureOperationalEvent } from '../server/integration-config';
const turnstileEnv = { TURNSTILE_SITE_KEY:'synthetic-site', TURNSTILE_SECRET_KEY:'synthetic-secret', TURNSTILE_ALLOWED_HOSTNAMES:'morgan-frc.example.test' };
describe('Cloudflare server enforcement', () => {
  it('does not call a provider while unconfigured', async () => { const request=vi.fn(); expect(await verifyTurnstile(undefined,'login',{},request)).toBe(true); expect(request).not.toHaveBeenCalled(); });
  it('fails closed on partial configuration or a missing token', async () => { expect(await verifyTurnstile('x','login',{TURNSTILE_SITE_KEY:'x'})).toBe(false); expect(await verifyTurnstile(undefined,'login',turnstileEnv)).toBe(false); });
  it.each([{success:false,hostname:'morgan-frc.example.test',action:'login'},{success:true,hostname:'attacker.test',action:'login'},{success:true,hostname:'morgan-frc.example.test',action:'signup'}])('refuses invalid verdict/action/hostname', async verdict => expect(await verifyTurnstile('token','login',turnstileEnv,vi.fn().mockResolvedValue(new Response(JSON.stringify(verdict))))).toBe(false));
  it('accepts only the matching validated hostname and action', async () => expect(await verifyTurnstile('token','login',turnstileEnv,vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,hostname:'morgan-frc.example.test',action:'login'}))))).toBe(true));
  it('refuses network failures without exposing credentials', async () => expect(await verifyTurnstile('token','login',turnstileEnv,vi.fn().mockRejectedValue(new Error('network')))).toBe(false));
});
describe('privacy preserving optional analytics', () => {
  const env={ FRC_ANALYTICS_ENABLED:'true',POSTHOG_PROJECT_TOKEN:'synthetic-token' };
  it('requires explicit opt-in and a trusted regional host', async () => { const request=vi.fn(); expect(await captureOperationalEvent('integration_test',{},request)).toBe('disabled'); expect(await captureOperationalEvent('integration_test',{...env,POSTHOG_HOST:'https://evil.test'},request)).toBe('disabled'); expect(request).not.toHaveBeenCalled(); });
  it('sends no identities, replay, form text or client IP', async () => {
    const request=vi.fn().mockResolvedValue(new Response('{"status":1}'));
    expect(await captureOperationalEvent('food_request_submitted',env,request)).toBe('accepted');
    const body=JSON.parse(request.mock.calls[0][1].body);
    expect(Object.keys(body.properties).sort()).toEqual(['$geoip_disable','$process_person_profile','application','distinct_id','synthetic'].sort());
    expect(body.properties).toMatchObject({'$process_person_profile':false,'$geoip_disable':true});
  });
  it('does not mistake a 200 quota-limit response for success', async () => expect(await captureOperationalEvent('integration_test',env,vi.fn().mockResolvedValue(new Response('{"quota_limited":["events"]}')))).toBe('failed'));
  it('requires the public HTTPS origin for email to be configured', () => expect(integrationConfig({RESEND_API_KEY:'test',RESEND_FROM_EMAIL:'test@example.test',FRC_EMAIL_ENABLED:'true',FRC_PUBLIC_URL:'http://insecure.test'}).resend.ready).toBe(false));
});
