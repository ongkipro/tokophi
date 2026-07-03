ALTER TABLE "articles" ADD COLUMN "comments" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "template" text DEFAULT 'page';--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;