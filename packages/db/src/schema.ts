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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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
export const orderStatus = pgEnum("order_status", ["baru", "diproses", "dikirim", "selesai", "batal"]);
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
  createdAt: createdAt(),
});

export const orders = pgTable("orders", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  number: text().notNull().unique(),
  customerId: uuid().references(() => customers.id),
  status: orderStatus().notNull().default("baru"),
  financialStatus: financialStatus().notNull().default("pending"),
  channel: orderChannel().notNull().default("organic"),
  subtotalIdr: money().notNull().default(0),
  discountIdr: money().notNull().default(0),
  shippingIdr: money().notNull().default(0),
  taxIdr: money().notNull().default(0),
  totalIdr: money().notNull().default(0),
  city: text(),
  province: text(),
  // KiriminAja shipment (set when "Buat Pengiriman" succeeds)
  awb: text(),
  courier: text(),
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
  // AutoLaris payment-gateway (VA/QRIS/DANA) — platform-managed PSP
  storeId: uuid().references(() => stores.id),
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

export const analyticsEvents = pgTable("analytics_events", {
  id: pk(),
  storeId: uuid().notNull().references(() => stores.id),
  ts: createdAt(),
  type: text().notNull(),
  sessionId: text(),
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
export const storeSettings = pgTable("store_settings", {
  storeId: uuid().primaryKey().references(() => stores.id),
  taxRatePct: integer().notNull().default(11),
  taxInclusive: boolean().notNull().default(false),
  // KiriminAja sender/pickup address (origin for creating shipments)
  senderName: text(),
  senderPhone: text(),
  senderAddress: text(),
  senderKecamatanId: integer(),
  senderKecamatanName: text(),
  senderKelurahanId: integer(),
  senderKelurahanName: text(),
  senderLat: text(),
  senderLng: text(),
  // Enabled courier codes offered to shoppers (KiriminAja codes: sicepat/jne/jnt/spx/lion/…).
  // NULL = all couriers KiriminAja returns for the route (backward-compatible default).
  couriers: text().array(),
  // Payment channel codes the merchant offers (AutoLaris codes). NULL = all platform-enabled.
  paymentChannels: text().array(),
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
  virtualAccount: text(),
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
