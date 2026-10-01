CREATE TABLE "recipe_favourites" (
	"household_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_favourites_household_id_recipe_id_pk" PRIMARY KEY("household_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_translations" (
	"recipe_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"source" text NOT NULL,
	"document" jsonb NOT NULL,
	CONSTRAINT "recipe_translations_recipe_id_locale_pk" PRIMARY KEY("recipe_id","locale"),
	CONSTRAINT "recipe_translations_locale_check" CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"locale" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"source" text NOT NULL,
	"document" jsonb NOT NULL,
	"source_url" text,
	"image_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_locale_check" CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "recipe_favourites" ADD CONSTRAINT "recipe_favourites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_favourites" ADD CONSTRAINT "recipe_favourites_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_translations" ADD CONSTRAINT "recipe_translations_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipes_household_created_idx" ON "recipes" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_household_source_url_idx" ON "recipes" USING btree ("household_id","source_url") WHERE household_id is not null and source_url is not null;