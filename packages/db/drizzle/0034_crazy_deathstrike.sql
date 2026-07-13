ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_googleSub_unique" UNIQUE("google_sub");