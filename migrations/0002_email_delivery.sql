-- Optional Resend delivery ledger. Apply through the authorized database migration
-- route before enabling FRC_EMAIL_ENABLED; application code never runs DDL itself.
-- Additive only: no changes to stock, donor identities or historical transactions.
CREATE TABLE IF NOT EXISTS frc_email_delivery (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','uncertain','held')),
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS frc_email_delivery_status_idx ON frc_email_delivery(status, last_attempt_at);
ALTER TABLE frc_email_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON frc_email_delivery FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON frc_email_delivery FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON frc_email_delivery FROM authenticated'; END IF;
END $$;
