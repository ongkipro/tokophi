ALTER TYPE "public"."platform_activity_kind" ADD VALUE 'admin';--> statement-breakpoint
ALTER TABLE "platform_activity" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "comped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "comped_reason" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "comped_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_activity" ADD CONSTRAINT "platform_activity_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
