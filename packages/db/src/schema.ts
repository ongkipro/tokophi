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
  bigint,
  real,
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
const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const ts = () => timestamp({ withTimezone: true });

// ---------- enums ----------
export const planKey = pgEnum("plan_key", ["pemula", "bisnis", "skala"]);
export const storeStatus = pgEnum("store_status", ["trial", "active", "past_due", "suspended"]);
export const storeUserRole = pgEnum("store_user_role", ["owner", "admin", "staff", "gudang"]);
export const productStatus = pgEnum("product_status", ["active", "draft", "archived"]);
export const collectionType = pgEnum("collection_type", ["manual", "otomatis"]);
export const collectionMatch = pgEnum("collection_match", ["all", "any"]);
export const conditionField = pgEnum("condition_field", ["tag", "title", "type", "price", "stock", "category"]);
export const conditionOperator = pgEnum("condition_operator", ["eq", "neq", "gt", "lt", "contains"]);
export const poStatus = pgEnum("po_status", ["draft", "dipesan", "sebagian", "diterima"]);
export const transferStatus = pgEnum("transfer_status", ["draft", "dikirim", "diterima", "batal"]);
// `retur` = the parcel came back: refused at the door (the classic COD failure), address dead, or
// the buyer bounced it. It is NOT `batal` — a cancelled order never shipped, a returned one did,
// and someone paid to move it twice. Keeping them apart is what makes the COD return rate
// measurable at all (migration 0039).
export const orderStatus = pgEnum("order_status", ["baru", "diproses", "dikirim", "selesai", "batal", "retur"]);
export const financialStatus = pgEnum("financial_status", ["pending", "dibayar", "refund_sebagian", "refund"]);
export const orderChannel = pgEnum("order_channel", ["meta_ads", "tiktok_ads", "google_ads", "organic", "other"]);
export const paymentMethod = pgEnum("payment_method", ["transfer", "qris", "ovo", "gopay", "dana", "va", "cod"]);
export const paymentStatus = pgEnum("payment_status", ["menunggu", "berhasil", "gagal"]);
export const fulfillmentStatus = pgEnum("fulfillment_status", ["menunggu", "diproses", "dikirim", "terkirim", "batal"]);
export const customerSegment = pgEnum("customer_segment", ["baru", "reguler", "loyal", "vip"]);
export const reviewStatus = pgEnum("review_status", ["terbit", "menunggu"]);
export const leadSource = pgEnum("lead_source", ["whatsapp", "instagram", "tiktok", "referral", "marketplace"]);
export const leadStage = pgEnum("lead_stage", ["baru", "dihubungi", "nego", "closing", "menang", "kalah"]);
export const followupType = pgEnum("followup_type", ["keranjang", "pembayaran", "konfirmasi", "pascabeli", "repeat", "ulasan"]);
export const followupStatus = pgEnum("followup_status", ["menunggu", "terkirim", "dibalas", "selesai"]);
export const discountKind = pgEnum("discount_kind", ["persen", "nominal", "gratis_ongkir"]);
export const discountStatus = pgEnum("discount_status", ["aktif", "terjadwal", "nonaktif"]);
export const contentStatus = pgEnum("content_status", ["terbit", "draft"]);
export const menuItemType = pgEnum("menu_item_type", ["home", "collection", "product", "page", "blog", "url", "catalog"]);
export const adChannelKey = pgEnum("ad_channel_key", ["meta", "google", "tiktok"]);
export const gatewayProvider = pgEnum("gateway_provider", ["midtrans", "xendit", "duitku", "autolaris"]);
export const aggregatorProvider = pgEnum("aggregator_provider", ["biteship", "rajaongkir", "shipper", "kiriminaja"]);
export const invoiceStatus = pgEnum("invoice_status", ["dibayar", "menunggu", "gagal"]);
export const platformActivityKind = pgEnum("platform_activity_kind", ["signup", "upgrade", "payment", "churn", "support", "admin"]);
export const notificationChannel = pgEnum("notification_channel", ["email", "wa"]);
export const pageTemplateType = pgEnum("page_template_type", ["homepage", "category", "product"]); // ADR 0009 — Store Builder
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
  accountId: uuid().notNull().references(() => accounts.id),
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
  // Branding read-only by the storefront/checkout (ADR 0009 — checkout is locked/uniform,
  // only pulls these tokens; NOT part of the drag-drop Store Builder).
  logoUrl: text(),
  // Brand hex (e.g. "#a85572") the merchant picks in the Store Builder's colour panel; the
  // storefront derives a full 11-shade scale from it (@tokophi/lib/colors). Null = fall back
  // to the default brand hex baked into apps/storefront/src/styles/global.css.
  brandColor: text(),
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
  createdAt: createdAt(),
});

// Per-store rollup snapshot for the platform control plane (super-admin). A cache of
// metrics that are otherwise aggregated from each store's orders/products — refreshed by a
// job in production; seeded directly for the demo. Keeps platform pages off full scans.
export const storeStats = pgTable("store_stats", {
  storeId: uuid().primaryKey().references(() => stores.id),
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
    storeId: uuid().notNull().references(() => stores.id),
    userId: uuid().notNull().references(() => users.id),
    role: storeUserRole().notNull().default("staff"),
    invitedAt: ts(),
    acceptedAt: ts(),
  },
  (t) => [unique().on(t.storeId, t.userId)],
);

export const locations = pgTable("locations", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  name: text().notNull(),
  address: text(),
  isDefault: boolean().notNull().default(false),
});

// ---------- catalog: products ----------
export const products = pgTable(
  "products",
  {
    id: pk(),
    storeId: uuid().notNull().references(() => stores.id),
    title: text().notNull(),
    handle: text().notNull(),
    description: text(),
    status: productStatus().notNull().default("active"),
    productType: text(),
    vendor: text(),
    category: text(),
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
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

export const productMedia = pgTable("product_media", {
  id: pk(),
  productId: uuid().notNull().references(() => products.id),
  url: text().notNull(),
  alt: text(),
  position: integer().notNull().default(0),
});

export const productOptions = pgTable("product_options", {
  id: pk(),
  productId: uuid().notNull().references(() => products.id),
  name: text().notNull(),
  position: integer().notNull().default(0),
});

export const productVariants = pgTable("product_variants", {
  id: pk(),
  productId: uuid().notNull().references(() => products.id),
  storeId: uuid().notNull().references(() => stores.id),
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
  position: integer().notNull().default(0),
});

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    id: pk(),
    variantId: uuid().notNull().references(() => productVariants.id),
    locationId: uuid().notNull().references(() => locations.id),
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
    storeId: uuid().notNull().references(() => stores.id),
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
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: uuid().notNull().references(() => collections.id),
    productId: uuid().notNull().references(() => products.id),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] })],
);

export const collectionConditions = pgTable("collection_conditions", {
  id: pk(),
  collectionId: uuid().notNull().references(() => collections.id),
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
  storeId: uuid().notNull().references(() => stores.id),
  type: pageTemplateType().notNull(),
  name: text().notNull(),
  sections: jsonb().notNull().default([]),
  // Exactly one `homepage`-type row per store should be the active one (enforced app-side,
  // like the single-active-menu pattern — not a DB constraint, mirrors the rest of this schema).
  isDefault: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

// ---------- suppliers & purchasing ----------
export const suppliers = pgTable("suppliers", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  name: text().notNull(),
  contact: text(),
  phone: text(),
  email: text(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  supplierId: uuid().references(() => suppliers.id),
  code: text().notNull().unique(),
  status: poStatus().notNull().default("draft"),
  totalIdr: money().notNull().default(0),
  etaDate: date(),
  note: text(),
  createdAt: createdAt(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: pk(),
  purchaseOrderId: uuid().notNull().references(() => purchaseOrders.id),
  variantId: uuid().references(() => productVariants.id),
  qty: integer().notNull().default(0),
  costIdr: money().notNull().default(0),
  receivedQty: integer().notNull().default(0),
});

export const stockTransfers = pgTable("stock_transfers", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
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
export const checkoutStatus = pgEnum("checkout_status", ["aktif", "ditinggal", "pulih", "kedaluwarsa"]);
export const checkoutStep = pgEnum("checkout_step", ["keranjang", "kontak", "alamat", "pengiriman", "pembayaran"]);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
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

  // KiriminAja shipment (set when "Buat Pengiriman" succeeds)
  awb: text(),
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
  kaOrderId: text(),
  placedAt: createdAt(),
});

export const orderLineItems = pgTable("order_line_items", {
  id: pk(),
  orderId: uuid().notNull().references(() => orders.id),
  variantId: uuid().references(() => productVariants.id),
  title: text().notNull(),
  qty: integer().notNull().default(1),
  priceIdr: money().notNull().default(0),
  totalIdr: money().notNull().default(0),
});

export const payments = pgTable("payments", {
  id: pk(),
  orderId: uuid().notNull().references(() => orders.id),
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
});

export const fulfillments = pgTable("fulfillments", {
  id: pk(),
  orderId: uuid().notNull().references(() => orders.id),
  courier: text(),
  trackingNo: text(),
  status: fulfillmentStatus().notNull().default("menunggu"),
  shippedAt: ts(),
});

// ---------- customers extras ----------
export const customerAddresses = pgTable("customer_addresses", {
  id: pk(),
  customerId: uuid().notNull().references(() => customers.id),
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
  storeId: uuid().notNull().references(() => stores.id),
  name: text().notNull(),
  description: text(),
  rule: jsonb(),
  memberCount: integer().notNull().default(0),
  growth: real().notNull().default(0),
});

export const reviews = pgTable("reviews", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  customerId: uuid().references(() => customers.id),
  productId: uuid().references(() => products.id),
  productName: text(), // denormalized display (some demo reviews reference legacy, non-catalog products)
  emoji: text(),
  rating: integer().notNull().default(5),
  body: text(),
  status: reviewStatus().notNull().default("menunggu"),
  createdAt: createdAt(),
});

// ---------- CRM ----------
export const leads = pgTable("leads", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
  name: text().notNull(),
  type: text(),
  body: text().notNull(),
});

export const waMessages = pgTable("wa_messages", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  followupId: uuid().references(() => followups.id),
  leadId: uuid().references(() => leads.id),
  phone: text(),
  body: text(),
  sentAt: ts(),
});

// ---------- discounts ----------
export const discounts = pgTable("discounts", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  code: text().notNull().unique(),
  kind: discountKind().notNull(),
  value: integer().notNull().default(0),
  minPurchaseIdr: money().notNull().default(0),
  usageLimit: integer(),
  usedCount: integer().notNull().default(0),
  startsAt: ts(),
  endsAt: ts(),
  status: discountStatus().notNull().default("aktif"),
});

export const discountUsages = pgTable("discount_usages", {
  id: pk(),
  discountId: uuid().notNull().references(() => discounts.id),
  orderId: uuid().references(() => orders.id),
  usedAt: createdAt(),
});

// ---------- content (Toko Online) ----------
export const pages = pgTable(
  "pages",
  {
    id: pk(),
    storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
  title: text().notNull(),
  handle: text().notNull(),
});

export const articles = pgTable(
  "articles",
  {
    id: pk(),
    blogId: uuid().notNull().references(() => blogs.id),
    storeId: uuid().notNull().references(() => stores.id),
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

export const menus = pgTable("menus", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  name: text().notNull(),
  handle: text().notNull(),
});

export const menuItems = pgTable("menu_items", {
  id: pk(),
  menuId: uuid().notNull().references(() => menus.id),
  parentId: uuid().references((): AnyPgColumn => menuItems.id),
  label: text().notNull(),
  type: menuItemType().notNull().default("url"),
  target: text(),
  position: integer().notNull().default(0),
});

// ---------- marketing & analytics ----------
export const adChannels = pgTable("ad_channels", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
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

// Storefront funnel events. `type` is one of: visit | product_view | add_to_cart | checkout_start
// | purchase. `device` (0037) is what makes the Perangkat breakdown a real COUNT instead of the
// hardcoded 78/18/4 it used to be. The storefront tracker WRITES here (apps/storefront/src/pages/
// api/track.ts, since b7ae0ff) as shoppers browse; the seed also populates it so every funnel/device
// number on /analitik is genuinely counted from rows, in dev and in prod alike.
export const analyticsEvents = pgTable("analytics_events", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  ts: createdAt(),
  type: text().notNull(),
  sessionId: text(),
  device: text(), // ponsel | desktop | tablet
});

// Daily sales rollup that the Dashboard/Analitik series read (store_id, date).
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: pk(),
    storeId: uuid().notNull().references(() => stores.id),
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
export const ledgerKind = pgEnum("ledger_kind", ["sale", "retur", "payout", "adjustment"]);
export const ledgerStatus = pgEnum("ledger_status", ["pending", "available"]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  orderId: uuid().references(() => orders.id),
  // The payment that actually collected the money (migration 0041). A `sale` entry exists because
  // a shopper PAID — so the entry points at the payment, and a partial unique index
  // (ledger_one_sale_per_payment) makes a second credit for the same payment physically
  // impossible. Gateway callbacks retry; buttons get double-clicked. The guarantee lives in the
  // DB, not in the hope that the caller fires exactly once.
  paymentId: uuid().references(() => payments.id),
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
});

export const payoutStatus = pgEnum("payout_status", ["menunggu", "diproses", "selesai", "gagal"]);

export const payouts = pgTable("payouts", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().primaryKey().references(() => stores.id),
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
});

export const platformPaymentGateways = pgTable("platform_payment_gateways", {
  id: pk(),
  provider: gatewayProvider().notNull(),
  credentials: jsonb(),
  enabled: boolean().notNull().default(false),
  isCod: boolean().notNull().default(false),
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
});

// Kelurahan (village) + its postcode, under a KiriminAja district. Migration 0046 created the
// table but the Drizzle definition never landed with it, so `schema.kelurahan` did not exist and
// apps/admin/lib/data/areas.ts could not compile. Reference data, not store-scoped (no RLS).
export const kelurahan = pgTable("kelurahan", {
  id: text().primaryKey(),
  districtId: integer()
    .notNull()
    .references(() => kiriminajaAreas.id),
  name: text().notNull(),
  postcode: text().notNull(),
});

export const shippingAggregator = pgTable("shipping_aggregator", {
  id: pk(),
  provider: aggregatorProvider().notNull(),
  apiKey: text(),
  enabled: boolean().notNull().default(false),
});

export const platformCouriers = pgTable("platform_couriers", {
  id: pk(),
  courier: text().notNull(),
  services: jsonb(),
  enabled: boolean().notNull().default(true),
});

// AutoLaris payment channels the platform offers (like platform_couriers). enabled = shown at
// checkout. `active` = last live-probe result (whether AutoLaris actually accepts the channel).
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
  feePct: integer().notNull().default(0),
});

export const storePaymentMethods = pgTable(
  "store_payment_methods",
  {
    id: pk(),
    storeId: uuid().notNull().references(() => stores.id),
    method: text().notNull(),
    enabled: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.storeId, t.method)],
);

export const storeShippingMethods = pgTable(
  "store_shipping_methods",
  {
    id: pk(),
    storeId: uuid().notNull().references(() => stores.id),
    courier: text().notNull(),
    service: text().notNull(),
    enabled: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.storeId, t.courier, t.service)],
);

export const domains = pgTable("domains", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  hostname: text().notNull(),
  verified: boolean().notNull().default(false),
});

export const notificationTemplates = pgTable("notification_templates", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  accountId: uuid().notNull().references(() => accounts.id),
  storeId: uuid().references(() => stores.id),
  planKey: planKey().notNull(),
  amountIdr: money().notNull().default(0),
  status: invoiceStatus().notNull().default("menunggu"),
  // subscription payment (AutoLaris VA) matching + kind
  kind: text(), // "subscription" for merchant subscription invoices
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

// Platform operators (US) — the super-admin's own login, separate from store `users`.
export const platformAdmins = pgTable("platform_admins", {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  passwordHash: text(), // scrypt "salt:hash" (local auth)
  role: text().notNull().default("owner"),
  createdAt: createdAt(),
});

// ---------- media library (Shopify-style Files) — all uploaded images for a store ----------
export const media = pgTable("media", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
    storeId: uuid().notNull().references(() => stores.id, { onDelete: "cascade" }),
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
    onePrimary: uniqueIndex("store_domains_one_primary").on(t.storeId).where(sql`is_primary`),
  }),
);

// ---------- support tickets (2-sided: merchant ↔ platform) ----------
export const ticketStatus = pgEnum("ticket_status", ["open", "answered", "closed"]);
export const supportTickets = pgTable("support_tickets", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  subject: text().notNull(),
  status: ticketStatus().notNull().default("open"), // open = awaiting platform · answered = platform replied · closed
  lastMessageAt: createdAt(),
  createdAt: createdAt(),
});
export const supportMessages = pgTable("support_messages", {
  id: pk(),
  ticketId: uuid().notNull().references(() => supportTickets.id),
  // denormalized on purpose: every RLS policy (0012) keys on store_id (migration 0035).
  storeId: uuid().notNull().references(() => stores.id),
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
export const chatVisitorStatus = pgEnum("chat_visitor_status", ["active", "blocked"]);
export const conversationStatus = pgEnum("conversation_status", ["open", "snoozed", "closed"]);
export const messageSender = pgEnum("message_sender", ["customer", "merchant", "system"]);

// The subject of the shopper's signed `tokophi_chat` cookie (`vid`). Created on the FIRST message,
// never on page load — a bot that never types leaves no row.
export const chatVisitors = pgTable("chat_visitors", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
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
  storeId: uuid().notNull().references(() => stores.id),
  visitorId: uuid().notNull().references(() => chatVisitors.id),
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
  conversationId: uuid().notNull().references(() => conversations.id, { onDelete: "cascade" }),
  // DENORMALIZED on purpose: every RLS policy keys on store_id (0012). A join-based policy would be
  // slower and inconsistent with the other 38 store-scoped tables. support_messages got this wrong
  // (fixed in 0035) — don't repeat it.
  storeId: uuid().notNull().references(() => stores.id),
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
export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type ChatVisitor = typeof chatVisitors.$inferSelect;
export type NewChatVisitor = typeof chatVisitors.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
