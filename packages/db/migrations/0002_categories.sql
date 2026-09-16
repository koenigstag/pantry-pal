CREATE TABLE "categories" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Hand-added: the categories the dropped CHECK constraints allowed, plus `fish`,
-- so that every existing item and product satisfies the foreign keys added below.
-- It must stay between the CREATE TABLE and those keys if this file is ever
-- regenerated. The same list is `CATEGORY_SEED` in src/seed.ts, as it stood when
-- this was written.
INSERT INTO "categories" ("code", "label", "sort_order") VALUES
	('produce', 'Produce', 10),
	('dairy', 'Dairy', 20),
	('meat', 'Meat', 30),
	('fish', 'Fish', 40),
	('grains', 'Grains', 50),
	('canned', 'Canned', 60),
	('frozen', 'Frozen', 70),
	('spices', 'Spices', 80),
	('beverages', 'Beverages', 90),
	('medicine', 'Medicine', 100),
	('personal-care', 'Personal care', 110),
	('cleaning', 'Cleaning', 120),
	('other', 'Other', 130);--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_check";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_category_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_category_fk" FOREIGN KEY ("default_category") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_fk" FOREIGN KEY ("category") REFERENCES "public"."categories"("code") ON DELETE restrict ON UPDATE no action;
