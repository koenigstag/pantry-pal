CREATE TABLE "default_location_translations" (
	"code" text NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "default_location_translations_code_locale_pk" PRIMARY KEY("code","locale"),
	CONSTRAINT "default_location_translations_locale_check" CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);
--> statement-breakpoint
CREATE TABLE "default_locations" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "default_location_translations" ADD CONSTRAINT "default_location_translations_code_default_locations_code_fk" FOREIGN KEY ("code") REFERENCES "public"."default_locations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "default_location_translations_name_idx" ON "default_location_translations" USING btree ("locale",lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "default_locations_name_idx" ON "default_locations" USING btree (lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "default_locations_fallback_idx" ON "default_locations" USING btree ("is_fallback") WHERE is_fallback;--> statement-breakpoint
-- Hand-added: the default storage spaces and their names, as
-- `DEFAULT_LOCATION_SEED` in src/seed.ts stood when this was written. They
-- replace the `default-locations` setting, whose code default was this same
-- English list.
INSERT INTO "default_locations" ("code", "name", "sort_order", "is_fallback") VALUES
	('kitchen', 'Kitchen', 10, false),
	('fridge', 'Fridge', 20, false),
	('freezer', 'Freezer', 30, false),
	('pantry', 'Pantry', 40, false),
	('spices', 'Spices', 50, false),
	('bathroom', 'Bathroom', 60, false),
	('medicines', 'Medicines', 70, false),
	('other', 'Other', 80, true);--> statement-breakpoint
INSERT INTO "default_location_translations" ("code", "locale", "name") VALUES
	('kitchen', 'uk', 'Кухня'),
	('kitchen', 'ru', 'Кухня'),
	('kitchen', 'de', 'Küche'),
	('kitchen', 'fr', 'Cuisine'),
	('kitchen', 'es', 'Cocina'),
	('fridge', 'uk', 'Холодильник'),
	('fridge', 'ru', 'Холодильник'),
	('fridge', 'de', 'Kühlschrank'),
	('fridge', 'fr', 'Réfrigérateur'),
	('fridge', 'es', 'Frigorífico'),
	('freezer', 'uk', 'Морозилка'),
	('freezer', 'ru', 'Морозилка'),
	('freezer', 'de', 'Gefrierschrank'),
	('freezer', 'fr', 'Congélateur'),
	('freezer', 'es', 'Congelador'),
	('pantry', 'uk', 'Комора'),
	('pantry', 'ru', 'Кладовая'),
	('pantry', 'de', 'Vorratskammer'),
	('pantry', 'fr', 'Garde-manger'),
	('pantry', 'es', 'Despensa'),
	('spices', 'uk', 'Спеції'),
	('spices', 'ru', 'Специи'),
	('spices', 'de', 'Gewürze'),
	('spices', 'fr', 'Épices'),
	('spices', 'es', 'Especias'),
	('bathroom', 'uk', 'Ванна кімната'),
	('bathroom', 'ru', 'Ванная'),
	('bathroom', 'de', 'Badezimmer'),
	('bathroom', 'fr', 'Salle de bain'),
	('bathroom', 'es', 'Baño'),
	('medicines', 'uk', 'Ліки'),
	('medicines', 'ru', 'Лекарства'),
	('medicines', 'de', 'Medikamente'),
	('medicines', 'fr', 'Médicaments'),
	('medicines', 'es', 'Medicamentos'),
	('other', 'uk', 'Інше'),
	('other', 'ru', 'Другое'),
	('other', 'de', 'Sonstiges'),
	('other', 'fr', 'Autre'),
	('other', 'es', 'Otros');--> statement-breakpoint
-- `default-locations` was the only setting, so the settings table goes with it.
-- An override stored there is not carried over: set it again through
-- `PUT /admin/default-locations`.
DROP TABLE "app_settings" CASCADE;
