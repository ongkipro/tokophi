CREATE TABLE IF NOT EXISTS "kiriminaja_areas" (
	"id" integer PRIMARY KEY NOT NULL,
	"district_name" text NOT NULL,
	"city_id" integer,
	"city_type" text,
	"city_name" text NOT NULL,
	"province_id" integer,
	"province_name" text NOT NULL
);
