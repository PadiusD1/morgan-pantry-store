-- FRC event attribution, additive and safe for existing historical transactions.
-- Apply through the established reviewed migration process, not on app startup.
CREATE TABLE IF NOT EXISTS frc_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 description text,
 starts_at timestamptz,
 ends_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT frc_events_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS event_id uuid;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_event_id_fkey') THEN
  ALTER TABLE transactions ADD CONSTRAINT transactions_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES frc_events(id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS transactions_event_id_timestamp_idx ON transactions (event_id, timestamp);
CREATE INDEX IF NOT EXISTS frc_events_status_starts_at_idx ON frc_events (status, starts_at);
-- Existing rows retain NULL event_id; do not backfill without primary evidence.
