// TokoΦ DB schema (Drizzle) — mirrors docs/SCHEMA.md.
// casing: "snake_case" is set on the client + drizzle-kit, so camelCase props map to snake_case columns.
// Money: all *_idr columns are integer rupiah (no decimals), bigint to survive aggregates.
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  smallint,
  bigint,
  real,
  doublePrecision,
  date,
  timestamp,
  jsonb,
  primaryKey,
  unique,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- shared column helpers ----------
const pk = () => uuid().primaryKey().defaultRandom();
const money = () => bigint({ mode: "number" });
const createdAt = () =>
  timestamp({ withTimezone: true }).defaultNow().notNull();
const ts = () => timestamp({ withTimezone: true });

// ---------- enums ----------
export const planKey = pgEnum("plan_key", ["pemula", "bisnis", "skala"]);
export const storeStatus = pgEnum("store_status", [
  "trial",
  "active",
  "past_due",
  "suspended",
]);
export const storeUserRole = pgEnum("store_user_role", [
  "owner",
  "admin",
  "staff",
  "gudang",
  // 2026-08-24 (owner request): two specialist roles. `advertiser` runs the marketing surface
  // (pixels/CAPI/feeds/promo/content); `cs` runs the service desk (orders/customers/CRM/chat).
  "advertiser",
  "cs",
]);
export const productStatus = pgEnum("product_status", [
  "active",
  "draft",
  "archived",
]);
export const collectionType = pgEnum("collection_type", ["manual", "otomatis"]);
export const collectionMatch = pgEnum("collection_match", ["all", "any"]);
export const conditionField = pgEnum("condition_field", [
  "tag",
  "title",
  "type",
  "price",
  "stock",
  "category",
]);
export const conditionOperator = pgEnum("condition_operator", [
  "eq",
  "neq",
  "gt",
  "lt",
  "contains",
]);
export const poStatus = pgEnum("po_status", [
  "draft",
  "dipesan",
  "sebagian",
  "diterima",
]);
export const transferStatus = pgEnum("transfer_status", [
  "draft",
  "dikirim",
  "diterima",
  "batal",
]);
// `retur` = the parcel came back: refused at the door (the classic COD failure), address dead, or
// the buyer bounced it. It is NOT `batal` — a cancelled order never shipped, a returned one did,
// and someone paid to move it twice. Keeping them apart is what makes the COD return rate
// measurable at all (migration 0039).
export const orderStatus = pgEnum("order_status", [
  "baru",
  "diproses",
  "dikirim",
  "selesai",
  "batal",
  "retur",
]);
export const financialStatus = pgEnum("financial_status", [
  "pending",
  "dibayar",
  "refund_sebagian",
  "refund",
]);
export const orderChannel = pgEnum("order_channel", [
  "meta_ads",
  "tiktok_ads",
  "google_ads",
  "organic",
  "other",
]);
export const paymentMethod = pgEnum("payment_method", [
  "transfer",
  "qris",
  "ovo",
  "gopay",
  "dana",
  "va",
  "cod",
]);
export const paymentStatus = pgEnum("payment_status", [
  "menunggu",
  "berhasil",
  "gagal",
]);
export const paymentRequestState = pgEnum("payment_request_state", [
  "in_progress",
  "accepted",
  "failed",
]);
export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "menunggu",
  "diproses",
  "dikirim",
  "terkirim",
  "batal",
]);
export const shipmentBookingStatus = pgEnum("shipment_booking_status", [
  "reserved",
  "unknown",
  "accepted",
  "cancellation_requested",
  "failed",
  "voided",
  "refunded",
]);
export const customerSegment = pgEnum("customer_segment", [
  "baru",
  "reguler",
  "loyal",
  "vip",
]);
export const reviewStatus = pgEnum("review_status", ["terbit", "menunggu"]);
export const leadSource = pgEnum("lead_source", [
  "whatsapp",
  "instagram",
  "tiktok",
  "referral",
  "marketplace",
]);
export const leadStage = pgEnum("lead_stage", [
  "baru",
  "dihubungi",
  "nego",
  "closing",
  "menang",
  "kalah",
]);
export const followupType = pgEnum("followup_type", [
  "keranjang",
  "pembayaran",
  "konfirmasi",
  "pascabeli",
  "repeat",
  "ulasan",
]);
export const followupStatus = pgEnum("followup_status", [
  "menunggu",
  "terkirim",
  "dibalas",
  "selesai",
]);
export const discountKind = pgEnum("discount_kind", [
  "persen",
  "nominal",
  "gratis_ongkir",
]);
export const discountStatus = pgEnum("discount_status", [
  "aktif",
  "terjadwal",
  "nonaktif",
]);
export const contentStatus = pgEnum("content_status", ["terbit", "draft"]);
export const menuItemType = pgEnum("menu_item_type", [
  "home",
  "collection",
  "product",
  "page",
  "blog",
  "url",
  "catalog",
]);
export const adChannelKey = pgEnum("ad_channel_key", [
  "meta",
  "google",
  "tiktok",
]);
export const gatewayProvider = pgEnum("gateway_provider", [
  "midtrans",
  "xendit",
  "duitku",
  "autolaris",
]);
export const aggregatorProvider = pgEnum("aggregator_provider", [
  "biteship",
  "rajaongkir",
  "shipper",
  "kiriminaja",
]);
export const invoiceStatus = pgEnum("invoice_status", [
  "dibayar",
  "menunggu",
  "gagal",
]);
export const platformActivityKind = pgEnum("platform_activity_kind", [
  "signup",
  "upgrade",
  "payment",
  "churn",
  "support",
  "admin",
]);
export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "wa",
]);
export const pageTemplateType = pgEnum("page_template_type", [
  "homepage",
  "category",
  "product",
]); // ADR 0009 — Store Builder
export const storeDomainStatus = pgEnum("store_domain_status", [
  "pending", // added, TXT not yet verified
  "verifying", // TXT check in progress
  "provisioning", // verified; waiting on the CA / Cloudflare cert
  "active", // served, cert valid — the ONLY status the storefront resolves on
  "error", // verification or cert failed; last_error surfaced in the admin UI
  "disabled", // merchant turned it off
]);

// ---------- identity & tenancy ----------
export const accounts = pgTable("accounts", {
  id: pk(),
  name: text().notNull(),
  plan: planKey().notNull().default("pemula"),
  createdAt: createdAt(),
});

export const stores = pgTable("stores", {
  id: pk(),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  name: text().notNull(),
  slug: text().notNull().unique(),
  city: text(),
  currency: text().notNull().default("IDR"),
  timezone: text().notNull().default("Asia/Jakarta"),
  plan: planKey().notNull().default("pemula"),
  status: storeStatus().notNull().default("trial"),
  // Subscription lifecycle (single plan, all features): 3-day free trial → 50rb first month →
  // 275rb/month. trialEndsAt = end of free trial; currentPeriodEnd = end of the paid period;
  // firstInvoicePaid flips the recurring price from the 50rb promo to 275rb.
  trialEndsAt: ts(),
  currentPeriodEnd: ts(),
  firstInvoicePaid: boolean().notNull().default(false),
  // Comped / VIP: super-admin bypasses billing for this store (no monthly charge). Used for
  // high-volume merchants we choose to host free. `comped=true` → always active, MRR 0, cron skips.
  comped: boolean().notNull().default(false),
  compedReason: text(),
  compedAt: ts(),
  // The seeded demo store (0113). Excluded from every platform money KPI; still served and listed
  // with a "Demo" badge. Flag rather than purge — the seed would recreate a purged store.
  isDemo: boolean().notNull().default(false),
  // 🔴 OPERATOR SUSPENSION (0086) — a DELIBERATE ACT by the platform, not a consequence of an
  // unpaid invoice, and therefore its own column rather than a value of `status`.
  //
  // `status` is a denormalized cache the billing cron rewrites nightly from `computeBilling()`, so
  // an operator who wrote `status='suspended'` had their decision reverted within 24 hours — and it
  // never took effect in the first place, because the merchant lockout is decided by
  // `computeBilling()`, which read only comped/currentPeriodEnd/trialEndsAt. Two facts had been
  // collapsed into one column and billing always won.
  //
  // `suspendedAt IS NOT NULL` ⇒ `computeBilling()` returns suspended + readOnly, over ANY billing
  // state including `comped`. Paying does not clear it; only `liftSuspension` does.
  suspendedAt: ts(),
  suspendedReason: text(),
  // 🟠 FIRST REVIEW (0090) — the second half of a suspension's meaning.
  //
  // `suspendedAt` says a store is locked; it cannot say WHY, and the two reasons need opposite
  // words. Self-serve signup creates a store LOCKED (there is no email verification on the password
  // path and no mailer in this repo to build one with — `specs/docs/tasks/2026-08-05-signup-open-audit.md`),
  // so the very first thing a new merchant would otherwise read is "Toko ditangguhkan oleh TokoΦ",
  // as though they had done something wrong.
  //
  // `approvedAt IS NULL AND suspendedAt IS NOT NULL` ⇒ waiting for a first review. Set once, by
  // `approveStore`; NEVER cleared — a store suspended later for cause keeps its approval date, so
  // the queue cannot re-fill with stores that have already been vetted. Stores that existed before
  // this column were backfilled to `created_at`: they were onboarded by an operator by hand.
  approvedAt: ts(),
  // Branding read-only by the storefront/checkout (ADR 0009 — checkout is locked/uniform,
  // only pulls these tokens; NOT part of the drag-drop Store Builder).
  logoUrl: text(),
  // Tab icon for the merchant's OWN storefront (0057). Null = fall back to the platform icon.
  faviconUrl: text(),
  // Brand hex (e.g. "#a85572") the merchant picks in the Store Builder's colour panel; the
  // storefront derives a full 11-shade scale from it (@tokophi/lib/colors). Null = fall back
  // to the default brand hex baked into apps/storefront/src/styles/global.css.
  brandColor: text(),
  // Design-token choices beyond the single brand colour (@tokophi/lib/theme `StoreTheme`):
  // `{ font, tone }` — curated font pairing id + neutral-tone id. The storefront derives the
  // whole neutral palette (surface/text/border) from brandColor × tone, so the batik-boutique
  // look becomes this store's PRESET rather than the platform default. Null = the original
  // look (elegan/hangat) — existing stores render unchanged. jsonb (not columns) because the
  // resolver already validates/defaults every field and future dials (radius, dark) land here
  // without another migration.
  theme: jsonb(),
  // Product-page gallery layout the merchant picks in the Store Builder (Tema). One of
  // 'thumbnail-left' (thumbnail rail beside the main image — the default), 'thumbnail-bottom'
  // (rail under the main image), or 'grid' (a 2-column grid of every image, no main/thumbnail
  // split). Read by apps/storefront's produk/[handle].astro; a text column (not an enum) to keep
  // it a cheap additive migration on the shared DB — the storefront clamps unknown values.
  productGalleryLayout: text().notNull().default("thumbnail-left"),
  // The shop's OWN customer-service WhatsApp and one-line pitch.
  //
  // These did not exist, so `apps/storefront/src/data/store.ts` fell back to platform constants — and
  // `wa.me/6281234567890` (the canonical Indonesian dummy number) shipped as the "Hubungi via
  // WhatsApp" button on EVERY page of EVERY store, ~19 times per page. Every one of those buttons
  // opened a chat with nobody. A dead CS channel costs the sale AND the trust.
  //
  // Both stay NULLABLE on purpose: a store that has not set them must render NO WhatsApp button and
  // NO tagline, rather than a placeholder. A missing channel is honest; a dead one is not.
  whatsapp: text(), // digits only, country code first: "628123456789"
  tagline: text(),
  // Public shop identity (0063) — what a shopper is allowed to see in the storefront footer.
  //
  // ⚠️ `address` is NOT `store_settings.sender_address`. That one is the SHIPPING PICKUP point: it
  // prices ongkir and it is where the courier physically collects. Conflating them is wrong twice —
  // a merchant may ship from a warehouse while the shop is elsewhere, and most sellers here start
  // from HOME, so publishing the pickup address would put a private home address on every page of a
  // public website without ever asking. This field is entered deliberately, and empty is normal.
  address: text(),
  // Public phone. Separate from `store_settings.sender_phone` (the courier's contact for pickup) for
  // the same reason, and separate from `whatsapp` because plenty of shops publish a landline they do
  // not run WhatsApp on.
  phone: text(),
  // The shop's PUBLIC email — correspondence a shopper may write to, rendered in the storefront
  // footer. ⚠️ NOT `users.email`, which is a LOGIN CREDENTIAL: unique across the platform and never
  // for publication. Two fields, two jobs (migration 0070).
  email: text(),
  // Social handles — the USERNAME only, no @ and no URL. The storefront builds the link. Storing a
  // full URL invites pasting anything (someone else's profile, or a `javascript:` scheme) and turns
  // validation into URL parsing instead of the much narrower username problem.
  socialInstagram: text(),
  socialTiktok: text(),
  socialFacebook: text(),
  socialPinterest: text(),
  socialX: text(),
  // Which identifier this store's product feed and conversion events use (ADR 0013).
  //   'handle' — the legacy scheme: `handle` / `handle-{ordinal}`. Unstable: renaming a product,
  //              reordering variants, or ADDING A SECOND VARIANT re-keys it.
  //   'number' — `{products.number}-{variant.seq}`. System-generated, allocate-once, stable forever.
  // Existing stores stay on 'handle' and new ones start on 'number', because switching is a ONE-WAY
  // door: Google overwrites the product and its history, Meta deletes and recreates the catalog item,
  // and any retargeting audience keyed on the old content_ids goes cold. No provider offers a re-key.
  // So the merchant chooses the moment, from Pemasaran → Pelacakan, warned in plain Indonesian.
  catalogIdScheme: text().notNull().default("handle"),
  createdAt: createdAt(),
});

// Per-store rollup snapshot for the platform control plane (super-admin). A cache of
// metrics that are otherwise aggregated from each store's orders/products — refreshed by a
// job in production; seeded directly for the demo. Keeps platform pages off full scans.
export const storeStats = pgTable("store_stats", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id),
  gmvIdr: money().notNull().default(0),
  ordersCount: integer().notNull().default(0),
  productsCount: integer().notNull().default(0),
  ship7dAvg: integer().notNull().default(0), // avg shipments/day over the last 7 days (VIP threshold signal)
  updatedAt: createdAt(),
});

export const users = pgTable("users", {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  passwordHash: text(), // scrypt "salt:hash" (local auth)
  // WHEN the current `passwordHash` was ROTATED — the session revocation clock (migration 0087).
  // `getSession()` refuses any JWT issued at or before this instant, so changing a password ends
  // every session the old one opened. Written ONLY by the `users_stamp_password_changed_at` BEFORE
  // UPDATE trigger, never by application code: six code paths write `passwordHash`, and a stamp five
  // of them remember is worse than none. NULL = never rotated (a fresh account, or a session that
  // predates 0087) → nothing to revoke. Do not set this from a query; the trigger will overwrite it.
  passwordChangedAt: ts(),
  // How this user signs in: "password" (scrypt) or "google" (OAuth). Password users keep working
  // untouched; a Google user may also have a passwordHash (linked account) — the provider column
  // only records how the account was created / last linked.
  authProvider: text().notNull().default("password"),
  googleSub: text().unique(), // Google `sub` claim (stable id), set once the account is linked
  totpSecret: text(), // base32 TOTP secret (2FA); set once enabled
  totpEnabled: boolean().notNull().default(false),
  createdAt: createdAt(),
});

export const storeUsers = pgTable(
  "store_users",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: storeUserRole().notNull().default("staff"),
    invitedAt: ts(),
    acceptedAt: ts(),
  },
  (t) => [unique().on(t.storeId, t.userId)],
);

export const locations = pgTable("locations", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  address: text(),
  isDefault: boolean().notNull().default(false),
});

// ---------- catalog: products ----------
export const products = pgTable(
  "products",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    title: text().notNull(),
    handle: text().notNull(),
    // The FULL product story — shown in the "Deskripsi Produk" section BELOW the buy box on the PDP.
    description: text(),
    // A one-line HOOK shown next to the price, above the fold (≤200 chars, editor caps it). Keeps the
    // buy actions high on a PDP whose full `description` is long; empty = no hook line.
    shortDescription: text(),
    status: productStatus().notNull().default("active"),
    productType: text(),
    vendor: text(),
    category: text(), // the MERCHANT's own free-text label (their shelves) — NOT a standard taxonomy
    seoTitle: text(), // ≤70 chars (editor caps it); storefront <title> prefers this over `title`
    seoDesc: text(), // ≤160 chars; storefront meta description prefers this over `description`
    // Standard taxonomy for Google/Meta/TikTok feeds (ADR 0011) — separate from `category`.
    // `google_category_id` is Google Product Taxonomy's own numeric id; the path is cached for feeds.
    googleCategoryId: integer().references(
      (): AnyPgColumn => productTaxonomy.id,
    ),
    googleCategoryPath: text(),
    // Apparel feed attributes Google/Meta require (ADR 0011 Phase 2). `color`/`size` come from the
    // variant options (Warna/Ukuran), `brand` from the store, `condition` is always "new" — so only
    // these three are stored. Nullable; the feed derives sensible fallbacks (gender via the suggester,
    // age_group "adult") when a merchant hasn't set them.
    gender: text(), // "female" | "male" | "unisex"
    ageGroup: text(), // "newborn" | "infant" | "toddler" | "kids" | "adult"
    material: text(), // free text, e.g. "Katun", "Rayon"
    emoji: text(), // display fallback (mirrors storefront)
    unitsSold: integer().notNull().default(0), // rollup cache (from order_line_items; seeded for demo)
    sizes: jsonb(), // storefront size options e.g. ["S","M","L"] / ["All Size"]
    badge: text(), // storefront ribbon e.g. "Promo" / "Signature"
    bestseller: boolean().notNull().default(false),
    ratingValue: real(), // aggregate review score (storefront)
    ratingCount: integer().notNull().default(0),
    hasVariants: boolean().notNull().default(false),
    // shipping dimensions (cm) for volumetric weight (w×l×h÷6); weight (g) lives on the variant
    lengthCm: integer(),
    widthCm: integer(),
    heightCm: integer(),
    // Which `product`-type page_templates row renders this product's storefront page
    // (ADR 0009 — Store Builder). NULL = the store's default product template.
    templateId: uuid().references((): AnyPgColumn => pageTemplates.id),
    archivedAt: ts(),
    createdAt: createdAt(),
    // N13 — when the merchant last EDITED the row; the sitemap's <lastmod> reads
    // coalesce(updated_at, created_at). NULLABLE with no default ON PURPOSE: a default-now() would
    // stamp migration day onto every existing product as if it had just changed, and a backfill
    // UPDATE inside the migration would overwrite real values if the batch ever re-runs (this repo
    // demands idempotent migrations for exactly that reason). NULL = never edited since the column
    // arrived — created_at is then the honest lastmod. Every db.update on this table sets it.
    updatedAt: ts(),

    // ── Stable catalog identity (ADR 0013, migration 0081) ────────────────────────────────────────
    // The merchant-facing product NUMBER, allocated per store from `store_counters` and never reused.
    // It exists because the ad platforms key a catalog item by the id we send, and every id we had was
    // derived from something the merchant can edit: the handle. Rename a product, reorder its variants
    // or delete one, and the id changed — which to Google and Meta means "that product was deleted and
    // a new one appeared", taking its performance history and its retargeting audiences with it.
    //
    // Per STORE, not global: each merchant owns their own catalog (ADR 0012), so uniqueness is only
    // ever needed inside one store — and a platform-wide counter would publish TokoΦ's total product
    // count on every public `/feed/google.xml`.
    // NO DEFAULT, deliberately. A default would let a future insert path forget to allocate and quietly
    // publish catalog id `0-1` to three ad platforms; the second such product in a store then fails on
    // the unique, naming nothing. Without a default the FIRST offender fails, at the insert, in the
    // code that forgot.
    number: integer().notNull(),
    // High-water mark for this product's variant `seq`. It NEVER decreases: a deleted variant's number
    // is retired forever, because handing it to the next variant re-points a live catalog item at a
    // different SKU — a silent mis-attribution, not an error.
    variantSeqNext: integer().notNull().default(1),
    // Affiliate commission override in basis points (0116). NULL = the store default
    // (`store_settings.affiliate_rate_bps`); 0 is a real "no commission on this product".
    affiliateRateBps: integer(),
  },
  (t) => [unique().on(t.storeId, t.handle), unique().on(t.storeId, t.number)],
);

// Per-store allocation counters. A table of its own rather than a column on `stores`/`store_settings`
// because it is a HOT counter: every product create row-locks it, and parking that lock on a row that
// billing, branding or settings also write is how a save starts waiting on a product insert.
export const storeCounters = pgTable("store_counters", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id),
  // Next product number to hand out. Allocation is ONE statement (insert … on conflict do update …
  // returning), so two concurrent creates in the same store serialise on this row and neither retries.
  productNext: integer().notNull().default(1001),
});

export const productMedia = pgTable("product_media", {
  id: pk(),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  url: text().notNull(),
  alt: text(),
  position: integer().notNull().default(0),
});

export const productOptions = pgTable("product_options", {
  id: pk(),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  name: text().notNull(),
  position: integer().notNull().default(0),
});

export const productVariants = pgTable(
  "product_variants",
  {
    id: pk(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    title: text().notNull().default("Default"),
    sku: text(),
    barcode: text(),
    priceIdr: money().notNull().default(0),
    compareAtIdr: money(),
    costIdr: money(),
    weightGrams: integer(),
    option1: text(),
    option2: text(),
    option3: text(),
    // DISPLAY order. It used to be identity too — the feed's `handle-{n}` ordinal was this column's rank
    // — which meant dragging a variant re-keyed the catalog item. `seq` took that job (ADR 0013); this
    // is now only what it says it is.
    position: integer().notNull().default(0),
    // Stable per-product variant number, allocated from `products.variant_seq_next` and NEVER reused.
    // Deleting the middle of three variants leaves -1 and -3; -2 is retired, because handing it to the
    // next variant would silently re-point a live Meta/Google catalog item at a different SKU.
    // No default, same reasoning as `products.number`.
    seq: integer().notNull(),
  },
  (t) => [unique().on(t.productId, t.seq)],
);

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    id: pk(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid()
      .notNull()
      .references(() => locations.id),
    available: integer().notNull().default(0),
    incoming: integer().notNull().default(0),
    committed: integer().notNull().default(0),
  },
  (t) => [unique().on(t.variantId, t.locationId)],
);

// ---------- catalog: collections ----------
export const collections = pgTable(
  "collections",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    title: text().notNull(),
    handle: text().notNull(),
    description: text(),
    imageUrl: text(),
    emoji: text(),
    type: collectionType().notNull().default("manual"),
    match: collectionMatch().notNull().default("all"),
    published: boolean().notNull().default(true),
    template: text(),
    // Which `category`-type page_templates row renders this collection's storefront page
    // (ADR 0009 — Store Builder). NULL = the store's default category template.
    templateId: uuid().references((): AnyPgColumn => pageTemplates.id),
    seoTitle: text(),
    seoDesc: text(),
    archivedAt: ts(),
    // N13 — same contract as products.updatedAt (nullable, no default, see the comment there).
    // Collections have NO created_at to fall back on, so the sitemap emits <lastmod> for a category
    // only once it has actually been edited — no date beats an invented one.
    updatedAt: ts(),
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] })],
);

export const collectionConditions = pgTable("collection_conditions", {
  id: pk(),
  collectionId: uuid()
    .notNull()
    .references(() => collections.id),
  field: conditionField().notNull(),
  operator: conditionOperator().notNull(),
  value: text().notNull(),
});

// ---------- store builder (ADR 0009) ----------
// One row = one drag-drop template a merchant assembled in the admin's Store Builder (Puck).
// `sections` is an ordered array of { type, config } — `type` keys into the shared section
// registry (both the Puck-editor React component and the storefront's Astro render component
// read the same `config` shape). Rendered live by the storefront's SSR (no rebuild on save).
export const pageTemplates = pgTable("page_templates", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  type: pageTemplateType().notNull(),
  name: text().notNull(),
  sections: jsonb().notNull().default([]),
  // Exactly one `homepage`-type row per store should be the active one (enforced app-side,
  // like the single-active-menu pattern — not a DB constraint, mirrors the rest of this schema).
  isDefault: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

// Single-product direct-order LANDING config (the /promo/<handle> funnel — one row per product the
// merchant turns into a promo page). Content that has no home on `products`: the marketing headline,
// the Manfaat/Ideal-Untuk lists, the countdown + scarcity theatrics. Null overrides fall back to the
// product's own name/description/badge, so a row with only `enabled=true` already renders.
export const promoPages = pgTable(
  "promo_pages",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    enabled: boolean().notNull().default(false),
    headline: text(), // null = use products.title
    subheadline: text(), // null = use products.description
    badge: text(), // null = use products.badge
    benefits: jsonb().notNull().default([]), // string[] — "Manfaat Utama" bullets
    idealFor: jsonb().notNull().default([]), // string[] — "Ideal Untuk" chips
    // Long-form AI-generated sales sections (problem → agitation → solution → guarantee). Optional; a
    // landing renders fine with only the hero fields above. `PromoContent` in lib/data/promo typings.
    content: jsonb().notNull().default({}),
    countdownMinutes: integer().notNull().default(0), // 0 = no countdown
    showScarcity: boolean().notNull().default(true),
    // Which optional order-form elements to show. `FormConfig` in lib/form-config: { email, quantity,
    // trustBadges, summary }. The 4 core COD fields (nama/wa/alamat/kecamatan) are always shown.
    formConfig: jsonb().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [unique().on(t.storeId, t.productId)],
);

// Custom-HTML LANDING page (/lp/<slug>). Unlike promo_pages (auto-built from a product), the merchant
// pastes their own full landing HTML and picks ONE product to attach the checkout to — the storefront
// renders the HTML then appends the shared OrderFunnel bound to that product. Keyed by a merchant-chosen
// slug, not the product handle, so one product can back several landings (different angles/ads).
export const landingPages = pgTable(
  "landing_pages",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    slug: text().notNull(), // URL segment: /lp/<slug>
    title: text().notNull(), // <title> / OG
    html: text().notNull().default(""), // the pasted custom landing markup (body content)
    productId: uuid()
      .notNull()
      .references(() => products.id), // the product the checkout orders
    enabled: boolean().notNull().default(false),
    countdownMinutes: integer().notNull().default(0),
    showScarcity: boolean().notNull().default(true),
    formConfig: jsonb().notNull().default({}), // see promo_pages.formConfig
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [unique().on(t.storeId, t.slug)],
);

// ---------- suppliers & purchasing ----------
export const suppliers = pgTable("suppliers", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  contact: text(),
  phone: text(),
  email: text(),
});

// ⚠️ `code` is unique PER STORE (0084). Globally unique was actively broken here: the code is
// `PO-${Date.now().toString().slice(-6)}`, which REPEATS every ~16.7 minutes, so two purchase orders
// created anywhere on the platform at the same point in that cycle collided and the second failed.
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    supplierId: uuid().references(() => suppliers.id),
    code: text().notNull(),
    status: poStatus().notNull().default("draft"),
    totalIdr: money().notNull().default(0),
    etaDate: date(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.storeId, t.code)],
);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: pk(),
  purchaseOrderId: uuid()
    .notNull()
    .references(() => purchaseOrders.id),
  variantId: uuid().references(() => productVariants.id),
  qty: integer().notNull().default(0),
  costIdr: money().notNull().default(0),
  receivedQty: integer().notNull().default(0),
});

export const stockTransfers = pgTable("stock_transfers", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  fromLocation: uuid().references(() => locations.id),
  toLocation: uuid().references(() => locations.id),
  status: transferStatus().notNull().default("draft"),
  createdAt: createdAt(),
});

// ---------- orders & fulfillment ----------
// A shopper. NOT a login — buying never requires an account, and it must not: forcing a
// registration wall in front of an Indonesian checkout is the single most reliable way to lose the
// sale. A customer row is created the moment someone buys, account or not.
//
//   registeredAt = NULL  → GUEST (bought without an account; identified by phone/email)
//   registeredAt set     → has an account (can see their orders, save addresses)
//
// The identity that actually matters here is the PHONE. Indonesian shoppers give a WhatsApp number
// far more reliably than an email, and WhatsApp is the channel every follow-up actually travels on.
export const customers = pgTable("customers", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  email: text(),
  phone: text(),
  city: text(),
  province: text(),
  ordersCount: integer().notNull().default(0),
  totalSpentIdr: money().notNull().default(0),
  segment: customerSegment().notNull().default("baru"),
  tags: jsonb(), // string[] labels (CRM)
  notes: text(), // internal note
  // Account, or not (0044). NULL = guest. `passwordHash` is scrypt `salt:hash`, same as `users`.
  registeredAt: ts(),
  passwordHash: text(),
  lastOrderAt: ts(),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Abandoned checkout (0044).
//
// Indonesia abandons ~82-83% of carts — well above the ~70% global figure. We were recording NONE
// of them: no cart table existed at all. So the single biggest pool of nearly-made sales was
// invisible — and the CRM was already showing "keranjang ditinggal" follow-ups with NO CART BEHIND
// THEM, telling merchants to chase a basket that never existed.
//
// The row is written PROGRESSIVELY as the shopper fills the checkout in, not at some final "abandon"
// event — there is no such event. Abandonment is the ABSENCE of one: a session that stops updating
// and never becomes an order IS the abandonment.
//
// Recovery in Indonesia travels on WhatsApp, not email. That is why `phone` is the field that
// matters most here, and why a session carrying a phone but no order is worth more than a hundred
// anonymous carts. `wa_templates` already holds a `keranjang` template — it finally has something
// real to point at.
// ─────────────────────────────────────────────────────────────────────────────
export const checkoutStatus = pgEnum("checkout_status", [
  "aktif",
  "ditinggal",
  "pulih",
  "kedaluwarsa",
]);
export const checkoutStep = pgEnum("checkout_step", [
  "keranjang",
  "kontak",
  "alamat",
  "pengiriman",
  "pembayaran",
]);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  // The storefront session id the funnel events already use, so a cart joins to its own journey.
  sessionId: text().notNull(),
  customerId: uuid().references(() => customers.id),

  // Whatever had been typed before they left. Partial ON PURPOSE: a name and a phone with no address
  // is still a recoverable sale — arguably the most recoverable kind there is.
  name: text(),
  phone: text(),
  email: text(),
  address: text(),
  city: text(),
  province: text(),
  postcode: text(),
  districtId: integer(),

  // Snapshot, so a later price change cannot rewrite what the shopper actually saw.
  items: jsonb(), // [{handle,name,variant,qty,price}]
  subtotalIdr: money().notNull().default(0),
  shippingIdr: money().notNull().default(0),

  step: checkoutStep().notNull().default("keranjang"),
  status: checkoutStatus().notNull().default("aktif"),
  // Stamped when the session goes quiet and is judged abandoned (0045). WITHOUT this, a cart that
  // converted straight through and one that was genuinely RESCUED are indistinguishable after the
  // fact — both end up `pulih`, and a "recovery rate" built on that counts every ordinary sale as a
  // save. That is a number that looks real and lies.
  //   rescued  = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL
  //   straight = abandoned_at IS NULL     AND recovered_at IS NOT NULL
  abandonedAt: ts(),
  // Set when this session BECAME an order. That is what "recovered" means — anything else is a guess.
  recoveredOrderId: uuid(),
  recoveredAt: ts(),

  createdAt: createdAt(),
  updatedAt: ts(),
});

export const orders = pgTable("orders", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  number: text().notNull().unique(),
  customerId: uuid().references(() => customers.id),
  status: orderStatus().notNull().default("baru"),
  // Set when status becomes `retur`. `returnReason` is why it came back — for a COD parcel that is
  // almost always "pembeli menolak", and it is the number the SPX-only COD policy is betting on.
  // With `courier` already on this row, the COD return rate per courier becomes a `group by`.
  returnedAt: ts(),
  returnReason: text(),
  financialStatus: financialStatus().notNull().default("pending"),
  channel: orderChannel().notNull().default("organic"),
  subtotalIdr: money().notNull().default(0),
  discountIdr: money().notNull().default(0),
  shippingIdr: money().notNull().default(0),
  taxIdr: money().notNull().default(0),
  totalIdr: money().notNull().default(0),
  city: text(),
  province: text(),

  // ── Shipping address SNAPSHOT (migration 0042) ─────────────────────────────
  // An order must carry the address it was SHIPPED TO, frozen at purchase. It used to carry only
  // `city`/`province` and the street was looked up from `customer_addresses` — which lives on the
  // CUSTOMER and changes. So when a buyer moved house, every past order silently moved with them:
  // reprint a label for an old parcel and it goes to the new address. 624 of 685 orders already had
  // a customer address in a DIFFERENT city from the order's destination — the model was drifting in
  // production, quietly.
  //
  // This is why an order snapshot is not an optimisation: the address is part of the transaction,
  // not part of the person.
  shipRecipient: text(),
  shipPhone: text(),
  shipAddress: text(), // street + RT/RW
  shipPostcode: text(),
  // The KiriminAja district the ongkir was quoted against and the parcel is booked to. The
  // authoritative destination — a typed city name is a claim, a district id is what the courier acts on.
  shipDistrictId: integer(),
  // The destination subdistrict, in BOTH id spaces the sender side already keeps apart (Task 8.17).
  //
  // `shipKelurahanName` is the NAME the shopper picked, snapshotted onto the order for the same reason
  // the street is: it belongs to the transaction, not the person. `shipKelurahanId` is KiriminAja's
  // OWN subdistrict id — never the Kemendagri code `kelurahan.id` — and is what `v6.2/request_pickup`
  // accepts as `destination_kelurahan_id`.
  //
  // ⚠️ BOTH ARE NULL FOR MOST ORDERS, BY DESIGN, AND THAT IS NOT A GAP TO CLOSE IN THE CHECKOUT.
  // The kelurahan picker is shown only where it changes the answer: 5 520 of 6 735 districts (82,0%)
  // have exactly ONE postcode across every village in them, so the kodepos is filled from the
  // district alone and the shopper is never asked which village. Asking anyway would add a required
  // choice to an Indonesian checkout to gain a field the courier already books without. NULL here
  // means "not asked", not "failed" — the booking omits the field exactly as it always has.
  shipKelurahanName: text(),
  shipKelurahanId: integer(),
  // Task 4.8 — the storefront checkout session this order came from, and the DATABASE's guarantee
  // that a session buys at most once: `orders_one_per_checkout_session`, a PARTIAL unique index on
  // (store_id, checkout_session_id) (migration 0097). NULL for an order that did not come from a
  // session, and NULLs do not collide. TEXT, not uuid: this is `checkout_sessions.session_id`, the
  // string the storefront generates and the API receives — not that row's primary key.
  checkoutSessionId: text(),

  // KiriminAja shipment (set when "Buat Pengiriman" succeeds)
  awb: text(),
  // The courier's SORTING / ROUTING code for this waybill (0110). Required on the label for SPX, ID
  // Express, J&T and J&T Cargo (KiriminAja, 2026-09-14). It belongs to the AWB, so it is cleared with
  // it. Written ONLY by `syncOrderFromKa` — from the verified tracking pull, or from a webhook
  // `processed_packages` row whose awb equals the verified waybill. Issued in production only; the
  // sandbox answers null. NULL = not issued yet, and the label shows the slot as missing.
  sortingCode: text(),
  courier: text(),
  // WHICH service of that courier the shopper bought — "spx" alone is ambiguous (SPX Standard type 1
  // = `regular`, SPX Economy type 3 = `economy`: different products, different prices). Recorded by
  // /api/public/order from the fresh quote it already matched on. Joins to
  // platform_couriers.services[].type, which is what carries `group` (1 day / reguler / ekonomi /
  // cargo). Rows created before 0053 were backfilled with DUMMY values — see that migration.
  serviceType: text(),
  // When the seller printed this order's label. NULL = never printed — the honest default, and the
  // anchor for the marketplace-style "sudah/belum dicetak" filter (Pengiriman Massal). A timestamp,
  // not a boolean: "when" answers reprints and cut-off questions that "whether" cannot.
  // ⚠️ It records that WE RENDERED the label, not that a printer consumed paper — we cannot observe
  // the printer. Say "ditandai dicetak", never "berhasil dicetak" (cf. the CRM's "WA dibuka").
  labelPrintedAt: ts(),
  // The courier has flagged this parcel (tracking status 500 / 7xx–9xx → outcome `problem`).
  // NOT an order_status: a stuck parcel is neither delivered nor returned, and forcing it into the
  // enum would move money (`selesai` collects COD) or fake a terminal state. The order stays
  // `dikirim` — which is true — and this flag rides alongside it.
  // `problem_at` is the FIRST poll that saw the obstacle and is not re-stamped while it persists,
  // so it reads "macet sejak", not "terakhir dicek".
  // ⚠️ BOTH clear back to NULL the moment a later poll shows the parcel moving again (ka-tracking.ts).
  // A flag that never clears becomes wallpaper; a problem that resolved is not a problem.
  problemAt: ts(),
  // The courier's reason, already in merchant-facing Indonesian. A short sentence, never a payload
  // dump — the raw tracking response goes to the cron log, never into this column.
  problemNote: text(),
  kaOrderId: text(),
  // ── What the COURIER's own booking costs, and who settles it ─────────────────────────────────
  // ONE booking call carries TWO different money flows, and conflating them is how a parcel sits
  // unpaid while every screen reads "dibooking":
  //   · NON-COD — WE owe KiriminAja the shipping cost. `payment_method` defaults to `va`, so the
  //     booking answers with `payment_status` (unpaid | pending | paid) and, while unpaid, a
  //     `qr_url` to settle it. An unpaid booking is not a shipped parcel: no waybill is issued,
  //     the poller keeps finding nothing, and nothing on any screen said why.
  //   · COD — KiriminAja collects from the BUYER and settles to the merchant. The vendor documents
  //     that `payment_method` is IGNORED for COD packages ("the system will automatically use the
  //     COD settlement scheme"), so there is no VA for us to pay.
  // These columns store what the vendor ACTUALLY returned, verbatim and uninterpreted. Which of the
  // two flows an order is on is not re-derived from them — `apps/admin/lib/shipment-payment.ts` is
  // the ONE place that separates the two, and it decides from the order's own COD flag.
  kaPickupNumber: text(), // vendor `pickup_number` — and the `payment_id` the Payment API takes
  kaPaymentStatus: text(), // vendor `payment_status`, as sent. NULL = the booking predates 0088
  kaPaymentUrl: text(), // vendor `qr_url` — where a non-COD booking gets paid
  // What the courier was actually told to charge for carrying this parcel. DISTINCT from
  // `shipping_idr`, which is what the SHOPPER paid at checkout: the seller may book a different or
  // cheaper service than the shopper picked, and until now nothing recorded the difference — the DB
  // held the revenue side of ongkir and no cost side at all. Recording it does not move any money;
  // it is the prerequisite BACKLOG.md already names for ever computing a real ongkir margin, and
  // for modelling what KiriminAja nets out of a COD remittance.
  kaShippingCostIdr: money(),
  placedAt: createdAt(),
}, (t) => [
  index("orders_store_placed_idx").on(t.storeId, t.placedAt),
]);

// Immutable checkout-time allocation. This is the audit source for seller proceeds; the legacy
// orders.discount_idr remains a compatibility total but cannot distinguish goods from shipping.
export const orderFinancials = pgTable(
  "order_financials",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    goodsDiscountIdr: money().notNull().default(0),
    shippingDiscountIdr: money().notNull().default(0),
    includedSalesTaxIdr: money().notNull().default(0),
    goodsProceedsIdr: money().notNull().default(0),
    shippingChargedIdr: money().notNull().default(0),
    codFeeBeforeVatIdr: money().notNull().default(0),
    codFeeVatIdr: money().notNull().default(0),
    codFeeFinalIdr: money().notNull().default(0),
    orderPayableIdr: money().notNull().default(0),
    expectedGatewayFeeIdr: money().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.orderId),
    index("order_financials_store_idx").on(t.storeId),
  ],
);

// Append-only shipment history. A provider reference is persisted before the external call, so an
// accepted booking can be reconciled even if the post-call local transaction fails.
export const shipmentBookings = pgTable(
  "shipment_bookings",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    providerReference: text().notNull().unique(),
    providerBookingId: text().unique(),
    courier: text().notNull(),
    serviceType: text().notNull(),
    serviceName: text().notNull(),
    status: shipmentBookingStatus().notNull().default("reserved"),
    shippingChargedIdr: money().notNull().default(0),
    shippingActualIdr: money().notNull().default(0),
    shippingDeltaIdr: money().notNull().default(0),
    sellerDebitIdr: money().notNull().default(0),
    platformMarginIdr: money().notNull().default(0),
    failureNote: text(),
    acceptedAt: ts(),
    voidedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index("shipment_bookings_store_order_idx").on(t.storeId, t.orderId),
    uniqueIndex("shipment_one_active_per_order")
      .on(t.orderId)
      .where(
        sql`${t.status} in ('reserved', 'unknown', 'accepted', 'cancellation_requested')`,
      ),
  ],
);

export const orderLineItems = pgTable("order_line_items", {
  id: pk(),
  orderId: uuid()
    .notNull()
    .references(() => orders.id),
  variantId: uuid().references(() => productVariants.id),
  title: text().notNull(),
  qty: integer().notNull().default(1),
  priceIdr: money().notNull().default(0),
  totalIdr: money().notNull().default(0),
}, (t) => [
  index("order_line_items_order_idx").on(t.orderId),
]);

export const payments = pgTable("payments", {
  id: pk(),
  orderId: uuid()
    .notNull()
    .references(() => orders.id),
  method: paymentMethod().notNull(),
  amountIdr: money().notNull().default(0),
  status: paymentStatus().notNull().default("menunggu"),
  paidAt: ts(),
  // AutoLaris payment-gateway (VA/QRIS/DANA) — platform-managed PSP.
  // storeId is NOT NULL (0036): it is the RLS key. A nullable tenant key is a silent hole —
  // a row with store_id = NULL matches no tenant policy and belongs to nobody.
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  provider: text(),
  reffId: text(),
  trxId: text(),
  channelCode: text(),
  adminFee: money().default(0),
  total: money().default(0),
  virtualAccount: text(),
  qr: text(),
  url: text(),
  paymentCode: text(),
  // Durable idempotency claim for payment-intent creation. Legacy/provider-created rows remain NULL:
  // no caller-stable request identity can be reconstructed honestly after the fact.
  requestKey: text(),
  requestState: paymentRequestState(),
  requestError: text(),
  requestUpdatedAt: ts(),
}, (t) => [
  index("payments_trx_idx")
    .on(t.trxId)
    .where(sql`${t.trxId} is not null`),
  index("payments_reff_idx")
    .on(t.reffId)
    .where(sql`${t.reffId} is not null`),
  index("payments_order_idx").on(t.orderId),
  uniqueIndex("payments_store_request_key_unique")
    .on(t.storeId, t.requestKey)
    .where(sql`${t.requestKey} is not null`),
]);

export const fulfillments = pgTable("fulfillments", {
  id: pk(),
  orderId: uuid()
    .notNull()
    .references(() => orders.id),
  courier: text(),
  trackingNo: text(),
  status: fulfillmentStatus().notNull().default("menunggu"),
  shippedAt: ts(),
});

// ---------- customers extras ----------
export const customerAddresses = pgTable("customer_addresses", {
  id: pk(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  label: text(),
  recipient: text(),
  phone: text(),
  address: text(),
  city: text(),
  province: text(),
  postcode: text(),
});

export const customerSegments = pgTable("customer_segments", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  description: text(),
  rule: jsonb(),
  memberCount: integer().notNull().default(0),
  growth: real().notNull().default(0),
});

export const reviews = pgTable("reviews", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  customerId: uuid().references(() => customers.id),
  productId: uuid().references(() => products.id),
  productName: text(), // denormalized display (some demo reviews reference legacy, non-catalog products)
  emoji: text(),
  rating: integer().notNull().default(5),
  body: text(),
  reply: text(), // the seller's public reply, shown on the PDP under the review; NULL = not replied
  status: reviewStatus().notNull().default("menunggu"),
  createdAt: createdAt(),
});

// ---------- CRM ----------
export const leads = pgTable("leads", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  phone: text(),
  source: leadSource().notNull().default("whatsapp"),
  stage: leadStage().notNull().default("baru"),
  valueIdr: money().notNull().default(0),
  note: text(),
  lastContactAt: ts(),
});

export const followups = pgTable("followups", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  customerId: uuid().references(() => customers.id),
  phone: text(),
  type: followupType().notNull(),
  context: text(),
  dueAt: ts(),
  status: followupStatus().notNull().default("menunggu"),
  lastMessage: text(),
  sentAt: ts(),
});

export const waTemplates = pgTable("wa_templates", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  type: text(),
  body: text().notNull(),
});

export const waMessages = pgTable("wa_messages", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  followupId: uuid().references(() => followups.id),
  leadId: uuid().references(() => leads.id),
  phone: text(),
  body: text(),
  sentAt: ts(),
});

// ---------- discounts ----------
// ⚠️ `code` is unique PER STORE (0084), not globally. A bare `.unique()` here meant the first merchant
// to register a string owned it across the whole platform — and Indonesian promo codes collide
// constantly (GAJIAN, DISKON10, GRATISONGKIR). The rejection also told the second merchant the code was
// taken, which is a working way to probe a competitor's codes. Reads were always store-scoped.
export const discounts = pgTable(
  "discounts",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    code: text().notNull(),
    kind: discountKind().notNull(),
    value: integer().notNull().default(0),
    minPurchaseIdr: money().notNull().default(0),
    usageLimit: integer(),
    usedCount: integer().notNull().default(0),
    startsAt: ts(),
    endsAt: ts(),
    status: discountStatus().notNull().default("aktif"),
  },
  (t) => [unique().on(t.storeId, t.code)],
);

export const discountUsages = pgTable("discount_usages", {
  id: pk(),
  discountId: uuid()
    .notNull()
    .references(() => discounts.id),
  orderId: uuid().references(() => orders.id),
  usedAt: createdAt(),
});

// ---------- flash sale (PROMO P3) ----------
// A time-boxed price drop on chosen products. The window is [startsAt, endsAt); `status` is the merchant's
// switch (a `nonaktif` sale never runs even inside its window). "Active NOW" = status <> 'nonaktif' AND now in
// the window — computed at read time, never stored, so the clock alone flips it on and off.
export const flashSales = pgTable("flash_sales", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  name: text().notNull(),
  startsAt: ts().notNull(),
  endsAt: ts().notNull(),
  status: discountStatus().notNull().default("terjadwal"),
});

// One row per product in the sale. `salePriceIdr` is the ABSOLUTE promo price and applies to every variant
// of the product — /api/public/order uses it ONLY when it is below the variant's base price (a sale never
// raises a price). No `store_id`: tenancy comes from the parent `flash_sales` row (CHILD-TABLE RULE —
// writes must read the parent inside the same withTenant txn and bail if it is not the tenant's).
// lazy: per-product flat price — fine while products are single-variant (the demo). Upgrade to per-variant
// (key on variant_id) when a multi-variant product needs distinct sale prices per size/colour.
export const flashSaleItems = pgTable(
  "flash_sale_items",
  {
    id: pk(),
    flashSaleId: uuid()
      .notNull()
      .references(() => flashSales.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    salePriceIdr: money().notNull(),
  },
  (t) => [unique().on(t.flashSaleId, t.productId)],
);

// ---------- content (Toko Online) ----------
export const pages = pgTable(
  "pages",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    title: text().notNull(),
    handle: text().notNull(),
    body: text(),
    status: contentStatus().notNull().default("draft"),
    template: text().default("page"),
    views: integer().notNull().default(0),
    updatedAt: createdAt(),
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

export const blogs = pgTable("blogs", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  title: text().notNull(),
  handle: text().notNull(),
});

export const articles = pgTable(
  "articles",
  {
    id: pk(),
    blogId: uuid()
      .notNull()
      .references(() => blogs.id),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    title: text().notNull(),
    handle: text().notNull(),
    body: text(),
    excerpt: text(),
    author: text(),
    imageUrl: text(),
    status: contentStatus().notNull().default("draft"),
    comments: integer().notNull().default(0),
    seoTitle: text(),
    seoDesc: text(),
    publishedAt: ts(),
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

export const menus = pgTable(
  "menus",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    name: text().notNull(),
    handle: text().notNull(),
  },
  // One handle per store, and the DATABASE is what says so (migration 0099). `saveMenu` allocates
  // under `pg_advisory_xact_lock(4707, hashtext(store_id))` (Task 4.7), which serialises that ONE
  // code path — an import, or a future action that forgets the lock, would collide silently. A lock
  // is a protocol; an index is a rule. Total rather than partial: `handle` is NOT NULL here.
  (t) => [uniqueIndex("menus_store_handle_unique").on(t.storeId, t.handle)],
);

export const menuItems = pgTable("menu_items", {
  id: pk(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id),
  parentId: uuid().references((): AnyPgColumn => menuItems.id),
  label: text().notNull(),
  type: menuItemType().notNull().default("url"),
  target: text(),
  position: integer().notNull().default(0),
});

// ---------- marketing & analytics ----------
export const adChannels = pgTable("ad_channels", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  key: adChannelKey().notNull(),
  name: text(),
  brand: text(),
  connected: boolean().notNull().default(false),
  pixelLabel: text(),
  pixelId: text(),
  pixelActive: boolean().notNull().default(false),
  capiEnabled: boolean().notNull().default(false),
  spendIdr: money().notNull().default(0), // aggregate rollup cache (period)
  impressions: integer().notNull().default(0),
  clicks: integer().notNull().default(0),
  conversions: integer().notNull().default(0),
  revenueIdr: money().notNull().default(0),
  campaigns: jsonb(), // AdCampaign[] { name, spend, conversions, revenue }
});

export const adMetrics = pgTable("ad_metrics", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  channelKey: adChannelKey(), // null = province rollup across all channels
  date: date().notNull(),
  province: text(),
  spendIdr: money().notNull().default(0),
  impressions: integer().notNull().default(0),
  clicks: integer().notNull().default(0),
  conversions: integer().notNull().default(0),
  revenueIdr: money().notNull().default(0),
  reach: integer().notNull().default(0),
});

// Per-store marketing-pixel / conversion-tracking config — the REAL setup behind Pemasaran → Pelacakan
// (which was disabled placeholders). One row per (store, channel). DISTINCT from `ad_channels`, whose
// pixel/spend columns are seeded DEMO and deliberately unread (see lib/data/marketing.ts) — this table
// is the merchant's live config that the storefront actually fires from. The pixel/tag id is PUBLIC (it
// ships in storefront JS) so it is plaintext; `capiTokenCiphertext` is a SECRET → AES-256-GCM, server
// only, never selected into a client component. RLS by store_id (migration 0079).
export const storeTrackingChannels = pgTable(
  "store_tracking_channels",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    channel: adChannelKey().notNull(), // meta | google | tiktok
    enabled: boolean().notNull().default(false), // merchant switched browser tracking on
    pixelId: text(), // Meta Pixel ID · GA4 Measurement ID (G-XXXX) · TikTok Pixel ID — PUBLIC
    capiEnabled: boolean().notNull().default(false), // server-side events (CAPI / MP / Events API) on
    capiTokenCiphertext: text(), // Meta CAPI · GA4 Measurement Protocol · TikTok Events API token — encrypted
    advancedMatching: boolean().notNull().default(true), // DEAD RECORD since 2026-08-24 (owner: always on) — written true on save, read nowhere; kept because dropping is destructive
    testEventCode: text(), // optional Meta test_event_code for CAPI debugging
    // Google Ads only, and it is what makes Google Ads actually WORK (migration 0082).
    //
    // `pixel_id` for this channel holds the analytics tag — a GA4 `G-…` Measurement ID. Google Ads is a
    // different product with a different id AND a per-action conversion label, and `gtag('event',
    // 'purchase', …)` alone records nothing there: Google documents a conversion as
    // `gtag('event','conversion',{send_to:'AW-123456789/AbC-D_efGh'})`. So the merchant pastes that
    // destination here, and a store can run GA4 and Google Ads at the same time — which is the whole
    // point of "mix and match" and was impossible with one field.
    adsSendTo: text(),
    // `google_business_vertical` is required on every dynamic-remarketing item; "retail" is the only
    // value that applies to a commerce catalog, so it is not a merchant question — recorded here as a
    // reminder of where the value comes from rather than as a column.
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [unique().on(t.storeId, t.channel)],
);

// Server-side conversion delivery queue (ADR 0012 §9.4/§23, migration 0080). THIS TABLE IS THE QUEUE —
// TokoΦ has no worker process, so `api/cron/tracking-events` drains it on a schedule, exactly like
// `api/cron/tracking` drains shipments. One row = one (store, channel, event) we owe a provider.
//
// Why a table and not a fire-and-forget POST inside the order path: a conversion that fails because
// Meta 500'd must be RETRIED, and a conversion sent twice corrupts the merchant's ROAS. The unique
// (store_id, channel, event_id) is what makes both true at once — the enqueue is idempotent (an
// AutoLaris callback retry cannot double-book a Purchase) and the send is resumable.
//
// `eventId` is the SHARED browser/server id (`purchase:{orderNumber}`) — the storefront pixel
// sends the same string as `eventID`, which is how Meta/TikTok de-duplicate the two copies of one sale.
// Deliberately NO raw identity columns: emails/phones are hashed inside the sender and never persisted
// here (§9.4 + §25 data minimisation). `payload` holds only commerce facts (value/currency/content ids).
export const trackingDeliveryStatus = pgEnum("tracking_delivery_status", [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "dead_letter",
]);

export const trackingEventDeliveries = pgTable(
  "tracking_event_deliveries",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    channel: adChannelKey().notNull(), // meta | google | tiktok
    eventName: text().notNull(), // Purchase (MVP) — the normalized name, mapped per provider in the sender
    // Shared with the browser pixel so the provider de-duplicates instead of double-counting.
    eventId: text().notNull(),
    orderId: uuid().references(() => orders.id),
    status: trackingDeliveryStatus().notNull().default("queued"),
    attemptCount: integer().notNull().default(0),
    // Backoff clock. The cron only picks rows whose next attempt is due, so a failing provider does not
    // starve the batch — it steps aside and the queue keeps moving.
    nextAttemptAt: createdAt(),
    deliveredAt: ts(),
    // Commerce facts only — value/currency/contentIds/numItems/orderNumber, plus the hashed-identity
    // OPT-IN flag. Never an email, phone, token or provider response body.
    payload: jsonb().notNull().default({}),
    lastErrorCode: text(),
    lastErrorMessage: text(), // sanitized, truncated — never a raw provider payload
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    // Idempotency: one delivery per (store, channel, event). The enqueue is ON CONFLICT DO NOTHING.
    unique().on(t.storeId, t.channel, t.eventId),
    // The cron's claim query: due rows, oldest first.
    index("tracking_event_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    // The Admin diagnostics query.
    index("tracking_event_deliveries_store_idx").on(t.storeId, t.createdAt),
    index("tracking_event_deliveries_order_idx").on(t.orderId),
  ],
);

// Storefront funnel events. `type` is one of: visit | product_view | add_to_cart | checkout_start
// | purchase. `device` (0037) is what makes the Perangkat breakdown a real COUNT instead of the
// hardcoded 78/18/4 it used to be. The storefront tracker WRITES here (apps/storefront/src/pages/
// api/track.ts, since b7ae0ff) as shoppers browse; the seed also populates it so every funnel/device
// number on /analitik is genuinely counted from rows, in dev and in prod alike.
export const analyticsEvents = pgTable("analytics_events", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  ts: createdAt(),
  type: text().notNull(),
  sessionId: text(),
  device: text(), // ponsel | desktop | tablet
});

// 🔴 RETIRED 2026-08-03 — NOTHING READS THIS TABLE AND NOTHING WRITES IT.
//
// It was the Dashboard/Analitik daily series. Its only writer in the entire repository was
// `seed.ts`: no cron, no order hook, no backfill. So it was empty for every store the seed did not
// create (six of the seven demo stores, and every store made through `/daftar` or the super-admin —
// i.e. every real merchant), and frozen on the seed's last day for the one it did. The series is
// now derived from `orders` (+ `analytics_events` for visitors) at read time — see the header of
// `apps/admin/lib/data/analytics.ts` for the shape and the alternatives that were rejected.
//
// The TABLE is kept rather than dropped: dropping it is a destructive migration, and rows already
// in an existing database are now inert (no reader). Do not point anything at it again, and do not
// "restore" the seed insert — that is what made money on the Dashboard disagree with money in
// Pesanan.
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    date: date().notNull(),
    salesIdr: money().notNull().default(0),
    orders: integer().notNull().default(0),
    visitors: integer().notNull().default(0),
  },
  (t) => [unique().on(t.storeId, t.date)],
);

// ---------- settings (store + platform-managed) ----------
// ─────────────────────────────────────────────────────────────────────────────
// Saldo — the merchant's money, and the book that tracks it (migration 0040).
//
// Until now TokoΦ collected payments on the merchant's behalf and kept NO RECORD of what it
// owed them. The Saldo chip in the topbar was `sum(payments)` — a number, not a ledger. You
// cannot answer "which of my money has settled, which is still in transit, which came back as
// a return?" from a sum.
//
// One signed entry per movement; the balance is derived, never stored:
//   sale     +amount  status 'pending'   → money owed once the order sticks
//   sale     +amount  status 'available' → released (see RELEASE RULE below)
//   retur    -amount  status 'available' → the parcel came back; claw the credit back
//   payout   -amount  status 'available' → paid out to the merchant's bank
//
//   saldo tersedia = Σ amount WHERE status = 'available'
//   dana dalam proses = Σ amount WHERE status = 'pending'
//
// RELEASE RULE — the decision that matters most. Funds are released when the order reaches
// `selesai`, NOT when it is `dikirim`. Releasing on despatch looks generous and is a trap:
//   · `retur` can only happen to an order that already SHIPPED. Release on despatch and the
//     merchant can withdraw money for a parcel that later comes back — the platform eats it.
//   · For COD it is worse: at "dikirim" the cash does not EXIST yet. The courier collects at
//     the door and settles days later. Crediting there is crediting money nobody has.
// It is a platform setting (`platform_payout.release_on`) rather than a constant, so it can be
// loosened without a deploy — but it defaults to the safe end on purpose.
export const ledgerKind = pgEnum("ledger_kind", [
  "sale",
  "retur",
  "payout",
  "adjustment",
]);
export const ledgerStatus = pgEnum("ledger_status", ["pending", "available"]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  orderId: uuid().references(() => orders.id),
  // The payment that actually collected the money (migration 0041). A `sale` entry exists because
  // a shopper PAID — so the entry points at the payment, and a partial unique index
  // (ledger_one_sale_per_payment) makes a second credit for the same payment physically
  // impossible. Gateway callbacks retry; buttons get double-clicked. The guarantee lives in the
  // DB, not in the hope that the caller fires exactly once.
  paymentId: uuid().references(() => payments.id),
  shipmentBookingId: uuid().references(() => shipmentBookings.id),
  component: text(),
  payoutId: uuid(),
  kind: ledgerKind().notNull(),
  status: ledgerStatus().notNull().default("pending"),
  // SIGNED, in IDR. Positive = owed to the merchant, negative = taken back or paid out. Money is
  // never edited in place — a mistake is corrected with a new opposing entry, so the book stays
  // append-only and auditable.
  amountIdr: money().notNull().default(0),
  note: text(),
  createdAt: createdAt(),
  availableAt: ts(),
}, (t) => [
  uniqueIndex("ledger_one_sale_per_order")
    .on(t.orderId)
    .where(sql`kind = 'sale'`),
  uniqueIndex("ledger_one_retur_per_order")
    .on(t.orderId)
    .where(sql`kind = 'retur'`),
  index("ledger_store_status_idx").on(t.storeId, t.status),
  uniqueIndex("ledger_one_sale_per_payment")
    .on(t.paymentId)
    .where(sql`kind = 'sale'`),
]);

export const payoutStatus = pgEnum("payout_status", [
  "menunggu",
  "diproses",
  "selesai",
  "gagal",
]);

export const payouts = pgTable("payouts", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  amountIdr: money().notNull().default(0),
  status: payoutStatus().notNull().default("menunggu"),
  // Snapshotted from store_settings at request time: if the merchant later edits their bank
  // details, a historical payout must still show where the money actually went.
  bankName: text(),
  bankAccount: text(),
  bankHolder: text(),
  note: text(),
  requestedAt: createdAt(),
  paidAt: ts(),
});

// ── Refund obligations (0112, Task 8.31) ──────────────────────────────────────────────────────
// A paid prepaid order that is cancelled owes the BUYER their money. Written ONLY by
// `applyOrderStatusChange` (same transaction as the seller claw-back), settled by hand from Super
// Admin → Pencairan. Never COD. One OPEN row per payment (partial unique index in 0112).
export const refundStatus = pgEnum("refund_status", ["menunggu", "diproses", "selesai", "gagal"]);
export const refunds = pgTable(
  "refunds",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    /** `payments.amount_idr` at cancellation — pre-gateway-fee; the gateway's admin fee is not ours to refund. */
    amountIdr: money().notNull().default(0),
    status: refundStatus().notNull().default("menunggu"),
    /** Why the money is owed ("Pesanan dibatalkan" / the return reason) — set at creation. */
    reason: text(),
    /** `selesai` ⇒ the bank-transfer reference; `gagal` ⇒ the refusal reason. Keyed by terminal status, like payouts. */
    note: text(),
    requestedAt: createdAt(),
    paidAt: ts(),
  },
  (t) => ({
    storeIdx: index("refunds_store_idx").on(t.storeId),
    orderIdx: index("refunds_order_idx").on(t.orderId),
  }),
);

// ── Store affiliate programme (0116, specs/AFFILIATE_SPEC.md) ─────────────────────────────────────
// The merchant pays affiliates OUTSIDE TokoΦ: nothing here touches `ledger_entries` or `payouts`.
export const affiliateStatus = pgEnum("affiliate_status", ["menunggu", "aktif", "ditolak", "nonaktif"]);
export const affiliateCommissionStatus = pgEnum("affiliate_commission_status", [
  "pending",
  "dibayar",
  "batal",
]);
// ── TokoΦ Account (0117, specs/docs/TOKOPHI_ACCOUNT_SPEC.md §17.9) ─────────────────────────────────
// One platform identity per person (buyer area + affiliate area of apps/account). Cross-tenant: no
// store_id, no RLS — apps/account reads only with an explicit buyer_id predicate (§17.8 D-4).
export const buyerAccounts = pgTable("buyer_accounts", {
  id: pk(),
  /** Google `sub`. `dev:<email>` only from the local dev sign-in, which refuses production builds. */
  googleSub: text().unique(),
  email: text(),
  /** Canonical `62…`, set only by phase-2 phone verification. */
  phone: text().unique(),
  phoneVerifiedAt: ts(),
  name: text(),
  /** active | suspended | closed (check constraint in 0117). */
  status: text().notNull().default("active"),
  createdAt: createdAt(),
});
export const buyerSessions = pgTable(
  "buyer_sessions",
  {
    id: pk(),
    buyerId: uuid()
      .notNull()
      .references(() => buyerAccounts.id),
    createdAt: createdAt(),
    lastSeenAt: createdAt(),
    revokedAt: ts(),
    userAgent: text(),
  },
  (t) => [index("buyer_sessions_buyer_idx").on(t.buyerId)],
);
// ── TokoΦ Account buyer half (0118, §17.9, Tasks 10.5–10.9) ─────────────────────────────────────────
// A claim (one claimant per order) + the store link it consents to are the ONLY bridge from an
// account to a store's orders — never an email/phone match. Both carry store_id ⇒ tenant RLS policy.
export const buyerStoreLinks = pgTable(
  "buyer_store_links",
  {
    id: pk(),
    buyerId: uuid()
      .notNull()
      .references(() => buyerAccounts.id),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    customerId: uuid().references(() => customers.id),
    /** active | revoked (check constraint in 0118). */
    status: text().notNull().default("active"),
    consentVersion: text().notNull(),
    consentedAt: createdAt(),
    revokedAt: ts(),
    /** token (phase 1) | phone (phase 2). */
    claimMethod: text().notNull().default("token"),
    createdAt: createdAt(),
  },
  (t) => [unique("buyer_store_links_buyer_id_store_id_unique").on(t.buyerId, t.storeId), index("buyer_store_links_store_idx").on(t.storeId)],
);
export const buyerOrderClaims = pgTable(
  "buyer_order_claims",
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id),
    buyerId: uuid()
      .notNull()
      .references(() => buyerAccounts.id),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    claimedAt: createdAt(),
  },
  (t) => [index("buyer_order_claims_buyer_idx").on(t.buyerId, t.storeId)],
);
export const buyerAddresses = pgTable(
  "buyer_addresses",
  {
    id: pk(),
    buyerId: uuid()
      .notNull()
      .references(() => buyerAccounts.id),
    label: text(),
    recipient: text().notNull(),
    phone: text().notNull(),
    address: text().notNull(),
    /** KiriminAja district id — the same currency as `orders.ship_district_id`. */
    districtId: integer()
      .notNull()
      .references((): AnyPgColumn => kiriminajaAreas.id),
    kelurahan: text(),
    postalCode: text().notNull(),
    isPrimary: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("buyer_addresses_buyer_idx").on(t.buyerId),
    uniqueIndex("buyer_addresses_one_primary").on(t.buyerId).where(sql`${t.isPrimary}`),
  ],
);

export const affiliates = pgTable(
  "affiliates",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    /** Upper-case, `[A-Z0-9]{3,20}` — what the shopper types and what `?ref=` carries. Unique per store. */
    code: text().notNull(),
    name: text().notNull(),
    /** Canonical `62…` (normalizePhone) — also the self-referral check against the buyer's phone. */
    phone: text().notNull(),
    email: text(),
    bankName: text(),
    bankAccount: text(),
    bankHolder: text(),
    status: affiliateStatus().notNull().default("menunggu"),
    /** Applicant's pitch (where they promote) or the merchant's note. */
    note: text(),
    createdAt: createdAt(),
    approvedAt: ts(),
    /** TokoΦ Account owning this per-store row (0117) — one account, many stores. Set by applying while
     *  signed in or by accepting the seller's invitation; NEVER by email/phone match. */
    accountId: uuid().references((): AnyPgColumn => buyerAccounts.id),
    /** sha256 of the seller-issued invitation token (single use: cleared on accept). */
    inviteHash: text(),
    inviteExpiresAt: ts(),
  },
  (t) => [
    unique().on(t.storeId, t.code),
    index("affiliates_store_status_idx").on(t.storeId, t.status),
    unique("affiliates_store_id_account_id_unique").on(t.storeId, t.accountId),
    index("affiliates_account_idx").on(t.accountId),
    uniqueIndex("affiliates_invite_hash_idx").on(t.inviteHash).where(sql`${t.inviteHash} is not null`),
  ],
);
export const affiliateCommissions = pgTable(
  "affiliate_commissions",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    affiliateId: uuid()
      .notNull()
      .references(() => affiliates.id),
    /** One commission per order, ever — the database's guarantee, not a check-then-write. */
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id),
    /** `kode` = typed at checkout · `link` = captured `?ref=`. */
    source: text().notNull(),
    /** Goods value after discount that the rate applied to (frozen at order time). */
    baseIdr: money().notNull().default(0),
    commissionIdr: money().notNull().default(0),
    /** Human-readable rate snapshot, e.g. "10%" or "10% / 20% (per produk)". */
    rateNote: text(),
    status: affiliateCommissionStatus().notNull().default("pending"),
    /** Set when the order reaches `selesai` (+ hold days). Pending AND eligible_at <= now() = payable. */
    eligibleAt: ts(),
    paidAt: ts(),
    paidNote: text(),
    createdAt: createdAt(),
  },
  (t) => [index("affiliate_commissions_store_idx").on(t.storeId, t.status)],
);

// Platform-side payout policy (single row).
export const platformPayout = pgTable("platform_payout", {
  id: pk(),
  // 'selesai' (safe, default) | 'dikirim' (loose — see the warning above)
  releaseOn: text().notNull().default("selesai"),
  minPayoutIdr: money().notNull().default(50_000),
  // Withdrawals are reviewed, not automatic: a payout is the one irreversible thing here.
  autoApprove: boolean().notNull().default(false),
});

export const storeSettings = pgTable("store_settings", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id),
  // PPN on storefront sales. OFF by default — opt-in, so no existing store starts charging tax; the
  // order API only applies it (orders.tax_idr) when tax_enabled=true. Rate is the merchant's PPN %.
  taxEnabled: boolean().notNull().default(false),
  taxRatePct: integer().notNull().default(11),
  taxInclusive: boolean().notNull().default(false),
  // Where a payout is sent. Nothing can be withdrawn until these are filled in.
  bankName: text(),
  bankAccount: text(),
  bankHolder: text(),
  // KiriminAja sender/pickup address (origin for creating shipments)
  senderName: text(),
  senderPhone: text(),
  senderAddress: text(),
  senderKecamatanId: integer(),
  senderKecamatanName: text(),
  senderKelurahanId: integer(),
  senderKelurahanName: text(),
  // Postcode of the chosen kelurahan. KiriminAja's `request_pickup` SENDER has no zipcode field
  // (only `destination_zipcode`, for the buyer), so this is NOT sent as its own key — it rides in the
  // written pickup `address` that the rider actually reads, together with the kelurahan name. That is
  // its reader; without that it would be another dead column like senderLat/senderLng below.
  senderPostcode: text(),
  // DEAD COLUMNS — instant/same-day delivery (GoSend/Grab) was removed and it was the only feature
  // that needed coordinates. Nothing reads or writes these; kept only to avoid a destructive
  // migration. Do not wire them back up.
  senderLat: text(),
  senderLng: text(),
  // Enabled courier codes offered to shoppers (KiriminAja codes: sicepat/jne/jnt/spx/lion/…).
  // NULL = all couriers KiriminAja returns for the route (backward-compatible default).
  couriers: text().array(),
  // Payment channel codes the merchant offers (AutoLaris codes). NULL = all platform-enabled.
  paymentChannels: text().array(),
  // Who bears the payment-gateway fee on storefront transactions: seller | buyer | split.
  paymentFeeBearer: text().notNull().default("seller"),
  // COD (bayar di tempat) — one switch for the whole store, surfaced on the Pengiriman page.
  // OFF by default: COD ties up the merchant's cash until the courier settles, so it is an opt-in.
  // Which SERVICES may carry it is not a merchant choice — KiriminAja reports a per-service `cod`
  // flag (see kaServices()), and the platform narrows that further. See ADR/BACKLOG.
  codEnabled: boolean().notNull().default(false),
  /** Working days after receipt the store accepts a return request (2–90, check in 0119/0120; floor = PP 80/2019 Pasal 69(1)). NULL = not declared. */
  returnWindowDays: integer(),
  // Automatic free shipping (PROMO P1) — when enabled, an order whose goods subtotal ≥ free_ship_min_idr
  // gets its ongkir zeroed by /api/public/order (server-priced, never a client claim). 0 min = always.
  freeShipEnabled: boolean().notNull().default(false),
  freeShipMinIdr: money().notNull().default(0),
  // Promo hub (/promo) banner copy — merchant-configurable (PROMO P4b). Null → the storefront falls back
  // to sensible defaults ("Promo" / "Semua Promo, Satu Halaman"), so the page always renders.
  promoHubTitle: text(),
  promoHubSubtitle: text(),
  promoHubBannerUrl: text(),
  // Store affiliate programme (0116, specs/AFFILIATE_SPEC.md). OFF by default: an existing store never
  // starts paying commissions it did not choose. Rate in BASIS POINTS (1000 = 10%) — integers, so a
  // commission is never a float. Hold days = the return window before a commission is payable.
  affiliateEnabled: boolean().notNull().default(false),
  affiliateRateBps: integer().notNull().default(1000),
  affiliateHoldDays: integer().notNull().default(3),
});

export const platformPaymentGateways = pgTable("platform_payment_gateways", {
  id: pk(),
  provider: gatewayProvider().notNull(),
  // DEAD: nothing reads it (kept, not dropped). The live key is `credentialsEnc` (0111).
  credentials: jsonb(),
  enabled: boolean().notNull().default(false),
  isCod: boolean().notNull().default(false),
  // Task 8.33 (0111): AutoLaris key encrypted at rest (scope provider:autolaris:key). NULL = env fallback.
  credentialsEnc: text(),
  testedAt: ts(),
});

// Platform reference: KiriminAja district (kecamatan) map — `id` = KiriminAja area id used by
// shipping_price / request_pickup. Lets us resolve area names → id locally (no API rate limit).
export const kiriminajaAreas = pgTable("kiriminaja_areas", {
  id: integer().primaryKey(),
  districtName: text().notNull(),
  cityId: integer(),
  cityType: text(),
  cityName: text().notNull(),
  provinceId: integer(),
  provinceName: text().notNull(),
  // Centroid of the kecamatan this district was matched to (0109; scripts/build-area-coords.mjs).
  // Sent as the v6.2 booking's coordinates when no kelurahan is known — the honest point for an
  // address we only know to the district. NULL (~4%: districts with no kelurahan rows) ⇒ omitted.
  lat: doublePrecision(),
  lng: doublePrecision(),
});

// Kelurahan (village) + its postcode, under a KiriminAja district. Migration 0046 created the
// table but the Drizzle definition never landed with it, so `schema.kelurahan` did not exist and
// apps/admin/lib/data/areas.ts could not compile. Reference data, not store-scoped (no RLS).
export const kelurahan = pgTable(
  "kelurahan",
  {
    // ⚠️ TWO ID SPACES LIVE ON THIS ROW AND THEY ARE NOT INTERCHANGEABLE.
    // `id` is a **Kemendagri** village code — text, dotted, 13 characters ("34.02.07.2001"), built
    // by `packages/db/scripts/build-kelurahan.mjs` and joined to KiriminAja's districts BY NAME. It
    // is the key the POSTCODE dataset is published under, which is the only reason this table
    // exists, so it can never be overwritten with a vendor id.
    id: text().primaryKey(),
    districtId: integer()
      .notNull()
      .references(() => kiriminajaAreas.id),
    name: text().notNull(),
    postcode: text().notNull(),
    // KiriminAja's OWN subdistrict id (`POST /api/mitra/kelurahan` → `results[].id`) — a small
    // integer (31483), nothing like the dotted code above. This is the ONLY value that may ever be
    // sent as `kelurahan_id` / `destination_kelurahan_id` to `v6.2/request_pickup`; sending the
    // Kemendagri code there would be a WRONG id, which is worse than an absent one.
    // NULLABLE on purpose: the vendor has no subdistrict data for part of its own district list,
    // and a name match can fail. NULL means "we do not know it" and the caller omits the field.
    kaKelurahanId: integer(),
    // Village centroid from the Kemendagri boundaries dataset, keyed by `id` (0109). The most
    // precise coordinate this product can honestly claim for a shopper's address; the booking
    // sends it as destination_latitude/longitude (or latitude/longitude for the seller). NULL ⇒
    // fall back to the district centroid, then omit — never 0,0.
    lat: doublePrecision(),
    lng: doublePrecision(),
  },
  // The ONLY access pattern: "give me the kelurahan of the district the shopper just picked".
  // 78k rows, read on every checkout — without this it is a seq scan (25ms) per selection.
  (t) => ({
    districtIdx: index("kelurahan_district_idx").on(t.districtId),
  }),
);

// Google Product Taxonomy (ADR 0011) — GLOBAL reference data, NOT store-scoped (no RLS, same class
// as kiriminaja_areas/kelurahan). `id` IS Google's own numeric category id; seeded from the committed
// packages/db/data/google-taxonomy.en-US.txt via seed-taxonomy.ts. Products reference it by id.
export const productTaxonomy = pgTable(
  "product_taxonomy",
  {
    id: integer().primaryKey(), // Google's numeric id (e.g. 2271 = Apparel > Clothing > Dresses)
    path: text().notNull(), // "Apparel & Accessories > Clothing > Dresses"
    name: text().notNull(), // leaf: "Dresses"
    parentId: integer(),
    isLeaf: boolean().notNull().default(true),
  },
  // The picker searches by path substring; ILIKE on 5.6k rows is fine but the index keeps it snappy.
  (t) => ({ pathIdx: index("product_taxonomy_path_idx").on(t.path) }),
);

export const shippingAggregator = pgTable("shipping_aggregator", {
  id: pk(),
  provider: aggregatorProvider().notNull(),
  // DEAD: nothing reads it (kept, not dropped). The live keys are the *_key_enc columns (0111).
  apiKey: text(),
  enabled: boolean().notNull().default(false),
  // Task 8.33 (0111): per-environment KiriminAja keys encrypted at rest, the env the platform books
  // against, and when each stored key last passed a live test. NULL key = fall back to env.
  sandboxKeyEnc: text(),
  productionKeyEnc: text(),
  activeEnv: text().notNull().default("sandbox"),
  // 0115: the order_id prefix is per ACCOUNT (= per env). Row > KIRIMINAJA_ORDER_PREFIX env > code default.
  sandboxOrderPrefix: text(),
  productionOrderPrefix: text(),
  sandboxTestedAt: ts(),
  productionTestedAt: ts(),
});

export const platformCouriers = pgTable("platform_couriers", {
  id: pk(),
  courier: text().notNull(),
  services: jsonb(),
  enabled: boolean().notNull().default(true),
});

// AutoLaris payment channels the platform offers (like platform_couriers). enabled = shown at
// checkout. `active` = last live-probe result (whether AutoLaris actually accepts the channel).
// Single-row platform finance settings (0101). `subscriptionPpnEnabled` DEFAULT FALSE is the
// owner's launch ruling (2026-08-24): subscription invoices bill flat DPP until Super Admin turns
// PPN on. Enforced at INVOICE CREATION — issued invoices are never rewritten.
export const platformFinance = pgTable("platform_finance", {
  id: smallint().primaryKey().default(1),
  subscriptionPpnEnabled: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const platformPaymentChannels = pgTable("platform_payment_channels", {
  id: pk(),
  channel: text().notNull(),
  label: text().notNull(),
  kind: text().notNull(),
  enabled: boolean().notNull().default(false),
  active: boolean().notNull().default(false),
});

export const platformCod = pgTable("platform_cod", {
  id: pk(),
  enabled: boolean().notNull().default(false),
  maxAmountIdr: money().notNull().default(0),
  allowedProvinces: jsonb(),
  // Dead column: no pricing/checkout/ledger code reads this (Task 5.19 / F-S10).
  // Do not activate without the owner decision + provider evidence this task requires.
  feePct: integer().notNull().default(0),
});

export const storePaymentMethods = pgTable(
  "store_payment_methods",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    method: text().notNull(),
    enabled: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.storeId, t.method)],
);

export const storeShippingMethods = pgTable(
  "store_shipping_methods",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id),
    courier: text().notNull(),
    service: text().notNull(),
    enabled: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.storeId, t.courier, t.service)],
);

export const domains = pgTable("domains", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  hostname: text().notNull(),
  verified: boolean().notNull().default(false),
});

export const notificationTemplates = pgTable("notification_templates", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  event: text().notNull(),
  channel: notificationChannel().notNull(),
  subject: text(),
  body: text(),
});

// ---------- platform & billing (super-admin control plane) ----------
export const plans = pgTable("plans", {
  id: pk(),
  key: planKey().notNull().unique(),
  name: text().notNull(),
  priceIdr: money().notNull().default(0),
  blurb: text(),
  features: jsonb(),
});

export const invoices = pgTable("invoices", {
  id: pk(),
  number: text().notNull().unique(),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  storeId: uuid().references(() => stores.id),
  // LEGACY (0114): single-plan product; defaulted so no creator names a tier. Never read for pricing.
  planKey: planKey().notNull().default("bisnis"),
  amountIdr: money().notNull().default(0),
  // PPN carried by THIS invoice, stored at creation (0101) — the faktur renders the stored value,
  // never a derivation: since the platform PPN toggle exists, "total / 1.11" would invent tax on a
  // toggle-off invoice. Backfilled for historical rows, which were all PPN-inclusive.
  taxIdr: money().notNull().default(0),
  status: invoiceStatus().notNull().default("menunggu"),
  // subscription payment (AutoLaris VA) matching + kind
  // "subscription" = a bill the merchant pays · "comp" = a period the platform GRANTED (0113):
  // amount 0, status dibayar, cycle "comp", written by compStore and backfilled from the audit log,
  // so MRR can tell a comp from a payment · NULL = seeded legacy rows. Free text on purpose (an enum
  // ADD VALUE has no IF NOT EXISTS and aborts the whole pending batch).
  kind: text(),
  cycle: text(), // "monthly" | "annual"
  periodMonths: integer(), // how many months this invoice extends the subscription (1/12/13)
  reffId: text(),
  trxId: text(),
  channel: text(), // chosen payment channel (VABCA/QRIS/…) — lets an unpaid invoice resume its payment
  virtualAccount: text(),
  qr: text(), // QRIS payload (rendered to a QR image when resuming)
  paymentUrl: text(),
  paidAt: ts(),
  issuedAt: createdAt(),
});

export const platformActivity = pgTable("platform_activity", {
  id: pk(),
  kind: platformActivityKind().notNull(),
  text: text().notNull(),
  storeId: uuid().references(() => stores.id), // nullable: null = platform-wide, set = per-store audit
  ts: createdAt(),
});

// ---------- cron liveness — ONE row per sidecar, overwritten every tick (0091) ----------
//
// `cron-tracking` is what makes a waybill appear without the merchant pressing anything, and its own
// compose comment records `awbFilled` sitting at 0 for a WEEK while it was not running. It printed a
// timestamp per tick — to `docker logs`, which nobody opens without a reason, so the first person who
// noticed would have been a merchant on the phone about a resi that never came.
//
// ⚠️ ONE ROW PER JOB, UPSERTED — deliberately not an append-only log, and deliberately not
// `platform_activity`. That table is the operator's audit FEED, rendered on the dashboard: at one row
// per tick these three would write ~1.630 rows a day (tracking-events alone wakes every 60 s) and bury
// every real event under them, and nothing prunes it. The question this table answers is "is it alive
// RIGHT NOW", which needs exactly one row, never grows, and costs one PK lookup to read.
//
// `interval_sec` is REPORTED BY THE SIDECAR (`?every=<seconds>`), never guessed here: the staleness
// threshold has to come from the loop's own `sleep`, and a second copy of "900" in application code is
// a copy that goes stale the day someone changes the compose file. NULL = the caller did not say, and
// the reader must then decline to judge rather than invent a number.
//
// `result` is the endpoint's own run summary ({scanned, advanced, awbFilled, …}). A cron that runs on
// time and fills nothing, every time, is also a failure — "it ran" alone cannot show that.
export const cronRuns = pgTable("cron_runs", {
  job: text().primaryKey(), // "tracking" | "tracking-events" | "billing"
  lastRunAt: createdAt(),
  intervalSec: integer(), // the sidecar's own sleep, in seconds; NULL = not reported
  ok: boolean().notNull().default(true),
  durationMs: integer(),
  result: jsonb(),
});

// Rate limits, counted ACROSS replicas and ACROSS restarts (Task 6.3 / NF-6, migration 0106).
//
// One row per limiter key ("<bucket>:<subject>", e.g. `login:admin:1.2.3.4`), bumped by a single
// `insert ... on conflict do update ... returning` so the read, the window roll and the increment
// are atomic under the row lock. The statement itself lives in
// `packages/lib/src/rate-limit-store.ts` — drizzle has no expression for that upsert, and splitting
// it into a select then an update restores the race `markPayoutPaid` already paid for. This table is
// modelled here for schema parity only; nothing queries it through drizzle.
//
// NO `store_id`, and that is correct: an unauthenticated shopper, a sign-in that has not happened yet
// and a payment callback have no tenant. RLS is ENABLED WITH NO POLICY (same setting as
// `impersonation_grants`, 0098) — the owner connection is the only writer and `tokophi_app` has no
// business reading anyone's counter. That is also why `verify-rls` check 6 does not flag it.
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text().primaryKey(),
    windowStart: ts().notNull(),
    count: integer().notNull().default(0),
    /** Only for the opportunistic sweep. A live key's expiry is pushed forward on every bump. */
    expiresAt: ts().notNull(),
  },
  (t) => [index("rate_limit_counters_expires_idx").on(t.expiresAt)],
);

// Platform operators (US) — the super-admin's own login, separate from store `users`.
export const platformAdmins = pgTable("platform_admins", {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  passwordHash: text(), // scrypt "salt:hash" (local auth)
  // Rotating an operator's password ends every session that password opened. Same rule, same trigger
  // FUNCTION and the same pure comparison as `users.password_changed_at` (0087) — the control plane
  // got it in 0088, the migration that also gave operators a way to change their own password at
  // all. Written ONLY by `platform_admins_stamp_password_changed_at`; never set it from a query.
  // NULL = never rotated → nothing to revoke.
  passwordChangedAt: ts(),
  role: text().notNull().default("owner"),
  createdAt: createdAt(),
});

/**
 * ---------- impersonation exchanges (0098) — a handle that is SPENT, not verified ----------
 *
 * 🔴 THIS TABLE EXISTS BECAUSE A JWT CANNOT BE CONSUMED. "Buka Dashboard Seller" used to put a
 * session-shaped, `AUTH_SECRET`-signed token in the query string and let `/impersonate` verify it.
 * Verification is stateless by definition, so the same URL worked again — from history, from a
 * `Referer`, from a proxy log, from a pasted ticket — for its whole two-minute life. Replay was not
 * a defect in the route; there was nowhere to record that the link had already been used.
 *
 * A row can be spent. `consume` is ONE statement:
 *
 *   update impersonation_grants set consumed_at = now()
 *    where token_hash = $1 and consumed_at is null and expires_at > now() returning …
 *
 * One row updated = the exchange happened, exactly once. Zero rows = unknown handle, already spent,
 * or expired — three causes, one fail-closed answer. Postgres takes the row lock, so two concurrent
 * redemptions of the same handle cannot both win: the loser blocks, re-evaluates the predicate after
 * the winner commits, and matches nothing. (Same idiom as `receivePurchaseOrder`'s claim.)
 *
 * ⚠️ THE PLAINTEXT HANDLE IS NEVER STORED — only `sha256(handle)`, so this table is worth nothing to
 * anyone who reads it. See `@tokophi/lib/impersonation` for why an unsalted digest is right for a
 * 256-bit random input and wrong for a password.
 *
 * ⚠️ RLS IS ENABLED WITH **NO POLICY**, AND THAT IS THE STRICTEST SETTING, NOT AN OVERSIGHT. This is
 * control-plane material: it is written by the super-admin and read by the admin's *pre-session*
 * auth path, both on the OWNER connection (which bypasses RLS — no table here uses FORCE). The
 * merchant role `tokophi_app` has no business seeing a grant for its own store, let alone anyone
 * else's, and with RLS on and no policy it sees zero rows. A policy keyed on `app.store_id` would be
 * strictly WEAKER and would read like protection. `verify-rls` check 5 is satisfied by
 * `relrowsecurity`, so this needs no entry on its exception list.
 *
 * ⚠️ NOTHING PRUNES THIS TABLE and nothing needs to yet: a row is ~200 bytes and an impersonation is
 * a rare, owner-ranked act. The rows are also the audit trail of who was handed a key to which shop,
 * which is worth keeping — `platform_activity` records the outcome, this records the offer.
 */
export const impersonationGrants = pgTable(
  "impersonation_grants",
  {
    id: pk(),
    /** sha256 hex of the opaque handle. The handle itself lives only in the redirect URL. */
    tokenHash: text().notNull(),
    /** The store being entered, and the OWNER row whose session will be minted. Both re-read at
     *  consume time — a grant is a permission to exchange, never a cached fact about membership. */
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** WHO asked. Carried into the minted session so a merchant write made under impersonation
     *  names the operator as well as the merchant. */
    operatorId: uuid()
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
    /** Denormalised on purpose: the audit line must still read correctly after the operator row is
     *  deleted, and the email is what a human recognises. The id above is the identity. */
    operatorEmail: text().notNull(),
    /** The rank at mint time. The consume path refuses if the live row no longer matches — a
     *  demotion inside the exchange window kills the handle, without copying the rank LADDER into
     *  `apps/admin` (it lives in `apps/super-admin/lib/platform-rank.ts` and must stay one copy). */
    operatorRole: text().notNull(),
    expiresAt: ts().notNull(),
    /** NULL = never redeemed. The single field that makes replay impossible. */
    consumedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    // UNIQUE, not just an index: two rows sharing a hash would make "spend the one row" ambiguous.
    uniqueIndex("impersonation_grants_token_hash_key").on(t.tokenHash),
    index("impersonation_grants_store_idx").on(t.storeId),
  ],
);

// ---------- media library (Shopify-style Files) — all uploaded images for a store ----------
export const media = pgTable("media", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  url: text().notNull(), // /api/uploads/<name>
  filename: text().notNull(), // original filename (display)
  mime: text().notNull(),
  sizeBytes: integer().notNull().default(0),
  width: integer(),
  height: integer(),
  createdAt: createdAt(),
});

// ---------- custom merchant domains (CNAME) — CUSTOM_DOMAIN.md ----------
// Holds ONLY custom hosts. `<slug>.tokophi.com` is NOT a row — it is derived (slug + base domain), and
// storing it would create a second place a store's identity can drift from its slug.
//
// `host` is UNIQUE across the whole platform — THE security invariant: two stores cannot both claim
// toko.com, and it is what stops one merchant hijacking another's (or a bank's) domain once verified.
// RLS ships in the same migration or `verify-rls` (which derives the store-scoped set from the catalog)
// goes red. The storefront resolves the host on the OWNER connection (no session → no GUC), exactly as
// getStoreByHost() already does.
export const storeDomains = pgTable(
  "store_domains",
  {
    id: pk(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    host: text().notNull(), // normalised: lowercase, no scheme/port/trailing dot
    status: storeDomainStatus().notNull().default("pending"),
    isPrimary: boolean().notNull().default(false), // at most ONE per store (partial unique index)
    verificationToken: text().notNull(), // 32 hex, generated on insert
    verifiedAt: ts(), // when OUR txt check passed
    providerId: text(), // Cloudflare custom-hostname id (opaque)
    certStatus: text(), // mirror of the provider ssl status
    lastError: text(), // surfaced verbatim in the admin UI
    lastCheckedAt: ts(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => ({
    hostKey: uniqueIndex("store_domains_host_key").on(t.host),
    storeIdx: index("store_domains_store_idx").on(t.storeId),
    // at most one primary per store — partial unique
    onePrimary: uniqueIndex("store_domains_one_primary")
      .on(t.storeId)
      .where(sql`is_primary`),
  }),
);

// ---------- support tickets (2-sided: merchant ↔ platform) ----------
export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "answered",
  "closed",
]);
export const supportTickets = pgTable("support_tickets", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  subject: text().notNull(),
  status: ticketStatus().notNull().default("open"), // open = awaiting platform · answered = platform replied · closed
  lastMessageAt: createdAt(),
  createdAt: createdAt(),
});
export const supportMessages = pgTable("support_messages", {
  id: pk(),
  ticketId: uuid()
    .notNull()
    .references(() => supportTickets.id),
  // denormalized on purpose: every RLS policy (0012) keys on store_id (migration 0035).
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  sender: text().notNull(), // "merchant" | "platform"
  body: text().notNull(),
  createdAt: createdAt(),
});

// ---------- shopper ⇄ merchant chat, "Obrolan" (migration 0043 — specs/docs/CHAT_SPEC.md) ----------
//
// A SECOND message axis, deliberately NOT support_tickets widened (DECISION 1): the other party
// here is an ANONYMOUS shopper, so there is a third isolation dimension (visitor_id) that a
// support ticket does not have, plus a spam surface, a block-list and an upgrade path to
// `customers` — none of which belongs on a ticket row. The volume shapes differ by ~100×, and the
// hot path (chat polling) must not share indexes with the cold one.
export const chatVisitorStatus = pgEnum("chat_visitor_status", [
  "active",
  "blocked",
]);
export const conversationStatus = pgEnum("conversation_status", [
  "open",
  "snoozed",
  "closed",
]);
export const messageSender = pgEnum("message_sender", [
  "customer",
  "merchant",
  "system",
]);

// The subject of the shopper's signed `tokophi_chat` cookie (`vid`). Created on the FIRST message,
// never on page load — a bot that never types leaves no row.
export const chatVisitors = pgTable("chat_visitors", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  customerId: uuid().references(() => customers.id), // set on identity upgrade (checkout)
  name: text(), // what the shopper typed ("Nama") — only if they typed it
  phone: text(),
  status: chatVisitorStatus().notNull().default("active"),
  ipHash: text(), // sha256(ip + AUTH_SECRET) — abuse tracking only, never the raw IP
  userAgent: text(),
  firstSeenAt: createdAt(),
  lastSeenAt: createdAt(),
  createdAt: createdAt(),
});

export const conversations = pgTable("conversations", {
  id: pk(),
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  visitorId: uuid()
    .notNull()
    .references(() => chatVisitors.id),
  customerId: uuid().references(() => customers.id), // denormalized on upgrade (fast inbox join)
  orderId: uuid().references(() => orders.id),
  status: conversationStatus().notNull().default("open"),
  assignedUserId: uuid().references(() => users.id),
  // Counters, not a scan: the inbox badge is one sum(), maintained in the same txn as the insert.
  unreadMerchant: integer().notNull().default(0),
  unreadVisitor: integer().notNull().default(0),
  lastMessageAt: createdAt(),
  lastMessageBody: text(), // inbox preview, truncated to 140 chars on write
  entryUrl: text(),
  productHandle: text(),
  createdAt: createdAt(),
});

export const conversationMessages = pgTable("conversation_messages", {
  id: pk(),
  conversationId: uuid()
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  // DENORMALIZED on purpose: every RLS policy keys on store_id (0012). A join-based policy would be
  // slower and inconsistent with the other 38 store-scoped tables. support_messages got this wrong
  // (fixed in 0035) — don't repeat it.
  storeId: uuid()
    .notNull()
    .references(() => stores.id),
  sender: messageSender().notNull(),
  senderUserId: uuid().references(() => users.id), // which staff replied (null for customer/system)
  body: text().notNull(), // ≤ 2000 chars, checked in the action/route (not a CHECK)
  readAt: ts(), // when the OTHER side read it
  createdAt: createdAt(),
});

// ---------- inferred types (Row = select, New* = insert) ----------
export type Account = typeof accounts.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type StoreStats = typeof storeStats.$inferSelect;
export type User = typeof users.$inferSelect;
export type StoreUser = typeof storeUsers.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductMedia = typeof productMedia.$inferSelect;
export type InventoryLevel = typeof inventoryLevels.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type PageTemplate = typeof pageTemplates.$inferSelect;
export type NewPageTemplate = typeof pageTemplates.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type OrderFinancial = typeof orderFinancials.$inferSelect;
export type ShipmentBooking = typeof shipmentBookings.$inferSelect;
export type Fulfillment = typeof fulfillments.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Followup = typeof followups.$inferSelect;
export type Discount = typeof discounts.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Blog = typeof blogs.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Menu = typeof menus.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type AdChannel = typeof adChannels.$inferSelect;
export type AdMetric = typeof adMetrics.$inferSelect;
export type StoreSettings = typeof storeSettings.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type PlatformActivity = typeof platformActivity.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type ChatVisitor = typeof chatVisitors.$inferSelect;
export type NewChatVisitor = typeof chatVisitors.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
