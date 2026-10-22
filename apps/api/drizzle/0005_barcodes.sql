CREATE TABLE "barcode" (
	"id" text PRIMARY KEY NOT NULL,
	"freezer_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"category" text
);
--> statement-breakpoint
ALTER TABLE "barcode" ADD CONSTRAINT "barcode_freezer_id_freezer_id_fk" FOREIGN KEY ("freezer_id") REFERENCES "public"."freezer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barcode_freezer_idx" ON "barcode" USING btree ("freezer_id");