import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { kaShippingPrice, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { isInstantCourier, isInstantService } from "@tokophi/lib/couriers";
import { resolveArea } from "@/lib/data/areas";
import { getCodPolicy } from "@/lib/cod";
import { weightForCart, type CartItemRef } from "@/lib/shipping-weight";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE A SHIPPING PRICE IS PRODUCED.
//
// `/api/public/ongkir` quotes the checkout, and `/api/public/order` RE-QUOTES the order it is about
// to write. They must be the same function, or they are two prices — and the one the order keeps is
// the one that decides what the merchant is paid.
//
// Everything a price depends on is read from the SELLER'S data, never from the shopper's browser:
//   · ORIGIN  — store_settings.sender_kecamatan_id (a KiriminAja district id, not a city name)
//   · WEIGHT  — Σ product_variants.weight_grams over the cart (lib/shipping-weight.ts)
//   · SCOPE   — (platform-enabled couriers) ∩ (the merchant's per-service selection)
//   · COD     — the effective flag (courier capability × platform codAllowed × store cod_enabled)
// The client says WHAT is in the cart and WHERE it goes; the server says what that costs. The order
// API does not compare the shopper's number against ours — it ignores theirs and writes ours.
// ─────────────────────────────────────────────────────────────────────────────

export type QuotedRate = {
  name: string;
  /** courier code, e.g. "spx" */
  code: string;
  /** service_type within that courier, e.g. "1" */
  type: string;
  cost: number;
  etd: string;
  /** EFFECTIVE cod flag, never KiriminAja's raw capability */
  cod: boolean;
  /** KiriminAja's own speed class: cargo | regular | next_day | economy | one_day */
  group: string;
};

export type Quote =
  | {
      ok: true;
      rates: QuotedRate[];
      /** Σ weight of the cart, in grams (what it really weighs) */
      grams: number;
      /** what we quoted against: max(grams, 1000) — couriers bill a 1 kg minimum */
      billableGrams: number;
      /** lines whose variant had no weight_grams and fell back to the default (documented, not silent) */
      weightFallback: string[];
      codEnabled: boolean;
      origin: number;
      /** "pickup" = the seller's saved pickup district · "store-city" = a fuzzy match on the store's city */
      originFrom: "pickup" | "store-city";
      originName: string | null;
    }
  | { ok: false; error: string };

export type QuoteInput = {
  storeId: string;
  /** stores.city — only used as the fallback origin when no pickup address is set */
  storeCity?: string | null;
  destinationId: number;
  items: CartItemRef[];
  /** declared goods value, for insurance. Comes from the SERVER-priced subtotal in the order API. */
  itemValue?: number;
};

/** Find the rate the shopper picked inside a fresh quote. Courier + service_type — a label cannot. */
export function findRate(rates: QuotedRate[], code?: string | null, type?: string | null): QuotedRate | null {
  if (!code || !type) return null;
  const c = String(code).trim().toLowerCase();
  const t = String(type).trim();
  return rates.find((r) => r.code.toLowerCase() === c && String(r.type) === t) ?? null;
}

export async function quoteShipping(input: QuoteInput): Promise<Quote> {
  if (!kiriminajaConfigured()) return { ok: false, error: "Shipping belum dikonfigurasi." };
  if (!Number.isFinite(input.destinationId) || input.destinationId <= 0) {
    return { ok: false, error: "Tujuan belum dipilih." };
  }

  // Two-level courier control: platform (super-admin) sets the hard-enabled pool; the merchant picks
  // a subset. Instant/on-demand couriers are out of scope — a stale `gosend` row must not become a
  // checkout option.
  const platformRows = await db
    .select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled })
    .from(schema.platformCouriers);
  const platformOn = platformRows.filter((p) => p.enabled && !isInstantCourier(p.courier)).map((p) => p.courier);

  const [settings] = await db
    .select({
      kecamatanId: schema.storeSettings.senderKecamatanId,
      kecamatanName: schema.storeSettings.senderKecamatanName,
      couriers: schema.storeSettings.couriers,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, input.storeId))
    .limit(1);

  // ── ORIGIN = the seller's SAVED PICKUP ADDRESS (Pengaturan → Alamat) ──────────────────────────
  // `sender_kecamatan_id` IS a KiriminAja district id — the same currency as `destinationId` — so
  // there is nothing to resolve and nothing to guess. It was once `resolveArea(body.originCity)`: a
  // city name posted by the shopper's browser. Never let the client choose the origin.
  let origin: number | undefined = settings?.kecamatanId ?? undefined;
  let originFrom: "pickup" | "store-city" = "pickup";
  if (!origin) {
    // No pickup address yet → fall back to the store's REGISTERED city (still the shop's own data,
    // never the shopper's) and SAY SO: a quote built on a fuzzy match is a guess, and a guess must
    // be visible as one.
    originFrom = "store-city";
    const opts = await resolveArea(input.storeCity || "Yogyakarta", 1);
    origin = opts[0]?.id;
  }
  if (!origin) return { ok: false, error: "Alamat pengambilan toko belum diatur." };

  // The merchant's PER-SERVICE selection (store_shipping_methods) — a courier-level list cannot
  // express "I ship JNE Reguler but not JNE YES". No rows = the merchant never opened the card →
  // fall back to the courier-level column rather than render a checkout with zero options.
  const picked = await db
    .select({ courier: schema.storeShippingMethods.courier, service: schema.storeShippingMethods.service })
    .from(schema.storeShippingMethods)
    .where(and(eq(schema.storeShippingMethods.storeId, input.storeId), eq(schema.storeShippingMethods.enabled, true)));
  const services = picked.length ? new Set(picked.map((s) => `${s.courier}:${s.service}`)) : null;
  const merchant = settings?.couriers ?? null;
  const effective = (merchant ?? platformOn).filter((c) => platformOn.includes(c));

  // ── WEIGHT = summed from the CART, in the database, never from the browser ────────────────────
  const cart = (input.items ?? []).filter((i) => (i.qty ?? 0) > 0);
  if (!cart.length) return { ok: false, error: "Keranjang kosong — ongkir tidak bisa dihitung." };
  const pkg = await weightForCart(db, input.storeId, cart);

  // Ask for the couriers we will actually offer. We used to ask for EVERY courier and then throw the
  // rest away below — and an unfiltered quote makes KiriminAja walk its whole roster, including
  // couriers that do not serve the route: measured on Gubeng → Pleret, unfiltered took **5.5s** and
  // returned 18 services, while naming the 7 enabled couriers took **0.5s** and returned the 14 we
  // were keeping anyway. The checkout was paying eleven seconds-worth of latency per two shoppers to
  // fetch rows it discarded. The filters below stay: the courier list is a request, not a guarantee.
  const r = await kaShippingPrice({
    origin,
    destination: input.destinationId,
    weight: pkg.billableGrams,
    itemValue: input.itemValue || 0,
    insurance: 0,
    ...(effective.length ? { couriers: effective } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal mengambil tarif." };

  const cod = await getCodPolicy(input.storeId);
  let rates: QuotedRate[] = r.results
    // Never quote an instant courier, whatever KiriminAja returns — the checkout cannot book one.
    .filter((x) => !isInstantService({ courier: x.service, group: x.group }))
    .map((x) => ({
      name: x.service_name,
      code: x.service,
      type: x.service_type,
      cost: Number(x.cost),
      etd: x.etd,
      cod: !!x.cod && cod.allows(x.service, x.service_type),
      group: x.group,
    }));
  if (platformOn.length) rates = rates.filter((x) => effective.includes(x.code));
  if (services) rates = rates.filter((x) => services.has(`${x.code}:${x.type}`));

  return {
    ok: true,
    rates,
    grams: pkg.grams,
    billableGrams: pkg.billableGrams,
    weightFallback: pkg.missing,
    codEnabled: cod.enabled,
    origin,
    originFrom,
    originName: settings?.kecamatanName || input.storeCity || null,
  };
}
