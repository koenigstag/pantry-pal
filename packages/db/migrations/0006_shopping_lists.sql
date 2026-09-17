CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_lists_household_id_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "shopping_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_entries_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "default_shopping_list_id" uuid;--> statement-breakpoint
-- Hand-ordered: drizzle-kit emitted this UNIQUE last, after the foreign key from
-- shopping_list_entries that references it, but Postgres requires a unique
-- constraint on the referenced columns before a foreign key can point at them.
-- Keep it ahead of the foreign keys if this file is ever regenerated.
ALTER TABLE "items" ADD CONSTRAINT "items_household_id_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_entries" ADD CONSTRAINT "shopping_list_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_entries" ADD CONSTRAINT "shopping_list_entries_list_household_fk" FOREIGN KEY ("household_id","list_id") REFERENCES "public"."shopping_lists"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_entries" ADD CONSTRAINT "shopping_list_entries_item_household_fk" FOREIGN KEY ("household_id","item_id") REFERENCES "public"."items"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lists_household_name_idx" ON "shopping_lists" USING btree ("household_id",lower(name));--> statement-breakpoint
CREATE INDEX "shopping_lists_household_sort_idx" ON "shopping_lists" USING btree ("household_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_list_entries_list_item_idx" ON "shopping_list_entries" USING btree ("list_id","item_id");--> statement-breakpoint
CREATE INDEX "shopping_list_entries_item_idx" ON "shopping_list_entries" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "shopping_list_entries_household_idx" ON "shopping_list_entries" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_default_shopping_list_household_fk" FOREIGN KEY ("household_id","default_shopping_list_id") REFERENCES "public"."shopping_lists"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_default_shopping_list_idx" ON "items" USING btree ("household_id","default_shopping_list_id") WHERE default_shopping_list_id is not null;