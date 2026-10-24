-- FRC events. Hand written, one transaction, safe to run twice.
-- Additive only. Every existing transaction keeps a NULL event_id and is never
-- backfilled, because no primary record says which event it belonged to.
-- Apply through the authorized database migration route before the release
-- that reads these tables. Application code never runs DDL itself, and it
-- keeps recording checkouts without an event while these tables are absent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS "frc_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "frc_events_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 200),
	CONSTRAINT "frc_events_description_length" CHECK ("description" IS NULL OR char_length("description") <= 2000),
	CONSTRAINT "frc_events_status" CHECK ("status" IN ('active', 'closed')),
	CONSTRAINT "frc_events_window" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at"),
	CONSTRAINT "frc_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_frc_events_status_starts_at" ON "frc_events" USING btree ("status", "starts_at");

-- A nullable column with no default is a catalog change, not a table rewrite.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "event_id" uuid;

-- NOT VALID first, so adding the key never scans under the stronger lock.
-- Every existing value is NULL, so the validation that follows is immediate.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_event_id_frc_events_id_fk') THEN
		ALTER TABLE "transactions" ADD CONSTRAINT "transactions_event_id_frc_events_id_fk"
			FOREIGN KEY ("event_id") REFERENCES "public"."frc_events"("id") ON DELETE RESTRICT NOT VALID;
	END IF;
END
$$;
ALTER TABLE "transactions" VALIDATE CONSTRAINT "transactions_event_id_frc_events_id_fk";

-- Partial, so the many historical rows without an event are not indexed.
CREATE INDEX IF NOT EXISTS "idx_transactions_event_id_timestamp" ON "transactions" USING btree ("event_id", "timestamp") WHERE "event_id" IS NOT NULL;

-- The event a signed in staff session is working. The key is a SHA-256 of the
-- session cookie, never the cookie itself, so a database read cannot sign in.
CREATE TABLE IF NOT EXISTS "frc_event_sessions" (
	"session_key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"tag_inbound" boolean DEFAULT false NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "frc_event_sessions_key_format" CHECK ("session_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "frc_event_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE,
	CONSTRAINT "frc_event_sessions_event_id_frc_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."frc_events"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_frc_event_sessions_expires_at" ON "frc_event_sessions" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_frc_event_sessions_user_id" ON "frc_event_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_frc_event_sessions_event_id" ON "frc_event_sessions" USING btree ("event_id");

-- Who created, changed, ended, reopened, deleted or selected an event. No key
-- to frc_events, so the record of a deleted event survives it.
CREATE TABLE IF NOT EXISTS "frc_event_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frc_event_audit_action" CHECK ("action" IN ('created', 'updated', 'closed', 'reopened', 'deleted', 'selected', 'cleared'))
);

CREATE INDEX IF NOT EXISTS "idx_frc_event_audit_event_id_created_at" ON "frc_event_audit" USING btree ("event_id", "created_at");

ALTER TABLE "frc_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "frc_event_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "frc_event_audit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "frc_events" FROM PUBLIC;
REVOKE ALL ON TABLE "frc_event_sessions" FROM PUBLIC;
REVOKE ALL ON TABLE "frc_event_audit" FROM PUBLIC;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "frc_events" FROM anon;
		REVOKE ALL ON TABLE "frc_event_sessions" FROM anon;
		REVOKE ALL ON TABLE "frc_event_audit" FROM anon;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "frc_events" FROM authenticated;
		REVOKE ALL ON TABLE "frc_event_sessions" FROM authenticated;
		REVOKE ALL ON TABLE "frc_event_audit" FROM authenticated;
	END IF;
END
$$;

COMMIT;
