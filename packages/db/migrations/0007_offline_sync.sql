DROP INDEX "shopping_lists_household_name_idx";--> statement-breakpoint
DROP INDEX "items_sync_idx";--> statement-breakpoint
DROP INDEX "shopping_list_entries_list_item_idx";--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopping_list_entries" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "locations_household_sync_idx" ON "locations" USING btree ("household_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "shopping_lists_household_sync_idx" ON "shopping_lists" USING btree ("household_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "shopping_list_entries_household_sync_idx" ON "shopping_list_entries" USING btree ("household_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lists_household_name_idx" ON "shopping_lists" USING btree ("household_id",lower(name)) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "items_sync_idx" ON "items" USING btree ("household_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_list_entries_list_item_idx" ON "shopping_list_entries" USING btree ("list_id","item_id") WHERE deleted_at is null;