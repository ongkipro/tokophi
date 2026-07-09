CREATE TABLE IF NOT EXISTS "platform_payment_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT false NOT NULL
);
