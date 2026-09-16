CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"system" text NOT NULL,
	"factor" numeric(20, 10) NOT NULL,
	CONSTRAINT "units_code_kind_unique" UNIQUE("code","kind"),
	CONSTRAINT "units_kind_check" CHECK (kind in ('mass', 'volume', 'count')),
	CONSTRAINT "units_system_check" CHECK (system in ('metric', 'imperial', 'both')),
	CONSTRAINT "units_factor_positive" CHECK (factor > 0)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"auth_provider" text,
	"provider_user_id" text,
	"display_name" text NOT NULL,
	"unit_system" text DEFAULT 'metric' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en-GB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_unit_system_check" CHECK (unit_system in ('metric', 'imperial'))
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id"),
	CONSTRAINT "household_members_role_check" CHECK (role in ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"name" varchar(80) NOT NULL,
	"brand" text,
	"barcode" text,
	"default_category" text,
	"default_unit" text,
	"default_unit_kind" text DEFAULT 'count' NOT NULL,
	"default_shelf_life_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_category_check" CHECK (default_category is null or default_category in ('produce', 'dairy', 'meat', 'grains', 'canned', 'frozen', 'spices', 'beverages', 'medicine', 'personal-care', 'cleaning', 'other')),
	CONSTRAINT "products_default_unit_kind_count" CHECK (default_unit_kind = 'count')
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"product_id" uuid,
	"name" varchar(80) NOT NULL,
	"location_id" uuid NOT NULL,
	"category" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_kind" text DEFAULT 'count' NOT NULL,
	"size_value" numeric(10, 3),
	"size_unit" text,
	"expires_at" date,
	"opened_at" date,
	"period_after_opening_days" integer,
	"effective_expires_at" date GENERATED ALWAYS AS (least(expires_at, opened_at + period_after_opening_days)) STORED,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "items_category_check" CHECK (category in ('produce', 'dairy', 'meat', 'grains', 'canned', 'frozen', 'spices', 'beverages', 'medicine', 'personal-care', 'cleaning', 'other')),
	CONSTRAINT "items_status_check" CHECK (status in ('active', 'consumed', 'discarded')),
	CONSTRAINT "items_quantity_positive" CHECK (quantity >= 0),
	CONSTRAINT "items_unit_kind_count" CHECK (unit_kind = 'count'),
	CONSTRAINT "items_size_pair" CHECK ((size_value is null) = (size_unit is null))
);
--> statement-breakpoint
CREATE TABLE "item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"quantity_delta" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_events_type_check" CHECK (type in ('added', 'updated', 'opened', 'consumed', 'discarded', 'restored'))
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_default_unit_count_fk" FOREIGN KEY ("default_unit","default_unit_kind") REFERENCES "public"."units"("code","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_unit_count_fk" FOREIGN KEY ("unit","unit_kind") REFERENCES "public"."units"("code","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_size_unit_units_code_fk" FOREIGN KEY ("size_unit") REFERENCES "public"."units"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "users_provider_idx" ON "users" USING btree ("auth_provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_household_name_idx" ON "locations" USING btree ("household_id",lower(name));--> statement-breakpoint
CREATE INDEX "locations_household_sort_idx" ON "locations" USING btree ("household_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "products_household_barcode_idx" ON "products" USING btree ("household_id","barcode") WHERE barcode is not null;--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("barcode") WHERE barcode is not null;--> statement-breakpoint
CREATE INDEX "products_household_name_idx" ON "products" USING btree ("household_id",lower(name));--> statement-breakpoint
CREATE INDEX "items_expiry_idx" ON "items" USING btree ("household_id","effective_expires_at") WHERE deleted_at is null and status = 'active';--> statement-breakpoint
CREATE INDEX "items_location_idx" ON "items" USING btree ("household_id","location_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "items_sync_idx" ON "items" USING btree ("household_id","updated_at");--> statement-breakpoint
CREATE INDEX "items_product_idx" ON "items" USING btree ("household_id","product_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "item_events_household_idx" ON "item_events" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_events_item_idx" ON "item_events" USING btree ("item_id","created_at" DESC NULLS LAST);