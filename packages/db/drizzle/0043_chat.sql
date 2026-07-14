-- Obrolan: shopper ⇄ merchant chat (specs/docs/CHAT_SPEC.md §2, slice 1).
--
-- A SECOND message axis alongside support_tickets (merchant ⇄ platform, "Tiket"). Deliberately
-- NEW TABLES rather than a nullable customer party on support_tickets (DECISION 1): the shopper is
-- ANONYMOUS, which adds a third isolation dimension (visitor_id) that a ticket does not have, plus
-- a spam surface, a block-list, and an upgrade path to `customers`. Volumes differ by ~100× — the
-- hot path (chat polling) must not share indexes with the cold one. The UI is what gets shared.
--
-- conversation_messages.store_id is DENORMALIZED on purpose: every tenant_isolation policy in this
-- database keys on store_id = app_current_store_id() (0012). A join-based policy would be slower
-- and inconsistent with the other 38 store-scoped tables. support_messages got this wrong in 0030
-- and had to be retrofitted in 0035 — not repeating it.
--
-- The poll cursor is (created_at, id): id breaks ties, so two messages written inside the same
-- millisecond cannot make the client skip one.

CREATE TYPE "public"."chat_visitor_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'snoozed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('customer', 'merchant', 'system');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" text,
	"phone" text,
	"status" "chat_visitor_status" DEFAULT 'active' NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sender" "message_sender" NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"unread_merchant" integer DEFAULT 0 NOT NULL,
	"unread_visitor" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_body" text,
	"entry_url" text,
	"product_handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_visitors" ADD CONSTRAINT "chat_visitors_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_visitors" ADD CONSTRAINT "chat_visitors_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_visitor_id_chat_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."chat_visitors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Inbox: newest-first per store, and per-tab (status) newest-first. Both are the merchant's list view.
CREATE INDEX IF NOT EXISTS "conversations_store_last_msg_idx" ON "conversations" ("store_id", "last_message_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_store_status_idx" ON "conversations" ("store_id", "status", "last_message_at" DESC);--> statement-breakpoint
-- The shopper's own thread lookup — resolved from the token's vid, never from a client-supplied id.
CREATE INDEX IF NOT EXISTS "conversations_store_visitor_idx" ON "conversations" ("store_id", "visitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_visitors_store_customer_idx" ON "chat_visitors" ("store_id", "customer_id");--> statement-breakpoint
-- THE hot path: every poll, from both sides, is `where conversation_id = $1 and (created_at,id) > cursor`.
CREATE INDEX IF NOT EXISTS "conversation_messages_conv_created_idx" ON "conversation_messages" ("conversation_id", "created_at", "id");--> statement-breakpoint

-- Chat is store-scoped merchant data: the DB is the tenant boundary, not a hand-written WHERE.
-- (The storefront's shopper API is the deliberate owner-connection exception — it has no session
-- and therefore no GUC — so it filters on store_id AND visitor_id in the application, exactly like
-- /api/public/order. The merchant admin has a session and goes through withTenant/withCurrentTenant.)
ALTER TABLE "chat_visitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "chat_visitors";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "chat_visitors" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "conversations";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversations" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "conversation_messages";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_messages" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
