ALTER TABLE "ad_metrics" ALTER COLUMN "channel_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "pixel_label" text;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "pixel_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "spend_idr" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "impressions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "conversions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "revenue_idr" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_channels" ADD COLUMN "campaigns" jsonb;