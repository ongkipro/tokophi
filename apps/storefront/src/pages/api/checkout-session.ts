// Progressive checkout capture — the ONLY writer of `checkout_sessions` from the shop.
//
// There is no "abandon" event to listen for: abandonment is the ABSENCE of an order. So the row is
// written AS THE SHOPPER TYPES (debounced in checkout.astro), and judged later by what never
// happened to it. A session that carries a name and a phone but no address is still a recoverable
// sale — in Indonesia recovery travels on WhatsApp, so `phone` is the field that pays for this whole
// table.
//
// Same reasoning as /api/track for living in the STOREFRONT: it must be same-origin with the page
// that fires it (subdomain today, custom domain tomorrow), and it must fail QUIET — a capture that
// dies must never surface as an error in a checkout that is otherwise working.
//
// TENANT: `locals.store` (Host header, src/middleware.ts). A store id sent by the client is NEVER
// read — the body has no place to put one, and if it did it would be ignored. One shop's page cannot
// write a cart into another shop's funnel.
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { normalizePhone } from "@tokophi/lib/validate";

const STEPS = ["keranjang", "kontak", "alamat", "pengiriman", "pembayaran"] as const;
type Step = (typeof STEPS)[number];

// ── abuse gates (same shape as /api/track: unauthenticated by necessity, so it needs a floor) ──
const LIMIT = 60; // a debounced checkout fires a handful; 60/min/IP is generous
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; reset: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return true;
  }
  e.count++;
  return e.count <= LIMIT;
}

function clientIp(request: Request, clientAddress: string | undefined): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0] ||
    h.get("x-real-ip") ||
    clientAddress ||
    "unknown"
  ).trim();
}

const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|whatsapp|telegram|discord|skype|vkshare|w3c_validator|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|semrush|ahrefs|mj12|dotbot|petal|yandex|baidu|sogou|headless|phantomjs|selenium|scrapy|python-requests|python-urllib|curl\/|wget|libwww|okhttp|go-http-client|java\/|apache-httpclient|axios\/|node-fetch|got\/|postman|insomnia/i;
const isBot = (ua: string) => !ua.trim() || BOT_UA.test(ua);

const noContent = (reason: string) => new Response(null, { status: 204, headers: { "x-capture": reason } });

// ── ageing: aktif → ditinggal ────────────────────────────────────────────────────────────────
// A session that has gone quiet for ABANDON_AFTER_MIN is abandoned. There is no cron: the read
// layer should treat (status='aktif' AND updated_at < now() - 60 min) as ditinggal anyway, and this
// opportunistic sweep — at most once a minute per SSR process, on the store that is being written
// to, riding the (store_id, status, updated_at) index from migration 0044 — makes the stored column
// agree with that derivation so the admin never has to trust a background job that might not be
// running. Idempotent, bounded, and it costs a live shopper nothing measurable.
const ABANDON_AFTER_MIN = 60;
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

async function sweepAbandoned(storeId: string) {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  try {
    await db
      .update(schema.checkoutSessions)
      // Stamp WHEN it was judged abandoned (0045), not just that it was. Without this a cart that
      // sailed straight through checkout and a cart that went quiet and was genuinely RESCUED are
      // indistinguishable afterwards — both end up `pulih` — and a "recovery rate" built on that
      // counts every ordinary sale as a save. `updated_at` IS the moment it went quiet: it is the
      // last time anyone touched it.
      .set({ status: "ditinggal", abandonedAt: sql`coalesce(${schema.checkoutSessions.updatedAt}, ${schema.checkoutSessions.createdAt})` })
      .where(
        and(
          eq(schema.checkoutSessions.storeId, storeId),
          eq(schema.checkoutSessions.status, "aktif"),
          lt(schema.checkoutSessions.updatedAt, sql`now() - interval '${sql.raw(String(ABANDON_AFTER_MIN))} minutes'`),
        ),
      );
  } catch (err) {
    console.error("[checkout-session] sweep failed", err);
  }
}

// ── payload normalisation (everything here is attacker-controlled text) ──────────────────────
const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
};
const int = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1_000_000_000) : 0;
};

type CartItem = { handle: string | null; name: string | null; variant: string | null; qty: number; price: number };

function normItems(v: unknown): CartItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      handle: str(i.handle, 120),
      name: str(i.name, 200),
      variant: str(i.variant, 80),
      qty: Math.max(1, Math.min(int(i.qty) || 1, 999)),
      price: int(i.price),
    };
  });
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const store = locals.store;
  if (!store) return noContent("unknown-store");
  if (isBot(request.headers.get("user-agent") ?? "")) return noContent("bot");
  if (!rateLimit(`checkout:${clientIp(request, clientAddress)}`)) return noContent("rate-limited");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return noContent("invalid-json");
  }
  if (!body || typeof body !== "object") return noContent("invalid-body");

  // The SAME session id the funnel beacons use (Analytics.astro, sessionStorage "tphi:sid"), so a
  // cart joins to its own journey. Anything else in the body claiming to be a store is ignored.
  const sessionId = str(body.sessionId, 64);
  if (!sessionId) return noContent("no-session");

  const items = normItems(body.items);
  if (!items.length) return noContent("empty-cart"); // an empty cart is not a checkout

  const step: Step = STEPS.includes(body.step as Step) ? (body.step as Step) : "keranjang";
  const districtId = Number(body.districtId);

  const values = {
    storeId: store.id, // ← Host-resolved. Never from the body.
    sessionId,
    name: str(body.name, 120),
    // Canonical `62…` the moment it is parseable — this is the number the recovery WhatsApp is sent
    // to, so it must be in the shape wa.me/KiriminAja want, not the shape it was typed in. While the
    // shopper is still MID-TYPING ("0812…"), it is not parseable yet — keep the raw text rather than
    // blanking the field: a half-typed number is still worth more than nothing on an abandoned cart.
    phone: normalizePhone(body.phone) ?? str(body.phone, 32),
    email: str(body.email, 160),
    address: str(body.address, 400),
    city: str(body.city, 120),
    province: str(body.province, 120),
    postcode: str(body.postcode, 16),
    districtId: Number.isInteger(districtId) && districtId > 0 ? districtId : null,
    items,
    subtotalIdr: int(body.subtotal),
    shippingIdr: int(body.shipping),
    step,
    status: "aktif" as const,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(schema.checkoutSessions)
      .values(values)
      .onConflictDoUpdate({
        // (store_id, session_id) — the UNIQUE index from 0044. Typing into the form UPDATES one row;
        // it must never leave a trail of half-filled duplicates.
        target: [schema.checkoutSessions.storeId, schema.checkoutSessions.sessionId],
        set: {
          name: values.name,
          phone: values.phone,
          email: values.email,
          address: values.address,
          city: values.city,
          province: values.province,
          postcode: values.postcode,
          districtId: values.districtId,
          items: values.items,
          subtotalIdr: values.subtotalIdr,
          shippingIdr: values.shippingIdr,
          // FURTHEST step reached, never a regression: a late/out-of-order beacon (sendBeacon has no
          // ordering guarantee) must not drag "pembayaran" back to "kontak".
          step: sql`case when array_position(array['keranjang','kontak','alamat','pengiriman','pembayaran']::text[], excluded.step::text)
                            > array_position(array['keranjang','kontak','alamat','pengiriman','pembayaran']::text[], ${schema.checkoutSessions.step}::text)
                       then excluded.step else ${schema.checkoutSessions.step} end`,
          status: "aktif" as const, // they are back on the page → no longer abandoned
          updatedAt: values.updatedAt,
        },
        // A session that ALREADY became an order is settled history. A stray beacon arriving after
        // the order (pagehide fires on the redirect to /checkout/sukses) must not resurrect it as
        // "aktif" and un-recover a real sale.
        setWhere: sql`${schema.checkoutSessions.status} <> 'pulih'`,
      });
  } catch (err) {
    console.error("[checkout-session] upsert failed", err);
  }

  void sweepAbandoned(store.id);
  return noContent("ok");
};

export const GET: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
