// The Seller panel's domain VIEW types — the flat shapes `lib/data/*` returns and the screens render.
//
// These lived in `lib/mock/store.ts` beside 300 lines of mulberry32-seeded fixtures for as long as the
// panel existed, and stayed there after every read moved to Postgres: by 2026-09-09 all 51 importers of
// that file were `import type`, so a "mock" module with no runtime consumer was still shipped in every
// production type path (Task 6.7 / NF-20). The fixtures are gone; the types are here.
//
// ⚠️ THESE ARE NOT ROW SHAPES, ON PURPOSE. `Product.emoji`, `Order.minutesAgo`, `CmsPage.updatedDaysAgo`,
// `Customer.spent` are what the data layer DERIVES for a screen (counts, relative days, joined names),
// not what `@tokophi/db` stores. Deriving them from `$inferSelect` would put every column the panel
// does not render into every client prop, and the one thing they share with the table — the enum
// unions — IS derived, below. The status enums come from the DB, so a value added in a migration
// reaches the screen's union without a second edit; the ones with a DIFFERENT vocabulary from their
// column (`DiscountType`, `NavItemType`, `LeadSource`) are the data layer's own and stay spelled out.
import type {
  customerSegment,
  followupStatus,
  followupType,
  leadStage,
  orderStatus,
  poStatus,
  reviewStatus,
} from "@tokophi/db";

type Values<E extends { enumValues: readonly string[] }> = E["enumValues"][number];

// ---- dashboard / analytics ----
export type DayPoint = {
  date: string; // yyyy-mm-dd
  ts: number;
  sales: number;
  orders: number;
  visitors: number;
};

export type Activity = {
  id: string;
  kind: "order" | "visitor" | "review" | "stock" | "signup";
  text: string;
  minutesAgo: number;
};

// ---- catalog ----
export type Product = {
  id: string;
  name: string;
  handle?: string;
  /**
   * System-generated, per-store catalog number (ADR 0013, migration 0081). It is what `<g:id>` and the
   * conversion `content_ids` are built from, so it is the number a Merchant Center or Events Manager
   * error names. `0` only for rows that predate the migration.
   */
  number?: number;
  emoji: string;
  image: string; // /products/<slug>.webp
  price: number;
  stock: number;
  status: "active" | "draft";
  category: string;
  unitsSold: number;
  addedTs: number; // when the product was added (ms since epoch)
  media?: { id: string; url: string }[]; // real product_media rows (editor)
  // editor read-back fields (persisted, returned by getProduct — not in the list shape)
  description?: string;
  shortDescription?: string;
  productType?: string;
  vendor?: string;
  seoTitle?: string;
  seoDesc?: string;
  googleCategoryId?: number | null;
  googleCategoryPath?: string;
  gender?: string;
  ageGroup?: string;
  material?: string;
  compareAt?: number | null;
  cost?: number | null;
  sku?: string;
  barcode?: string; // default variant's `product_variants.barcode` — the feed's <g:gtin> source
  hasVariants?: boolean;
  options?: { name: string; values: string[] }[]; // option definitions in order (editor)
  variants?: { id: string; option1: string | null; option2: string | null; option3: string | null; sku: string | null; price: number; stock: number }[];
  weightGrams?: number | null; // shipping weight (default variant)
  weightMissing?: boolean; // ANY variant has NULL weight_grams → ongkir falls back to 500g (list warning)
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

export type Collection = { id: string; name: string; handle?: string; emoji: string; products: number; type: "manual" | "otomatis"; published: boolean };
// DB-enum-valued condition (field ∈ tag/title/type/price/stock/category, operator ∈ eq/neq/gt/lt/contains).
export type CollectionCondition = { field: string; operator: string; value: string };
// Everything the collection editor loads + saves — the flat Collection lacks description/SEO/members/conditions.
export type CollectionDetail = {
  id: string; name: string; handle: string; description: string;
  type: "manual" | "otomatis"; match: "all" | "any"; published: boolean;
  seoTitle: string; seoDesc: string; emoji: string;
  /** Uploaded cover image (`collections.image_url`). "" = none → fall back to `emoji`. */
  imageUrl: string;
  memberIds: string[]; conditions: CollectionCondition[];
};

export type POStatus = Values<typeof poStatus>;
export type PurchaseOrder = { id: string; supplier: string; status: POStatus; items: number; total: number; etaDays: number; createdDaysAgo: number };

// ---- orders ----
export type OrderStatus = Values<typeof orderStatus>;
export type Order = {
  id: string;
  customer: string;
  city: string;
  total: number;
  items: number;
  status: OrderStatus;
  channel: string;
  minutesAgo: number;
  awb?: string | null;
  courierName?: string | null;
};

// ---- customers ----
export type Segment = Values<typeof customerSegment>;
export type Customer = {
  id: string; name: string; email: string; phone: string; city: string;
  orders: number; spent: number; segment: Segment; joinedDaysAgo: number;
  tags?: string[]; notes?: string;
};
export type CustSegment = { id: string; name: string; count: number; growth: number; description: string };

export type ReviewStatus = Values<typeof reviewStatus>;
export type Review = { id: string; customer: string; product: string; emoji: string; rating: number; text: string; reply?: string; status: ReviewStatus; daysAgo: number };

// ---- discounts ----
// `ongkir` here is `gratis_ongkir` in `discount_kind`; `lib/data/discounts.ts` owns that mapping.
export type DiscountType = "persen" | "nominal" | "ongkir";
export type Discount = {
  id: string; code: string; type: DiscountType; value: number;
  // `nonaktif` is the DB's own OFF switch and must be SURFACED, not derived away: the display status
  // used to be computed from the dates alone, so a switched-off voucher showed as "kadaluarsa" and the
  // editor wrote `aktif` back over it on the next Simpan.
  status: "aktif" | "terjadwal" | "kadaluarsa" | "nonaktif" | "habis"; used: number; limit: number;
  /** `null` = no end date (`ends_at IS NULL`). NOT `0` — zero means "ends today". */
  endsInDays: number | null;
};

// ---- CMS: pages, blog ----
export type CmsPage = { id: string; title: string; handle: string; body?: string; published: boolean; updatedDaysAgo: number; template: string; views: number };
// `body` + `imageUrl` are OPTIONAL only because the list shape omits them. The DB read layer
// (lib/data/articles.ts) always supplies both to the editor — and must, or the editor writes back an
// empty body over the merchant's text. See the note on `sel` there.
export type BlogPost = { id: string; title: string; handle: string; blog: string; blogId?: string; author: string; published: boolean; publishedDaysAgo: number; excerpt: string; body?: string; imageUrl?: string; comments: number };

// ---- navigation (Indonesian item types; `lib/data/menus.ts` maps them to `menu_item_type`) ----
export type NavItemType = "beranda" | "koleksi" | "produk" | "halaman" | "blog" | "url";
export type NavItem = { id: string; title: string; type: NavItemType; target: string; children?: NavItem[] };
export type NavMenu = { handle: string; title: string; isDefault: boolean; items: NavItem[] };

// ---- CRM: sales pipeline (leads), WhatsApp follow-ups, message templates ----
// Display casing; `lead_source` stores the lowercase key (`lib/data/crm.ts` maps).
export type LeadSource = "WhatsApp" | "Instagram" | "TikTok" | "Referral" | "Marketplace";
export type LeadStage = Values<typeof leadStage>;
export type Lead = { id: string; name: string; phone: string; source: LeadSource; stage: LeadStage; value_idr: number; lastContactDaysAgo: number; note: string };

export type FollowupType = Values<typeof followupType>;
export type FollowupStatus = Values<typeof followupStatus>;
export type Followup = { id: string; customer: string; phone: string; type: FollowupType; context: string; dueDays: number; status: FollowupStatus; lastMessage: string };

export type WaTemplate = { id: string; name: string; type: FollowupType | "broadcast"; body: string };
