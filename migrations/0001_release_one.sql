-- Release one. Hand written, one transaction, safe to run twice.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id", "key")
);

CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_created_at" ON "idempotency_keys" USING btree ("created_at");

CREATE TABLE IF NOT EXISTS "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"quantity_before" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_stock_adjustments_inventory_item_id" ON "stock_adjustments" USING btree ("inventory_item_id");

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "classification" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "client_classification" text;

REVOKE ALL ON TABLE "idempotency_keys" FROM PUBLIC;
REVOKE ALL ON TABLE "stock_adjustments" FROM PUBLIC;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "idempotency_keys" FROM anon;
		REVOKE ALL ON TABLE "stock_adjustments" FROM anon;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "idempotency_keys" FROM authenticated;
		REVOKE ALL ON TABLE "stock_adjustments" FROM authenticated;
	END IF;
END
$$;

COMMIT;
