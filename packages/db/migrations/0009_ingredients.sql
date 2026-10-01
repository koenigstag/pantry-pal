-- Hand-added: the trigram operator class behind ingredient_names_search_idx.
-- pg_trgm is a trusted extension, so the database's owner may create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "ingredient_names" (
	"ingredient_id" text NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ingredient_names_ingredient_id_locale_search_name_pk" PRIMARY KEY("ingredient_id","locale","search_name"),
	CONSTRAINT "ingredient_names_locale_check" CHECK (locale ~ '^[a-z]{2,3}$')
);
--> statement-breakpoint
CREATE TABLE "ingredient_parents" (
	"ingredient_id" text NOT NULL,
	"parent_id" text NOT NULL,
	CONSTRAINT "ingredient_parents_ingredient_id_parent_id_pk" PRIMARY KEY("ingredient_id","parent_id")
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "ingredient_id" text;--> statement-breakpoint
ALTER TABLE "ingredient_names" ADD CONSTRAINT "ingredient_names_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_parents" ADD CONSTRAINT "ingredient_parents_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_parents" ADD CONSTRAINT "ingredient_parents_parent_id_ingredients_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_category_categories_code_fk" FOREIGN KEY ("category") REFERENCES "public"."categories"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_names_search_idx" ON "ingredient_names" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ingredient_parents_parent_idx" ON "ingredient_parents" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_ingredient_idx" ON "items" USING btree ("household_id","ingredient_id") WHERE ingredient_id is not null and deleted_at is null;