import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { kaShippingPrice, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { mgEstimate, mgCourierCode, type MgRate } from "@tokophi/lib/mengantar";
import { getProviderConfig, DEFAULT_SHIPPING_PROVIDER, type MengantarConfig, type ShippingProvider } from "@tokophi/lib/provider-config";
import { openStoreMengantar } from "@tokophi/db/mengantar-account";
import { cacheGet, cacheSet } from "@tokophi/lib/cache";
import { courierName, isInstantCourier, isInstantService } from "@tokophi/lib/couriers";
import { resolveArea, mengantarDestination } from "@/lib/data/areas";
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
      /**
       * WHO priced this quote — the platform switch at the moment of quoting. `/api/public/order`
       * stamps it onto `orders.shipping_provider`, so booking/tracking follow the provider that set
       * the price, never whatever the switch says later.
       */
      provider: ShippingProvider;
      /** Mengantar only: the destination area `_id` the price was built for (→ `orders.ship_mengantar_area_id`). */
      destinationAreaId: string | null;
      origin: number;
      /** "pickup" = the seller's saved pickup district · "store-city" = a fuzzy match on the store's city */
      originFrom: "pickup" | "store-city";
      originName: string | null;
    }
  | {
      ok: false;
      error: string;
      /**
       * TRUE when `error` is the AGGREGATOR'S OWN text, not ours.
       *
       * ADR 0004 hides the provider's brand — and its voice — from merchants and shoppers, so the
       * two public routes substitute their own copy for these and log this one. The SELLER-facing
       * caller (`actions/shipping.ts` → "Cek Ongkir") keeps showing it: the merchant is who has to
       * act on "sudah melewati jam cut-off", and the super-admin surface is where brands are
       * allowed. A single unflagged string cannot tell the two apart, which is why this exists
       * rather than a blanket rewrite here.
       */
      fromProvider?: true;
    };

export type QuoteInput = {
  storeId: string;
  /** stores.city — only used as the fallback origin when no pickup address is set */
  storeCity?: string | null;
  destinationId: number;
  /**
   * The kelurahan NAME the shopper picked, when they picked one (the order API has it; the ongkir
   * route only when the checkout sends it). A claim, re-matched exactly inside `destinationId` —
   * used by the Mengantar branch only, whose area ids are kelurahan-grain. KiriminAja ignores it.
   */
  kelurahan?: string | null;
  items: CartItemRef[];
  /** declared goods value, for insurance. Comes from the SERVER-priced subtotal in the order API. */
  itemValue?: number;
  /**
   * Narrow the KiriminAja call to these courier codes. **This is a LATENCY control, not a policy
   * one** — platform ∩ store scope is still applied to whatever comes back, so passing a courier the
   * merchant switched off still yields nothing. Omit = every courier.
   *
   * Why it exists (measured against the live API, same route, 2026-07-17):
   *   · every courier → **5.50s / 5.45s** (16 / 14 services)
   *   · `["spx","jne"]` → **0.65s / 0.54s** (3 services)
   * KiriminAja aggregates per courier and the slowest carrier sets the pace, so the shopper waits
   * ~5.5s for carriers they did not ask about. ~10x, and it is the FIRST quote every shopper pays:
   * each has a unique destination, so the 10-min cache is always cold for them.
   *
   * ⚠️ The order API MUST scope this to the courier the shopper actually picked. `/api/public/order`
   * re-quotes and REJECTS a service missing from the fresh quote (see route.ts), so re-quoting with
   * the checkout's fast default while the shopper chose SiCepat would reject every such order — a
   * dead checkout, not a slow one.
   */
  couriers?: string[];
  /**
   * The order is COD. COD ALWAYS quotes (and therefore books) through the default provider (owner
   * O4/O6: "COD default = KiriminAja"), whatever the switch says. `/api/public/order` sets it from the
   * payment method it validated; the ongkir route passes the checkout's optional `cod: true` hint.
   */
  cod?: boolean;
};

/**
 * The couriers the checkout quotes UP FRONT. Everything else is one click away ("Pilih ekspedisi
 * lain"), which fires a second, unfiltered quote and pays the 5.5s only for shoppers who ask.
 *
 * SPX and JNE, because that pair is not arbitrary: **SPX is the only courier COD is allowed on**
 * (platform_couriers[].codAllowed — see AGENTS.md), so dropping it would silently take COD off the
 * default view, and JNE is the widest-reaching regular service. A merchant who has switched both off
 * still gets a correct (empty) fast list and their real options behind the disclosure — no rates are
 * hidden by policy here, only deferred.
 */
export const FAST_COURIERS = ["spx", "jne"] as const;

/** Find the rate the shopper picked inside a fresh quote. Courier + service_type — a label cannot. */
export function findRate(rates: QuotedRate[], code?: string | null, type?: string | null): QuotedRate | null {
  if (!code || !type) return null;
  const c = String(code).trim().toLowerCase();
  const t = String(type).trim();
  return rates.find((r) => r.code.toLowerCase() === c && String(r.type) === t) ?? null;
}

/**
 * Can ANY store quote right now? The public ongkir route asks before it resolves the store. The default
 * provider is the fallback for every unconnected store (O6), so it is what this answers for — plus "the
 * switch is on Mengantar" (connected stores quote with their own key).
 */
export async function shippingConfigured(): Promise<boolean> {
  return kiriminajaConfigured() || (await getProviderConfig()).shipping === "mengantar";
}

/**
 * THE DISPATCH. Quote and re-quote both come through here, so a checkout's price and the order's
 * stored price come from the same provider for the same (store, switch, COD) inputs.
 *
 *   · switch = Mengantar AND not COD AND the store has a CONNECTED Mengantar account → Mengantar, with
 *     THE STORE'S OWN seller key (partner model).
 *   · anything else → the default provider. A store that is not connected FALLS BACK (owner O6); COD
 *     always goes the default way. The quote's `provider` field says which one actually priced it, and
 *     `/api/public/order` stamps exactly that onto `orders.shipping_provider`.
 *
 *   · a connected store whose Mengantar quote fails or prices nothing → the default provider as well.
 *
 * ⚠️ A store's connection can change between the checkout quote and the order re-quote (rare: a
 * registration finishing in between). The order route then re-quotes on the other provider and refuses
 * a service id that is not in the fresh quote — "pilih ulang ongkir", never a silent price switch.
 */
export async function quoteShipping(input: QuoteInput): Promise<Quote> {
  const cfg = await getProviderConfig();
  // The switch is honoured only where THIS process names its Mengantar env: an unset `MENGANTAR_ENV`
  // reads as sandbox, and quoting real checkouts there would book parcels no courier collects. The
  // Super Admin switch checks its own process; this is the check that holds where orders are priced
  // (and it also covers a provider chosen by the `SHIPPING_PROVIDER` env with no DB row).
  if (cfg.shipping === "mengantar" && !input.cod && cfg.mengantar.envSource !== "env") {
    console.warn("[shipping/quote] shipping provider is mengantar but MENGANTAR_ENV is not set in this process — quoting the default provider");
  } else if (cfg.shipping === "mengantar" && !input.cod) {
    const acc = await openStoreMengantar(input.storeId);
    if (acc.ok) {
      const mg = await quoteMengantar(input, acc.cfg);
      if (mg.ok && mg.rates.length) return mg;
      // An empty SCOPED answer (the fast pair) is not "Mengantar cannot ship here" while the full list
      // has rates: falling back for the fast scope alone would paint one provider's prices beside the
      // other's. Decide on the FULL scope (the estimate is cached per route, so this is no second call).
      if (mg.ok && input.couriers) {
        const all = await quoteMengantar({ ...input, couriers: undefined }, acc.cfg);
        if (all.ok && all.rates.length) return mg;
      }
      // A connected store whose Mengantar quote cannot sell anything here (no origin area, a district
      // with no representative, every courier filtered out, or the provider down) FALLS BACK like an
      // unconnected one (O6) instead of leaving the shopper with no shipping — and so no order. The
      // order route re-quotes through this same function, so it lands on the same provider.
      console.warn("[shipping/quote] mengantar could not quote; falling back to the default provider:", mg.ok ? "no rates" : mg.error);
    }
  }
  return quoteKiriminaja(input, DEFAULT_SHIPPING_PROVIDER);
}

async function quoteKiriminaja(input: QuoteInput, provider: Exclude<ShippingProvider, "mengantar">): Promise<Quote> {
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

  const r = await kaShippingPrice({
    origin,
    destination: input.destinationId,
    weight: pkg.billableGrams,
    // The same box `createShipment` books — see the note on CartWeight. Without these the quote
    // prices on weight alone while the booking prices volumetrically, and the gap is the merchant's.
    lengthCm: pkg.lengthCm,
    widthCm: pkg.widthCm,
    heightCm: pkg.heightCm,
    itemValue: input.itemValue || 0,
    insurance: 0,
    // Latency scope only — the platform ∩ store filter below still decides what a shopper may pick.
    ...(input.couriers?.length ? { couriers: input.couriers } : {}),
  });
  // `r.error` is the aggregator's `text` field, verbatim — flagged so the public (shopper-facing)
  // routes can substitute their own copy while the seller's Cek Ongkir keeps the diagnostic.
  if (!r.ok) return { ok: false, error: r.error ?? "Gagal mengambil tarif.", fromProvider: true };

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
    provider,
    destinationAreaId: null,
    origin,
    originFrom,
    originName: settings?.kecamatanName || input.storeCity || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MENGANTAR (SHIP-MENGANTAR, phase 1 = NON-COD)
//
// Same contract as the KiriminAja branch — same inputs, same `QuotedRate` shape, same "the server
// prices, the client only says what and where" — with three provider differences made explicit:
//   · ids    — origin = `store_settings.sender_mengantar_area_id` (the seller's, never the client's;
//              NO fuzzy store-city fallback: a Mengantar origin we do not hold is "not set up");
//              destination = `mengantarDestination()` (picked kelurahan → district representative →
//              unavailable). The checkout keeps sending KiriminAja district ids.
//   · weight — the SAME `weightForCart` sum of every line, `billableGrams` (1 kg floor), sent as KG.
//              Mengantar takes no dimensions (analysis §1.3 trap 7).
//   · COD    — every Mengantar rate is `cod: false` and the quote says `codEnabled: false`, whatever
//              the provider's `unsupported_cod` says. COD never travels Mengantar (owner O4): a COD
//              order is quoted by the default provider (`quoteShipping`, `cod: true`).
// ─────────────────────────────────────────────────────────────────────────────

const MG_PRICE_TTL = 10 * 60 * 1000;

/**
 * The cache key of a Mengantar estimate. The PROVIDER is its first segment (KiriminAja's live under
 * `ka:price:`), then a one-way fingerprint of host + key (a rotated key is a different account), then
 * every price input: origin, destination, kg. No dimensions — Mengantar does not take them. No COD
 * amount — phase 1 never sends `COD_AMOUNT`.
 */
export function mgEstimateCacheKey(cfg: Pick<MengantarConfig, "base" | "key">, originId: string, destinationId: string, kg: number): string {
  // Per SELLER: each store's key is its own account with its own volume discount — never one shared entry.
  const fp = createHash("sha256").update(`${cfg.base}\n${cfg.key}`).digest("hex").slice(0, 12);
  return `mengantar:estimate:${fp}:${originId}:${destinationId}:${kg}`;
}

export type MgScope = {
  /** platform_couriers enabled (instant excluded). EMPTY = NOTHING is quotable. */
  platformOn: string[];
  /** store_settings.couriers — null = the merchant never narrowed it. */
  merchant: string[] | null;
  /** the store's ENABLED store_shipping_methods rows (KiriminAja and/or Mengantar keyed). */
  picked: { courier: string; service: string }[];
  /**
   * `courier:service` → the KiriminAja speed class of that service (`platform_couriers.services[].group`),
   * from `kaServiceGroups`. Lets rule 3 count a courier only for the classes Mengantar actually sells.
   * Absent / unknown key = no class known (the row still counts, as before).
   */
  kaGroups?: ReadonlyMap<string, string>;
};

/** Mengantar sells these KiriminAja classes; Same Day / Next Day / Kargo have no Mengantar equivalent. */
const MG_SELLABLE_KA_GROUPS = new Set(["regular", "reguler", "economy"]);

/** `platform_couriers` rows → `courier:service` → group, for `MgScope.kaGroups`. Legacy string entries are skipped. */
export function kaServiceGroups(rows: { courier: string; services: unknown }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    for (const s of Array.isArray(r.services) ? r.services : []) {
      if (s && typeof s === "object" && typeof s.type === "string" && typeof s.group === "string") out.set(`${r.courier}:${s.type}`, s.group.toLowerCase());
    }
  }
  return out;
}

/**
 * MgRate[] → QuotedRate[] under the courier rule (written down in the analysis doc, "Quote/checkout
 * wiring"). Pure, so it is tested without a database.
 *
 *   1. PLATFORM: the rate's TokoΦ courier (`mgCourierCode`) must be platform-enabled. An empty
 *      platform list means NO rates — never "all allowed" (the KiriminAja branch's `if
 *      (platformOn.length)` is the backup doc's §9.1 finding; it is not copied here).
 *   2. STORE courier column: when set, the courier must be in it.
 *   3. STORE per-service selection (`store_shipping_methods`, keyed courier + service):
 *      · rows whose `service` is a Mengantar estimate key OF THAT courier exist → only those keys;
 *      · otherwise, if the store has KiriminAja rows → only the COURIERS those rows name (the merchant
 *        who ships "JNE + SPX" keeps shipping JNE + SPX after the switch, at every service Mengantar
 *        offers for them, until they save a Mengantar selection) — and only through rows of a class
 *        Mengantar sells (Reguler / Hemat, `kaGroups`): a seller who enabled JNE YES but switched JNE
 *        Reguler OFF is not offered JNE Reguler through Mengantar. A store whose rows are all Same Day /
 *        Next Day / Kargo therefore gets no Mengantar rate, and the quote falls back (O6);
 *      · no rows at all → no further narrowing (rules 1–2 still apply).
 *   4. Unknown/cargo keys (`mgCourierCode` null) are never quoted.
 */
export function mengantarRates(rates: MgRate[], scope: MgScope): QuotedRate[] {
  const platform = new Set(scope.platformOn);
  const merchant = scope.merchant ? new Set(scope.merchant) : null;
  const mgPicked = scope.picked.filter((p) => mgCourierCode(p.service) === p.courier);
  const services = mgPicked.length ? new Set(mgPicked.map((p) => `${p.courier}:${p.service.toLowerCase()}`)) : null;
  const sellable = (p: { courier: string; service: string }) => {
    const g = scope.kaGroups?.get(`${p.courier}:${p.service}`);
    return !g || MG_SELLABLE_KA_GROUPS.has(g);
  };
  const kaCouriers = !services && scope.picked.length ? new Set(scope.picked.filter(sellable).map((p) => p.courier)) : null;
  const out: QuotedRate[] = [];
  for (const r of rates) {
    const code = mgCourierCode(r.key);
    if (!code) continue;
    if (!platform.has(code)) continue;
    if (merchant && !merchant.has(code)) continue;
    if (services && !services.has(`${code}:${r.key.toLowerCase()}`)) continue;
    if (kaCouriers && !kaCouriers.has(code)) continue;
    out.push({
      name: /lite$/i.test(r.key) ? `${courierName(code)} Lite` : courierName(code),
      code,
      type: r.key,
      // `price` = the public courier charge, what the SHOPPER pays. `r.cost` (estimatedSpecialPrice,
      // the integrator discount) is never a shopper price (analysis §1.3 trap 6).
      cost: r.price,
      etd: r.etd,
      cod: false, // phase 1: COD via Mengantar is CLOSED regardless of the provider's flag
      group: r.group,
    });
  }
  return out;
}

async function quoteMengantar(input: QuoteInput, mg: MengantarConfig): Promise<Quote> {
  if (!Number.isFinite(input.destinationId) || input.destinationId <= 0) {
    return { ok: false, error: "Tujuan belum dipilih." };
  }

  const platformRows = await db
    .select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled, services: schema.platformCouriers.services })
    .from(schema.platformCouriers);
  const platformOn = platformRows.filter((p) => p.enabled && !isInstantCourier(p.courier)).map((p) => p.courier);

  const [settings] = await db
    .select({
      kecamatanId: schema.storeSettings.senderKecamatanId,
      kecamatanName: schema.storeSettings.senderKecamatanName,
      mengantarAreaId: schema.storeSettings.senderMengantarAreaId,
      couriers: schema.storeSettings.couriers,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, input.storeId))
    .limit(1);

  // ORIGIN — the seller's own Mengantar area id, nothing else. No store-city fuzzy fallback here: a
  // Mengantar quote from a guessed origin would be a price for a pickup we cannot book.
  const origin = settings?.mengantarAreaId?.trim();
  if (!origin) return { ok: false, error: "Alamat pengambilan toko belum diatur." };

  // PRICE vs BOOKING destination (analysis §3.5 option a). The PRICE is always quoted to the kecamatan's
  // representative area, because the storefront asks for rates before (and often without) a kelurahan,
  // while /api/public/order re-quotes WITH one: quoting both to the same district area is what keeps
  // "price shown" == "price charged". The kelurahan (when known) is only the BOOKING address, stamped
  // on the order as `ship_mengantar_area_id`. Whether Mengantar prices differ by kelurahan inside one
  // kecamatan is UNVERIFIED — this choice makes the answer irrelevant to what the shopper pays.
  const priceDest = await mengantarDestination(input.destinationId, null);
  if (!priceDest) return { ok: false, error: "Ongkir belum tersedia untuk kecamatan ini." };
  const dest = (await mengantarDestination(input.destinationId, input.kelurahan)) ?? priceDest;

  const picked = await db
    .select({ courier: schema.storeShippingMethods.courier, service: schema.storeShippingMethods.service })
    .from(schema.storeShippingMethods)
    .where(and(eq(schema.storeShippingMethods.storeId, input.storeId), eq(schema.storeShippingMethods.enabled, true)));

  const cart = (input.items ?? []).filter((i) => (i.qty ?? 0) > 0);
  if (!cart.length) return { ok: false, error: "Keranjang kosong — ongkir tidak bisa dihitung." };
  const pkg = await weightForCart(db, input.storeId, cart);
  // Σ of EVERY line (weightForCart), with the 1 kg floor, in KG — never the first line alone
  // (adsbookcms A1). The booking must send this same figure.
  const kg = pkg.billableGrams / 1000;

  const cacheKey = mgEstimateCacheKey(mg, origin, priceDest.areaId, kg);
  let all = cacheGet<MgRate[]>(cacheKey);
  if (!all) {
    let r: Awaited<ReturnType<typeof mgEstimate>>;
    try {
      r = await mgEstimate({ originId: origin, destinationId: priceDest.areaId, kg }, { cfg: mg });
    } catch (e) {
      // Transport failures / 403 refusals are the provider's words — flagged so the public routes
      // substitute SHIPPING_QUOTE_UNAVAILABLE (ADR 0004).
      return { ok: false, error: e instanceof Error ? e.message : "Gagal mengambil tarif.", fromProvider: true };
    }
    if (!r.ok) return { ok: false, error: r.error || "Gagal mengambil tarif.", fromProvider: true };
    all = r.data;
    // Same rule as KiriminAja: an empty answer is not cached.
    if (all.length > 0) cacheSet(cacheKey, all, MG_PRICE_TTL);
  }

  let rates = mengantarRates(all, { platformOn, merchant: settings?.couriers ?? null, picked, kaGroups: kaServiceGroups(platformRows) });
  // `couriers` is a LATENCY scope for KiriminAja. Mengantar answers every courier in one call, so here
  // it only keeps the response the same shape the checkout expects (fast pair first, the rest on
  // "Pilih ekspedisi lain"). It narrows; it can never widen past the policy above.
  if (input.couriers?.length) {
    const want = new Set(input.couriers.map((c) => c.toLowerCase()));
    rates = rates.filter((x) => want.has(x.code));
  }

  return {
    ok: true,
    rates,
    grams: pkg.grams,
    billableGrams: pkg.billableGrams,
    weightFallback: pkg.missing,
    codEnabled: false,
    provider: "mengantar",
    destinationAreaId: dest.areaId,
    origin: settings?.kecamatanId ?? 0,
    originFrom: "pickup",
    originName: settings?.kecamatanName || input.storeCity || null,
  };
}
