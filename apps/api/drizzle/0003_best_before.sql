ALTER TABLE "food_suggestion" ADD COLUMN "shelf_life_months" integer;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "best_before" date;--> statement-breakpoint
CREATE INDEX "item_best_before_idx" ON "item" USING btree ("best_before");