CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_events" DROP CONSTRAINT "item_events_type_check";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_location_id_locations_id_fk";
--> statement-breakpoint
DROP INDEX "locations_household_name_idx";--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- Hand-ordered: drizzle-kit emitted this UNIQUE after the foreign key below, but
-- Postgres requires a unique constraint on the referenced columns before a
-- foreign key can point at them. Keep it first if this file is ever regenerated.
ALTER TABLE "locations" ADD CONSTRAINT "locations_household_id_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_location_household_fk" FOREIGN KEY ("household_id","location_id") REFERENCES "public"."locations"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_household_name_idx" ON "locations" USING btree ("household_id",lower(name)) WHERE deleted_at is null;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_type_check" CHECK (type in ('added', 'updated', 'opened', 'consumed', 'discarded', 'restored', 'deleted'));
