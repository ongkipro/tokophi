CREATE TABLE IF NOT EXISTS "kelurahan" (
	"id" text PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"name" text NOT NULL,
	"postcode" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kelurahan" ADD CONSTRAINT "kelurahan_district_id_kiriminaja_areas_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."kiriminaja_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
