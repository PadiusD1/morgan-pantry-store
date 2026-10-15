import { pool } from './pg';
import { integrationConfig } from './integration-config';
export async function emailLedgerReady(): Promise<boolean> {
  return !!(await pool.query("SELECT to_regclass('public.frc_email_delivery') AS present")).rows[0]?.present;
}
/** Returns provider acceptance, not delivery to a person's inbox. */
export async function sendResend(payload: unknown, key: string, request: typeof fetch = fetch): Promise<string | null> {
  try {
    const result = await request('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(4000) });
    const body = await result.json() as { id?: unknown };
    return result.ok && typeof body.id === 'string' ? body.id : null;
  } catch { return null; }
}
/** Notification ID is the durable deduplication key; retries reuse exactly the stored payload. */
export async function deliverNotification(id: string): Promise<string> {
  if (!integrationConfig().resend.ready || !(await emailLedgerReady())) return 'not_configured';
  const { rows } = await pool.query(`UPDATE frc_email_delivery SET status='sending', attempts=attempts+1, first_attempt_at=COALESCE(first_attempt_at,now()), last_attempt_at=now(), updated_at=now()
    WHERE notification_id=$1 AND status IN ('pending','uncertain','sending')
      AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '45 seconds')
      AND (first_attempt_at IS NULL OR first_attempt_at > now() - interval '23 hours') RETURNING payload`, [id]);
  if (!rows.length) {
    // A response may have been lost. Once provider deduplication is about to
    // expire, hold for provider reconciliation instead of risking a second mail.
    await pool.query("UPDATE frc_email_delivery SET status='held',updated_at=now() WHERE notification_id=$1 AND status IN ('uncertain','sending','pending') AND first_attempt_at <= now()-interval '23 hours'", [id]);
    return 'already_claimed_or_held';
  }
  const providerId = await sendResend(rows[0].payload, `frc-notification/${id}`);
  await pool.query("UPDATE frc_email_delivery SET status=$2,provider_id=$3,updated_at=now() WHERE notification_id=$1", [id, providerId ? 'accepted' : 'uncertain', providerId]);
  return providerId ? 'accepted' : 'uncertain';
}
/** Only account-linked requests are emailed. A typed contact address is not a mailing target. */
export async function notifyRequestUpdate(requestId: string): Promise<void> {
  const config = integrationConfig().resend;
  if (!config.ready) return;
  try {
    if (!(await emailLedgerReady())) return;
    const { rows } = await pool.query(`SELECT n.id,n.request_id,u.email FROM notifications n JOIN requests r ON r.id=n.request_id JOIN users u ON u.id=r.user_id
      WHERE n.request_id=$1 AND n.recipient_type='client' ORDER BY n.created_at DESC,n.id DESC LIMIT 1`, [requestId]);
    const row = rows[0]; if (!row) return;
    const payload = { from: process.env.RESEND_FROM_EMAIL, to: [row.email], subject: 'Morgan State Food Resource Center: request update', text: `There is an update to your Food Resource Center request. Sign in to view the current status and pickup details.\n\n${config.publicOrigin}/portal\n\nThis is a service notification, not a marketing message. Do not reply with sensitive information.` };
    await pool.query('INSERT INTO frc_email_delivery(notification_id,request_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(notification_id) DO NOTHING', [row.id, row.request_id, JSON.stringify(payload)]);
    await deliverNotification(row.id);
  } catch { console.warn('[email] Delivery unavailable; saved request remains valid. Review the integration status.'); }
}
