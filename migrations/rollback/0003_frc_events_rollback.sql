-- Rollback for 0003_frc_events.sql. Never applied by any script or test stack.
-- Run by hand only with the owner's approval, and only while no transaction
-- names an event. Once an event is recorded, keep the schema and roll back the
-- application alone. The older release ignores these tables and the column,
-- so that is safe, and dropping them would erase recorded attribution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
	named boolean := false;
BEGIN
	-- The row check runs only while the column exists, and it is dynamic so it is
	-- parsed only then. A second run after a finished rollback passes as a no op.
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'event_id') THEN
		EXECUTE 'SELECT EXISTS (SELECT 1 FROM "transactions" WHERE "event_id" IS NOT NULL)' INTO named;
	END IF;
	IF named THEN
		RAISE EXCEPTION 'Transactions already name an event. Keep the schema and roll back the application only.';
	END IF;
END
$$;

DROP TABLE IF EXISTS "frc_event_sessions";
DROP TABLE IF EXISTS "frc_event_audit";
DROP INDEX IF EXISTS "idx_transactions_event_id_timestamp";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_event_id_frc_events_id_fk";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "event_id";
DROP TABLE IF EXISTS "frc_events";

COMMIT;
