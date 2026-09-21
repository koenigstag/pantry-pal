CREATE TABLE "sub_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"expires_at" date,
	"opened_at" date,
	"period_after_opening_days" integer,
	"effective_expires_at" date GENERATED ALWAYS AS (least(expires_at, opened_at + period_after_opening_days)) STORED,
	"fill_percent" smallint DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sub_items_status_check" CHECK (status in ('active', 'consumed', 'discarded')),
	CONSTRAINT "sub_items_fill_range" CHECK (fill_percent between 1 and 100),
	CONSTRAINT "sub_items_fill_needs_opened" CHECK (fill_percent = 100 or opened_at is not null)
);
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_quantity_positive";--> statement-breakpoint
DROP INDEX "items_expiry_idx";--> statement-breakpoint
ALTER TABLE "item_events" ADD COLUMN "sub_item_id" uuid;--> statement-breakpoint
ALTER TABLE "sub_items" ADD CONSTRAINT "sub_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_items" ADD CONSTRAINT "sub_items_item_household_fk" FOREIGN KEY ("household_id","item_id") REFERENCES "public"."items"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-added: every existing item becomes that many units, each carrying the
-- item's dates, before the item's columns are dropped below. After the keys
-- above, so they check every unit. A used-up or thrown-out item keeps its units
-- active: its own status says it left, as restoring it brings them back.
INSERT INTO "sub_items" ("household_id", "item_id", "expires_at", "opened_at", "period_after_opening_days", "created_at", "updated_at")
SELECT i."household_id", i."id", i."expires_at", i."opened_at", i."period_after_opening_days", i."created_at", i."updated_at"
FROM "items" i CROSS JOIN generate_series(1, i."quantity");--> statement-breakpoint
-- Hand-added: an item at quantity 0 has no units to make, but still dates to
-- show, so it gets one consumed unit to hold them. Every item then has at least
-- one unit, which `ItemsRepository` relies on.
INSERT INTO "sub_items" ("household_id", "item_id", "expires_at", "opened_at", "period_after_opening_days", "status", "created_at", "updated_at")
SELECT i."household_id", i."id", i."expires_at", i."opened_at", i."period_after_opening_days", 'consumed', i."created_at", i."updated_at"
FROM "items" i WHERE i."quantity" = 0;--> statement-breakpoint
CREATE INDEX "sub_items_item_idx" ON "sub_items" USING btree ("item_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "sub_items_expiry_idx" ON "sub_items" USING btree ("household_id","effective_expires_at") WHERE deleted_at is null and status = 'active';--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_sub_item_id_sub_items_id_fk" FOREIGN KEY ("sub_item_id") REFERENCES "public"."sub_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-ordered: drizzle-kit dropped effective_expires_at last, but Postgres
-- refuses to drop a column a generated column still reads, so it goes first.
-- Keep it ahead of expires_at, opened_at and period_after_opening_days if this
-- file is ever regenerated.
ALTER TABLE "items" DROP COLUMN "effective_expires_at";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "quantity";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "opened_at";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "period_after_opening_days";
