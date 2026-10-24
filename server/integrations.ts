import type { Express } from 'express';
import { requireRole } from './auth';
import { integrationConfig, captureOperationalEvent } from './integration-config';
import { emailLedgerReady, deliverNotification, sendResend } from './email-delivery';
import { pool } from './pg';
import { z } from 'zod';
export function registerIntegrationRoutes(app: Express) {
  app.get('/api/integrations/status', requireRole('admin'), async (_req, res) => {
    const c = integrationConfig(); const ledger = await emailLedgerReady();
    const emailCounts = ledger ? (await pool.query('SELECT status,count(*)::integer AS count FROM frc_email_delivery GROUP BY status')).rows : [];
    res.json({ turnstile: { required: c.turnstile.required, configured: c.turnstile.ready }, posthog: { configured: c.posthog.ready, mode: 'Anonymous server events only; no replay or form capture.' }, resend: { configured: c.resend.ready, ledgerReady: ledger, counts: emailCounts }, distributedRateLimitConfigured: c.distributedRateLimitConfigured, cloudflareWaf: 'Not verified by this application. Turnstile does not establish DNS/WAF protection.', databaseTlsVerification: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true', configurationIsNotLiveVerification: true });
  });
  app.post('/api/integrations/test', requireRole('admin'), async (req, res) => {
    const body = z.object({ service: z.enum(['posthog','resend']), key: z.string().uuid() }).strict().safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: 'Select a service and a unique test key.' });
    if (body.data.service === 'posthog') return res.json({ status: await captureOperationalEvent('integration_test') });
    if (!integrationConfig().resend.ready) return res.status(409).json({ message: 'Resend is not fully configured.' });
    // Explicit admin test only, to the signed-in account; never an arbitrary address.
    const id = await sendResend({ from: process.env.RESEND_FROM_EMAIL, to: [req.user!.email], subject: 'FRC integration test', text: 'This is the FRC transactional email connection test requested by your signed-in administrator. This does not prove inbox delivery or notification automation.' }, `frc-test/${req.user!.id}/${body.data.key}`);
    res.json({ status: id ? 'accepted_by_provider' : 'uncertain', message: 'Provider acceptance is not inbox delivery. Reuse this test key on retry.' });
  });
  app.post('/api/integrations/email/retry', requireRole('admin'), async (_req, res) => {
    if (!integrationConfig().resend.ready || !(await emailLedgerReady())) return res.status(409).json({ message: 'Enable the email configuration and apply migration 0002 first.' });
    const pending = (await pool.query("SELECT notification_id FROM frc_email_delivery WHERE status IN ('pending','uncertain','sending') AND (last_attempt_at IS NULL OR last_attempt_at < now()-interval '45 seconds') ORDER BY created_at LIMIT 3")).rows;
    const status = [];
    for (const row of pending) status.push(await deliverNotification(row.notification_id));
    res.json({ processed: status.length, status });
  });
}
