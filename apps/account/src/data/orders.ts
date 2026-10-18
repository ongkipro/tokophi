// TokoΦ Account → buyer area (spec §17 phase 1: ACC-6, ACC-8, ACC-11, ACC-12; Tasks 10.5–10.7, 10.9).
//
// The ONLY way an order reaches an account is a claim: the buyer holds the claim token the order API
// returned on the success page (D-3), signs in, and accepts a consent screen naming the store. Then a
// `buyer_order_claims` row (one claimant per order, ever) and an active `buyer_store_links` row exist.
// Nothing here matches an email or a phone.
//
// Owner connection (D-4): every read carries `buyer_id = <me>` on the claim AND joins an `active` link
// of the same buyer and store — an unlinked store's orders vanish without touching store-owned rows.
// Order data leaves through an explicit allowlist (spec §3 "Order projection"): no notes, tags, fees,
// ledger, provider ids, or anything about another customer.
import * as schema from "@tokophi/db/schema";
import { lockActiveAccount } from "./account-lock";
import { claimSecret, verifyClaimToken } from "@tokophi/lib/claim-token";
import { likeContains } from "@tokophi/lib/like";
import { isUuid } from "@tokophi/lib/uuid";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./account";
import { storefrontOrigin } from "../lib/nav";

/** Bumped whenever the consent screen's wording about what is shared changes. */
export const CONSENT_VERSION = "2026-10-15";

const o = schema.orders;
const cl = schema.buyerOrderClaims;
const ln = schema.buyerStoreLinks;
const st = schema.stores;

/** Claimed by me, through a link of mine that is active — the one tenant boundary of the buyer area. */
const mine = (buyerId: string) =>
  and(eq(cl.buyerId, buyerId), eq(ln.buyerId, buyerId), eq(ln.storeId, cl.storeId), eq(ln.status, "active"));


// ── Claim (Task 10.5, ACC-11) ─────────────────────────────────────────────────────────────────────

export type ClaimPreview =
  | { state: "ready"; orderNumber: string; storeName: string }
  | { state: "mine"; orderNumber: string; storeName: string }
  | { state: "invalid" };

/** What the consent screen shows. Every refusal is the same `invalid` — tampered, expired, unknown
 *  order, or already claimed by another account must be indistinguishable to the holder. */
export async function previewClaim(db: Db, buyerId: string, token: unknown, nowMs = Date.now()): Promise<ClaimPreview> {
  const orderId = tokenOrder(token, nowMs);
  if (!orderId) return { state: "invalid" };
  const [row] = await db
    .select({ number: o.number, storeName: st.name, claimant: cl.buyerId })
    .from(o)
    .innerJoin(st, eq(st.id, o.storeId))
    .leftJoin(cl, eq(cl.orderId, o.id))
    .where(eq(o.id, orderId))
    .limit(1);
  if (!row) return { state: "invalid" };
  if (row.claimant && row.claimant !== buyerId) return { state: "invalid" };
  return { state: row.claimant ? "mine" : "ready", orderNumber: row.number, storeName: row.storeName };
}

export type ClaimResult = { ok: true; orderNumber: string } | { ok: false };

/** Record the claim and create / re-activate the store link, in one transaction. `consent` must be the
 *  literal "yes" the form posts. Claiming an order already mine is a no-op success (and re-activates a
 *  link I had revoked — I just consented again). */
export async function claimOrder(db: Db, buyerId: string, token: unknown, consent: unknown, nowMs = Date.now()): Promise<ClaimResult> {
  if (consent !== "yes") return { ok: false };
  const orderId = tokenOrder(token, nowMs);
  if (!orderId) return { ok: false };
  return db.transaction(async (tx) => {
    if (!(await lockActiveAccount(tx as unknown as Db, buyerId))) return { ok: false } as const;
    const [order] = await tx
      .select({ id: o.id, number: o.number, storeId: o.storeId, customerId: o.customerId })
      .from(o)
      .where(eq(o.id, orderId))
      .limit(1);
    if (!order) return { ok: false } as const;
    // The unique order_id decides who claimed first; a loser reads the winner back.
    const won = await tx
      .insert(cl)
      .values({ orderId: order.id, buyerId, storeId: order.storeId })
      .onConflictDoNothing({ target: cl.orderId })
      .returning({ id: cl.id });
    if (won.length === 0) {
      const [held] = await tx.select({ buyerId: cl.buyerId }).from(cl).where(eq(cl.orderId, order.id)).limit(1);
      if (held?.buyerId !== buyerId) return { ok: false } as const;
    }
    await tx
      .insert(ln)
      .values({ buyerId, storeId: order.storeId, customerId: order.customerId, consentVersion: CONSENT_VERSION, claimMethod: "token" })
      .onConflictDoUpdate({
        target: [ln.buyerId, ln.storeId],
        // A second order from a store I am already actively linked to under the same wording is not new
        // consent: keep the original moment. A revoked link, or new wording, is consent given now.
        // (In ON CONFLICT … SET, a bare column is the existing row's value.)
        set: {
          status: "active",
          revokedAt: null,
          consentVersion: CONSENT_VERSION,
          consentedAt: sql`case when ${ln.status} <> 'active' or ${ln.consentVersion} <> excluded.consent_version then now() else ${ln.consentedAt} end`,
          customerId: sql`coalesce(${ln.customerId}, excluded.customer_id)`,
        },
      });
    return { ok: true, orderNumber: order.number } as const;
  });
}

function tokenOrder(token: unknown, nowMs: number): string | null {
  const secret = claimSecret();
  if (!secret || typeof token !== "string" || token.length > 300) return null;
  return verifyClaimToken(token, secret, nowMs)?.orderId ?? null;
}

// ── Order hub + detail (Task 10.6, ACC-12) ────────────────────────────────────────────────────────

export type OrderStatus = (typeof schema.orderStatus.enumValues)[number];
export const STATUS_TABS = ["semua", "belum-bayar", "aktif", "selesai", "batal"] as const;
export type StatusTab = (typeof STATUS_TABS)[number];
/** The hub's URL filters (`?q=&toko=&status=`), already normalised by `parseOrderFilter`. */
export type OrderFilter = { q?: string; toko?: string; status?: StatusTab };

export type HubOrder = {
  number: string;
  placedAt: Date;
  status: OrderStatus;
  totalIdr: number;
  storeName: string;
  storeSlug: string;
  /** Sum of quantities. */
  items: number;
  /** Number of order lines; with `firstLine` it reads "Kemeja … +2 produk". */
  lineCount: number;
  firstLine: string | null;
  /** The first line's product photo on the store's origin, or null (never a fabricated image). */
  thumb: string | null;
  courier: string | null;
  awb: string | null;
  payment: { method: string; status: string } | null;
};

// The order's payment — the one definition every Seller screen uses: paid_at desc nulls last, id desc.
const latestPay = (col: "method" | "status") =>
  sql<string | null>`(select p.${sql.raw(col)}::text from payments p where p.order_id = ${o.id} and p.store_id = ${o.storeId} order by p.paid_at desc nulls last, p.id desc limit 1)`;
/** Prepaid and still owed: the latest payment waits and is not COD (COD is paid to the courier). */
const unpaid = sql`(${o.status} not in ('batal', 'retur', 'selesai') and ${latestPay("status")} = 'menunggu' and ${latestPay("method")} <> 'cod')`;

function filterWhere(f: OrderFilter) {
  const parts: (SQL | undefined)[] = [];
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const like = likeContains(q);
    parts.push(or(ilike(o.number, like), sql`exists (select 1 from order_line_items li where li.order_id = ${o.id} and li.title ilike ${like})`));
  }
  if (f.toko) parts.push(eq(st.slug, f.toko.slice(0, 100)));
  if (f.status === "belum-bayar") parts.push(unpaid);
  else if (f.status === "aktif") parts.push(inArray(o.status, ["baru", "diproses", "dikirim"]));
  else if (f.status === "selesai") parts.push(eq(o.status, "selesai"));
  else if (f.status === "batal") parts.push(inArray(o.status, ["batal", "retur"]));
  return parts;
}

/** My orders, newest first. Filters only ever narrow: they are ANDed onto `mine()`. */
export async function myOrders(db: Db, buyerId: string, filter: OrderFilter = {}, limit?: number): Promise<HubOrder[]> {
  const q = db
    .select({
      storeId: o.storeId,
      number: o.number,
      placedAt: o.placedAt,
      status: o.status,
      totalIdr: o.totalIdr,
      storeName: st.name,
      storeSlug: st.slug,
      items: sql<number>`(select coalesce(sum(li.qty), 0) from order_line_items li where li.order_id = ${o.id})`.mapWith(Number),
      lineCount: sql<number>`(select count(*) from order_line_items li where li.order_id = ${o.id})`.mapWith(Number),
      firstLine: sql<string | null>`(select li.title from order_line_items li where li.order_id = ${o.id} order by li.title asc, li.id asc limit 1)`,
      media: sql<string | null>`(select m.url from product_media m join product_variants v on v.product_id = m.product_id
        where v.store_id = ${o.storeId}
          and v.id = (select li.variant_id from order_line_items li where li.order_id = ${o.id} order by li.title asc, li.id asc limit 1)
        order by m.position asc, m.id asc limit 1)`,
      courier: o.courier,
      awb: o.awb,
      payMethod: latestPay("method"),
      payStatus: latestPay("status"),
    })
    .from(cl)
    .innerJoin(ln, and(eq(ln.buyerId, cl.buyerId), eq(ln.storeId, cl.storeId)))
    .innerJoin(o, and(eq(o.id, cl.orderId), eq(o.storeId, cl.storeId)))
    .innerJoin(st, eq(st.id, o.storeId))
    .where(and(mine(buyerId), ...filterWhere(filter)))
    .orderBy(desc(o.placedAt), desc(o.number));
  const rows = limit ? await q.limit(limit) : await q;
  const origins = new Map<string, Promise<string>>();
  const originOf = (id: string, slug: string) => origins.get(id) ?? origins.set(id, storeOrigin(db, id, slug)).get(id)!;
  return Promise.all(
    rows.map(async ({ storeId, media, payMethod, payStatus, ...r }) => ({
      ...r,
      thumb: mediaUrl(media, await originOf(storeId, r.storeSlug)),
      payment: payMethod && payStatus ? { method: payMethod, status: payStatus } : null,
    })),
  );
}

/** Is this order still waiting for a prepaid payment? (Same rule as the `belum-bayar` tab.) */
export const isUnpaid = (x: { status: string; payment: { method: string; status: string } | null }) =>
  !["batal", "retur", "selesai"].includes(x.status) && x.payment?.status === "menunggu" && x.payment.method !== "cod";

export type OrderPayment = {
  method: string;
  status: string;
  amountIdr: number;
  adminFeeIdr: number;
  totalIdr: number;
  /** Bank / channel code of a VA (public, printed on the bank's own screen). */
  channel: string | null;
  /** Only while the payment waits: what the buyer needs to pay. Never the QR string, never provider ids. */
  virtualAccount: string | null;
  url: string | null;
};

export type OrderLine = { title: string; qty: number; priceIdr: number; totalIdr: number; thumb: string | null };

export type OrderDetail = Omit<HubOrder, "firstLine" | "thumb" | "lineCount" | "payment"> & {
  storeOrigin: string;
  storeWhatsapp: string | null;
  /** The store's declared return window in days, or null when it has not declared one. */
  returnWindowDays: number | null;
  subtotalIdr: number;
  discountIdr: number;
  shippingIdr: number;
  taxIdr: number;
  serviceType: string | null;
  payment: OrderPayment | null;
  ship: { recipient: string | null; phone: string | null; address: string | null; kelurahan: string | null; city: string | null; province: string | null; postcode: string | null };
  lines: OrderLine[];
};

/** One claimed order by its number, or null — an unclaimed, foreign or unlinked order is not-found. */
export async function myOrder(db: Db, buyerId: string, number: string): Promise<OrderDetail | null> {
  if (typeof number !== "string" || number.length > 64) return null;
  const [r] = await db
    .select({
      id: o.id,
      storeId: o.storeId,
      number: o.number,
      placedAt: o.placedAt,
      status: o.status,
      totalIdr: o.totalIdr,
      subtotalIdr: o.subtotalIdr,
      discountIdr: o.discountIdr,
      shippingIdr: o.shippingIdr,
      taxIdr: o.taxIdr,
      courier: o.courier,
      serviceType: o.serviceType,
      awb: o.awb,
      storeName: st.name,
      storeSlug: st.slug,
      storeWhatsapp: st.whatsapp,
      returnWindowDays: schema.storeSettings.returnWindowDays,
      recipient: o.shipRecipient,
      phone: o.shipPhone,
      address: o.shipAddress,
      kelurahan: o.shipKelurahanName,
      city: o.city,
      province: o.province,
      postcode: o.shipPostcode,
    })
    .from(cl)
    .innerJoin(ln, and(eq(ln.buyerId, cl.buyerId), eq(ln.storeId, cl.storeId)))
    .innerJoin(o, and(eq(o.id, cl.orderId), eq(o.storeId, cl.storeId)))
    .innerJoin(st, eq(st.id, o.storeId))
    .leftJoin(schema.storeSettings, eq(schema.storeSettings.storeId, o.storeId))
    .where(and(mine(buyerId), eq(o.number, number)))
    .limit(1);
  if (!r) return null;
  const origin = await storeOrigin(db, r.storeId, r.storeSlug);
  const li = schema.orderLineItems;
  const v = schema.productVariants;
  // A line's photo: its variant's product (same store), lowest media position. A deleted variant is fine.
  const lines = await db
    .select({
      title: li.title,
      qty: li.qty,
      priceIdr: li.priceIdr,
      totalIdr: li.totalIdr,
      media: sql<string | null>`(select m.url from product_media m where m.product_id = ${v.productId} order by m.position asc, m.id asc limit 1)`,
    })
    .from(li)
    .leftJoin(v, and(eq(v.id, li.variantId), eq(v.storeId, r.storeId)))
    .where(eq(li.orderId, r.id))
    .orderBy(asc(li.title), asc(li.id));
  const p = schema.payments;
  const [pay] = await db
    .select({ method: p.method, status: p.status, amountIdr: p.amountIdr, adminFee: p.adminFee, total: p.total, channel: p.channelCode, va: p.virtualAccount, url: p.url })
    .from(p)
    .where(and(eq(p.orderId, r.id), eq(p.storeId, r.storeId)))
    .orderBy(sql`${p.paidAt} desc nulls last`, desc(p.id))
    .limit(1);
  const waiting = pay?.status === "menunggu" && r.status !== "batal" && r.status !== "retur";
  return {
    number: r.number,
    placedAt: r.placedAt,
    status: r.status,
    totalIdr: r.totalIdr,
    storeName: r.storeName,
    storeSlug: r.storeSlug,
    items: lines.reduce((s, l) => s + l.qty, 0),
    storeOrigin: origin,
    storeWhatsapp: r.storeWhatsapp?.trim() || null,
    returnWindowDays: r.returnWindowDays ?? null,
    subtotalIdr: r.subtotalIdr,
    discountIdr: r.discountIdr,
    shippingIdr: r.shippingIdr,
    taxIdr: r.taxIdr,
    courier: r.courier,
    serviceType: r.serviceType,
    awb: r.awb,
    payment: pay
      ? {
          method: pay.method,
          status: pay.status,
          amountIdr: pay.amountIdr,
          adminFeeIdr: pay.adminFee ?? 0,
          totalIdr: pay.total || pay.amountIdr + (pay.adminFee ?? 0),
          channel: pay.channel,
          virtualAccount: waiting ? pay.va : null,
          url: waiting && pay.url && /^https:\/\//i.test(pay.url) ? pay.url : null,
        }
      : null,
    ship: { recipient: r.recipient, phone: r.phone, address: r.address, kelurahan: r.kelurahan, city: r.city, province: r.province, postcode: r.postcode },
    lines: lines.map(({ media, ...l }) => ({ ...l, thumb: mediaUrl(media, origin) })),
  };
}

// ── Beranda helpers (spec §18.4 A) ────────────────────────────────────────────────────────────────

export type BuyAgain = { title: string; storeName: string; url: string; thumb: string | null };

/** Up to `n` distinct products from MY delivered (`selesai`) orders that still exist and are active in
 *  that store, newest purchase first. Links to the storefront product page — no price promise. */
export async function buyAgain(db: Db, buyerId: string, n = 3): Promise<BuyAgain[]> {
  const li = schema.orderLineItems;
  const v = schema.productVariants;
  const pr = schema.products;
  const rows = await db
    .selectDistinctOn([pr.id], {
      productId: pr.id,
      title: pr.title,
      handle: pr.handle,
      storeId: st.id,
      storeName: st.name,
      storeSlug: st.slug,
      placedAt: o.placedAt,
      media: sql<string | null>`(select m.url from product_media m where m.product_id = ${pr.id} order by m.position asc, m.id asc limit 1)`,
    })
    .from(cl)
    .innerJoin(ln, and(eq(ln.buyerId, cl.buyerId), eq(ln.storeId, cl.storeId)))
    .innerJoin(o, and(eq(o.id, cl.orderId), eq(o.storeId, cl.storeId)))
    .innerJoin(st, eq(st.id, o.storeId))
    .innerJoin(li, eq(li.orderId, o.id))
    .innerJoin(v, and(eq(v.id, li.variantId), eq(v.storeId, o.storeId)))
    .innerJoin(pr, and(eq(pr.id, v.productId), eq(pr.storeId, o.storeId)))
    .where(and(mine(buyerId), eq(o.status, "selesai"), eq(pr.status, "active"), isNull(pr.archivedAt)))
    .orderBy(pr.id, desc(o.placedAt));
  const top = rows.sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime()).slice(0, n);
  return Promise.all(
    top.map(async (r) => {
      const origin = await storeOrigin(db, r.storeId, r.storeSlug);
      return { title: r.title, storeName: r.storeName, url: `${origin}/produk/${encodeURIComponent(r.handle)}`, thumb: mediaUrl(r.media, origin) };
    }),
  );
}

/** How many addresses I saved (Beranda tile) — a count, without resolving each district. */
export async function countMyAddresses(db: Db, buyerId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.buyerAddresses).where(eq(schema.buyerAddresses.buyerId, buyerId));
  return r?.n ?? 0;
}

// ── Linked stores + unlink (Tasks 10.7 / 10.9, ACC-6 / ACC-8) ─────────────────────────────────────

export type LinkedStore = { storeId: string; name: string; slug: string; origin: string; orders: number; firstOrderAt: Date | null; lastOrderAt: Date | null };

const storeCols = {
  storeId: st.id,
  name: st.name,
  slug: st.slug,
  orders: sql<number>`count(${o.id})`.mapWith(Number),
  firstOrderAt: sql<Date | null>`min(${o.placedAt})`.mapWith((v) => (v ? new Date(v) : null)),
  lastOrderAt: sql<Date | null>`max(${o.placedAt})`.mapWith((v) => (v ? new Date(v) : null)),
};

/** My actively linked stores, most recent purchase first. */
export async function myStores(db: Db, buyerId: string): Promise<LinkedStore[]> {
  const rows = await db
    .select(storeCols)
    .from(ln)
    .innerJoin(st, eq(st.id, ln.storeId))
    .leftJoin(cl, and(eq(cl.buyerId, ln.buyerId), eq(cl.storeId, ln.storeId)))
    .leftJoin(o, and(eq(o.id, cl.orderId), eq(o.storeId, cl.storeId)))
    .where(and(eq(ln.buyerId, buyerId), eq(ln.status, "active")))
    .groupBy(st.id)
    .orderBy(sql`max(${o.placedAt}) desc nulls last`, asc(st.name));
  return Promise.all(rows.map(async (r) => ({ ...r, origin: await storeOrigin(db, r.storeId, r.slug) })));
}

/** `linkedAt` = when this buyer FIRST connected the store (the link row's birth), not the latest consent. */
export type StoreProfile = LinkedStore & { whatsapp: string | null; linkedAt: Date };

/** One store I am ACTIVELY linked to, by slug — or null (unknown, foreign, never linked, or unlinked). */
export async function myStore(db: Db, buyerId: string, slug: unknown): Promise<StoreProfile | null> {
  if (typeof slug !== "string" || slug.length > 100) return null;
  const [r] = await db
    .select({ ...storeCols, whatsapp: st.whatsapp, linkedAt: sql<Date>`min(${ln.createdAt})`.mapWith((v) => new Date(v)) })
    .from(ln)
    .innerJoin(st, eq(st.id, ln.storeId))
    .leftJoin(cl, and(eq(cl.buyerId, ln.buyerId), eq(cl.storeId, ln.storeId)))
    .leftJoin(o, and(eq(o.id, cl.orderId), eq(o.storeId, cl.storeId)))
    .where(and(eq(ln.buyerId, buyerId), eq(ln.status, "active"), eq(st.slug, slug)))
    .groupBy(st.id)
    .limit(1);
  if (!r) return null;
  return { ...r, whatsapp: r.whatsapp?.trim() || null, origin: await storeOrigin(db, r.storeId, r.slug) };
}

/** ACC-8: the link goes `revoked`; nothing store-owned is written. True when a live link was revoked. */
export async function unlinkStore(db: Db, buyerId: string, storeId: unknown): Promise<boolean> {
  if (typeof storeId !== "string" || !isUuid(storeId)) return false;
  const rows = await db
    .update(ln)
    .set({ status: "revoked", revokedAt: sql`now()` })
    .where(and(eq(ln.buyerId, buyerId), eq(ln.storeId, storeId), eq(ln.status, "active")))
    .returning({ id: ln.id });
  return rows.length > 0;
}

/** A `product_media.url` is relative: seeded `/products/x.webp` is served by the STORE's origin, a
 *  merchant upload `/api/uploads/<name>` by the Seller (admin) app — the storefront's own `mediaUrl`
 *  rule (`apps/storefront/src/data/catalog.ts`). Uploads ask for the 200 px rendition (thumbnails are
 *  48–64 px). Only https on the store's own host or the admin upload origin is accepted: a stored URL
 *  pointing anywhere else (another host, plain http) becomes the neutral icon, never a third-party
 *  request from a personal page. No known admin origin ⇒ an upload has no honest URL here either. */
function mediaUrl(url: string | null, origin: string): string | null {
  if (!url) return null;
  try {
    if (url.startsWith("/api/uploads/")) {
      const raw = process.env.ADMIN_URL || process.env.PUBLIC_ONGKIR_API;
      const admin = raw ? new URL(raw) : null;
      return admin?.protocol === "https:" ? `${admin.origin}${url}?w=200` : null;
    }
    const u = new URL(url, `${origin}/`);
    return u.protocol === "https:" && u.host === new URL(origin).host ? u.href : null;
  } catch {
    return null;
  }
}

/** The store's canonical storefront: its ACTIVE primary custom domain, else `<slug>.<base>` — the same
 *  rule the storefront's `primaryOrigin` applies, so "way back" lands where canonicals point. */
async function storeOrigin(db: Db, storeId: string, slug: string): Promise<string> {
  const d = schema.storeDomains;
  const [row] = await db
    .select({ host: d.host })
    .from(d)
    .where(and(eq(d.storeId, storeId), eq(d.isPrimary, true), eq(d.status, "active")))
    .limit(1);
  return row ? `https://${row.host}` : storefrontOrigin(slug);
}
