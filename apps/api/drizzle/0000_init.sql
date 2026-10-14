CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawer" (
	"id" text PRIMARY KEY NOT NULL,
	"freezer_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"freezer_id" text NOT NULL,
	"name" text NOT NULL,
	"last_unit" text NOT NULL,
	"use_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freezer" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freezer_member" (
	"freezer_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "freezer_member_freezer_id_user_id_pk" PRIMARY KEY("freezer_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY NOT NULL,
	"freezer_id" text NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"signup_url" text,
	CONSTRAINT "invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"freezer_id" text NOT NULL,
	"drawer_id" text NOT NULL,
	"container_number" integer,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"frozen_at" date NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_freezer_container_uq" UNIQUE("freezer_id","container_number")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawer" ADD CONSTRAINT "drawer_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_suggestion" ADD CONSTRAINT "food_suggestion_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freezer" ADD CONSTRAINT "freezer_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freezer_member" ADD CONSTRAINT "freezer_member_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freezer_member" ADD CONSTRAINT "freezer_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_drawer_id_drawer_id_fk" FOREIGN KEY ("drawer_id") REFERENCES "public"."drawer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drawer_freezer_idx" ON "drawer" USING btree ("freezer_id");--> statement-breakpoint
CREATE INDEX "food_suggestion_freezer_idx" ON "food_suggestion" USING btree ("freezer_id");--> statement-breakpoint
CREATE INDEX "freezer_member_user_idx" ON "freezer_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invite_freezer_idx" ON "invite" USING btree ("freezer_id");--> statement-breakpoint
CREATE INDEX "item_freezer_idx" ON "item" USING btree ("freezer_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");