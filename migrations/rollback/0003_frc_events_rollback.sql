-- Rollback for 0003_frc_events.sql. Never applied by any script or test stack.
-- Run by hand only with the owner's approval, and only while no transaction
-- names an event. Once an event is recorded, keep the schema and roll back the
-- application alone. The older release ignores these tables and the column,
-- so that is safe, and dropping them would erase recorded attribution.
--
-- Nothing written after the approved export can be deleted unseen. Every table
-- this script reads or drops is write locked before anything is checked, and the
-- three event tables are dropped only while they are empty or while they hold
-- exactly the content whose digest 0003_frc_events_rollback_digest.sql returned
-- for the export the owner approved, set in the same session with
--   SET frc.rollback_approved_digest = '<digest>';
-- Any other content stops the rollback, so export again and ask again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- The digest reads the same text whatever the caller's session settings are.
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 1;

DO $$
DECLARE
	rel text;
	part text;
	parts text[] := ARRAY[]::text[];
	actual text;
	expected text := nullif(current_setting('frc.rollback_approved_digest', true), '');
	named boolean := false;
BEGIN
	-- Locks first, held to COMMIT, so no checkout and no event change can land
	-- between the checks below and the drops after them.
	FOREACH rel IN ARRAY ARRAY['transactions', 'frc_events', 'frc_event_sessions', 'frc_event_audit'] LOOP
		IF to_regclass('public.' || rel) IS NOT NULL THEN
			EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', rel);
		END IF;
	END LOOP;

	-- The row check runs only while the column exists, and it is dynamic so it is
	-- parsed only then. A second run after a finished rollback passes as a no op.
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'event_id') THEN
		EXECUTE 'SELECT EXISTS (SELECT 1 FROM "transactions" WHERE "event_id" IS NOT NULL)' INTO named;
	END IF;
	IF named THEN
		RAISE EXCEPTION 'Transactions already name an event. Keep the schema and roll back the application only.';
	END IF;

	-- The same content, in the same order, as the digest file returns.
	FOREACH rel IN ARRAY ARRAY['frc_events', 'frc_event_sessions', 'frc_event_audit'] LOOP
		part := '[]';
		IF to_regclass('public.' || rel) IS NOT NULL THEN
			EXECUTE format('SELECT coalesce(json_agg(t ORDER BY t.%I)::text, ''[]'') FROM public.%I t',
				CASE rel WHEN 'frc_event_sessions' THEN 'session_key' ELSE 'id' END, rel) INTO part;
		END IF;
		parts := parts || part;
	END LOOP;
	actual := md5(array_to_string(parts, '|'));
	IF actual <> md5('[]|[]|[]') AND actual IS DISTINCT FROM expected THEN
		RAISE EXCEPTION 'The event tables hold content that is not the approved export, digest %. Export them again and ask for approval of that exact content.', actual;
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
