-- Every foreign-key column gets an index whose LEADING column is that FK. 70 of them had none.
--
-- Measured 2026-10-29 on the local 1:1 production copy (`tokophi`, 116 migrations) and on this
-- branch's own database at 0122: `pg_constraint` (contype 'f') joined to `pg_index` on
-- `indkey[0] = conkey[1]` returned 67 FKs on main + 3 on the buyer/affiliate tables from 0116–0121.
-- Every one is single-column, and no proposed name collides with an existing relation.
--
-- Why it matters, in order of cost:
--   • RLS. Every tenant read on `customers`, `product_variants`, `reviews`, `media`, `payouts`, … runs
--     `store_id = current_setting('app.store_id')`. With no index on `store_id` that predicate is a
--     sequential scan of every store's rows, on every query, for every tenant.
--   • Hot joins with no index on the child side: `orders.customer_id` (customer detail),
--     `store_users.user_id` (session/membership on every Seller request), `order_line_items.variant_id`,
--     `discount_usages.order_id`, `fulfillments.order_id`, `support_messages.ticket_id`,
--     `stores.account_id` / `invoices.account_id` (the account screens).
--   • Parent DELETE/UPDATE: Postgres checks the referencing table for each parent row it touches; with
--     no index that check is a full scan of the child — the same shape as `order_line_items.order_id`,
--     which carried no index anywhere until 0096.
-- Tables are small today (largest store-scoped heap ~224 kB), so nothing is slow YET; this is the
-- cheap moment to do it.
--
-- The census in `schema-indexes.test.ts` classifies every name below as "drizzle" (each is mirrored in
-- `schema.ts`), and `fk-indexes.test.ts` now fails on any FOREIGN KEY added later without a leading
-- index — derived from the catalog of the migrated test database, never from a list.
--
-- Plain CREATE INDEX, not CONCURRENTLY: drizzle applies the pending batch inside ONE transaction, where
-- CONCURRENTLY is refused outright. At these sizes the SHARE lock on each table lasts milliseconds.
--
-- Idempotent (AGENTS.md): a single "already exists" would roll back every migration behind it while
-- printing success. Additive only — no row is read, written or deleted.
create index if not exists "ad_channels_store_idx" on "ad_channels" ("store_id");
create index if not exists "ad_metrics_store_idx" on "ad_metrics" ("store_id");
create index if not exists "articles_blog_idx" on "articles" ("blog_id");
create index if not exists "blogs_store_idx" on "blogs" ("store_id");
create index if not exists "buyer_addresses_district_idx" on "buyer_addresses" ("district_id");
create index if not exists "buyer_order_claims_store_idx" on "buyer_order_claims" ("store_id");
create index if not exists "buyer_store_links_customer_idx" on "buyer_store_links" ("customer_id");
create index if not exists "chat_visitors_customer_idx" on "chat_visitors" ("customer_id");
create index if not exists "checkout_sessions_customer_idx" on "checkout_sessions" ("customer_id");
create index if not exists "collection_conditions_collection_idx" on "collection_conditions" ("collection_id");
create index if not exists "collection_products_product_idx" on "collection_products" ("product_id");
create index if not exists "collections_template_idx" on "collections" ("template_id");
create index if not exists "conversation_messages_sender_user_idx" on "conversation_messages" ("sender_user_id");
create index if not exists "conversation_messages_store_idx" on "conversation_messages" ("store_id");
create index if not exists "conversations_assigned_user_idx" on "conversations" ("assigned_user_id");
create index if not exists "conversations_customer_idx" on "conversations" ("customer_id");
create index if not exists "conversations_order_idx" on "conversations" ("order_id");
create index if not exists "conversations_visitor_idx" on "conversations" ("visitor_id");
create index if not exists "customer_addresses_customer_idx" on "customer_addresses" ("customer_id");
create index if not exists "customer_segments_store_idx" on "customer_segments" ("store_id");
create index if not exists "customers_store_idx" on "customers" ("store_id");
create index if not exists "discount_usages_discount_idx" on "discount_usages" ("discount_id");
create index if not exists "discount_usages_order_idx" on "discount_usages" ("order_id");
create index if not exists "domains_store_idx" on "domains" ("store_id");
create index if not exists "flash_sale_items_product_idx" on "flash_sale_items" ("product_id");
create index if not exists "flash_sales_store_idx" on "flash_sales" ("store_id");
create index if not exists "followups_customer_idx" on "followups" ("customer_id");
create index if not exists "followups_store_idx" on "followups" ("store_id");
create index if not exists "fulfillments_order_idx" on "fulfillments" ("order_id");
create index if not exists "impersonation_grants_operator_idx" on "impersonation_grants" ("operator_id");
create index if not exists "impersonation_grants_user_idx" on "impersonation_grants" ("user_id");
create index if not exists "inventory_levels_location_idx" on "inventory_levels" ("location_id");
create index if not exists "invoices_account_idx" on "invoices" ("account_id");
create index if not exists "landing_pages_product_idx" on "landing_pages" ("product_id");
create index if not exists "leads_store_idx" on "leads" ("store_id");
create index if not exists "locations_store_idx" on "locations" ("store_id");
create index if not exists "media_store_idx" on "media" ("store_id");
create index if not exists "menu_items_menu_idx" on "menu_items" ("menu_id");
create index if not exists "menu_items_parent_idx" on "menu_items" ("parent_id");
create index if not exists "notification_templates_store_idx" on "notification_templates" ("store_id");
create index if not exists "order_line_items_variant_idx" on "order_line_items" ("variant_id");
create index if not exists "orders_customer_idx" on "orders" ("customer_id");
create index if not exists "page_templates_store_idx" on "page_templates" ("store_id");
create index if not exists "payouts_store_idx" on "payouts" ("store_id");
create index if not exists "platform_activity_store_idx" on "platform_activity" ("store_id");
create index if not exists "product_media_product_idx" on "product_media" ("product_id");
create index if not exists "product_options_product_idx" on "product_options" ("product_id");
create index if not exists "product_variants_store_idx" on "product_variants" ("store_id");
create index if not exists "products_google_category_idx" on "products" ("google_category_id");
create index if not exists "products_template_idx" on "products" ("template_id");
create index if not exists "promo_pages_product_idx" on "promo_pages" ("product_id");
create index if not exists "purchase_order_items_purchase_order_idx" on "purchase_order_items" ("purchase_order_id");
create index if not exists "purchase_order_items_variant_idx" on "purchase_order_items" ("variant_id");
create index if not exists "purchase_orders_supplier_idx" on "purchase_orders" ("supplier_id");
create index if not exists "reviews_customer_idx" on "reviews" ("customer_id");
create index if not exists "reviews_product_idx" on "reviews" ("product_id");
create index if not exists "reviews_store_idx" on "reviews" ("store_id");
create index if not exists "stock_transfers_from_location_idx" on "stock_transfers" ("from_location");
create index if not exists "stock_transfers_store_idx" on "stock_transfers" ("store_id");
create index if not exists "stock_transfers_to_location_idx" on "stock_transfers" ("to_location");
create index if not exists "store_users_user_idx" on "store_users" ("user_id");
create index if not exists "stores_account_idx" on "stores" ("account_id");
create index if not exists "suppliers_store_idx" on "suppliers" ("store_id");
create index if not exists "support_messages_store_idx" on "support_messages" ("store_id");
create index if not exists "support_messages_ticket_idx" on "support_messages" ("ticket_id");
create index if not exists "support_tickets_store_idx" on "support_tickets" ("store_id");
create index if not exists "wa_messages_followup_idx" on "wa_messages" ("followup_id");
create index if not exists "wa_messages_lead_idx" on "wa_messages" ("lead_id");
create index if not exists "wa_messages_store_idx" on "wa_messages" ("store_id");
create index if not exists "wa_templates_store_idx" on "wa_templates" ("store_id");
