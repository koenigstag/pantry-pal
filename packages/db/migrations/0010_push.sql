CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"expiry_notified_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_devices_topics_check" CHECK (topics <@ array['expiry', 'list-added', 'list-bought', 'members']::text[])
);
--> statement-breakpoint
CREATE TABLE "push_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"list_id" uuid,
	"item_id" uuid,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_outbox_topic_check" CHECK (topic in ('list-added', 'list-bought', 'members'))
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_refresh_tokens_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_devices_session_idx" ON "push_devices" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "push_outbox_group_idx" ON "push_outbox" USING btree ("household_id","actor_id","topic","list_id");