ALTER TABLE "categories" ADD COLUMN "is_edible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Hand-added: the seeded categories that are not food or drink, as `CATEGORY_SEED`
-- in src/seed.ts marks them.
UPDATE "categories" SET "is_edible" = false WHERE "code" IN ('medicine', 'personal-care', 'cleaning');--> statement-breakpoint
-- Hand-split: drizzle-kit adds this column NOT NULL in one statement, which fails
-- on a table with rows. Add it nullable, copy each item's category's value, then
-- require it. Items in `other` start from that category's value too; each can be
-- switched afterwards.
ALTER TABLE "items" ADD COLUMN "is_edible" boolean;--> statement-breakpoint
UPDATE "items" SET "is_edible" = "categories"."is_edible" FROM "categories" WHERE "categories"."code" = "items"."category";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "is_edible" SET NOT NULL;
