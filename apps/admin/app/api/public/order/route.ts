import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { alCreatePayment, autolarisConfigured } from "@tokophi/lib/autolaris";
import {
  normalizePhone,
  normalizeName,
  normalizeEmail,
  normalizeAddress,
  normalizePostcode,
  phoneError,
  nameError,
  emailError,
  addressError,
  postcodeError,
  destIdError,
} from "@tokophi/lib/validate";
import { areaById } from "@/lib/data/areas";
import { rateLimited, clientIp } from "@/lib/public-guard";
import { getCodPolicy } from "@/lib/cod";
import { quoteShipping, findRate } from "@/lib/shipping-quote";
import { computeTax } from "@tokophi/lib/tax";
import { IDR } from "@tokophi/lib/format";
import { applyDiscount } from "@/lib/promo";
import { activeFlashPrices } from "@/lib/flash";
import { clientContextFromRequest, enqueuePurchase } from "@/lib/tracking-events";
import { adChannel } from "@/lib/ad-channel";

// Public (no-auth) storefront checkout → creates a REAL order (customer + order + line items),
// then an AutoLaris payment linked to it (unless COD). Runs as owner + explicit store_id (the
// storefront has no session). The order then appears in the merchant admin, payment linked.
//
// ⚠️ THIS ENDPOINT IS THE BOUNDARY; the checkout form is UX. Everything a shopper can type — or a
// script can post — is re-normalised and re-validated here, and every number that decides MONEY is
// recomputed here from the seller's own data:
//   · the ongkir      — RE-QUOTED (lib/shipping-quote.ts). `shipping.cost` from the body is ignored.
//   · the item prices — read from product_variants.price_idr, not from the cart.
//   · the weight      — Σ product_variants.weight_grams (lib/shipping-weight.ts).
//   · the origin      — the seller's pickup district (never a client-posted city).
//   · the province    — resolved from the KiriminAja district id, never from the typed field.
// A claim from the client is not a fact.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Item = { handle?: string; name?: string; price?: number; variant?: string; qty?: number };

/** A rejected request: one Bahasa message the shopper can act on, plus the field it belongs to. */
const bad = (error: string, field?: string, status = 400) =>
  NextResponse.json({ ok: false, error, field }, { status, headers: CORS });

/**
 * The ONE `inventory_levels` row a sale touches: the variant's row at the DEFAULT location.
 *
 * ⚠️ This must stay the single definition, used by the availability pre-check, the `FOR UPDATE`
 * re-check AND the decrement. b1f3603 narrowed only the DECREMENT to this row (a `where variant_id
 * = X` update hit every location row, over-decrementing N× once a variant lives in two warehouses)
 * — but both checks kept aggregating `sum(available)` across ALL locations. That is a read/write
 * mismatch: a variant with 0 at the default location and 5 at warehouse B passes both checks, the
 * decrement drives the DEFAULT row negative, and B's 5 units are never consumed. The cross-location
 * TOTAL stays arithmetically right, which is exactly why it would be slow to notice — the totals
 * reconcile while the per-location ledger is fiction, and the negative row (deliberately unclamped,
 * see the decrement) fires as an oversell alarm on a variant that was never oversold.
 *
 * Identical on today's data: every store has exactly one location, so this row IS the whole sum.
 * Real cross-warehouse fulfilment (pick the location, split the shipment) is a later feature; until
 * then the rule is simply that what we check is what we write.
 */
const defaultLocationRow = (variantId: string) => sql`${schema.inventoryLevels.id} = (
  select il.id from inventory_levels il
  join locations loc on loc.id = il.location_id
  where il.variant_id = ${variantId}
  order by loc.is_default desc, il.id
  limit 1
)`;

/** Thrown inside the write transaction when a variant sold out between the pre-check and the lock. */
class OutOfStock extends Error {
  constructor(public product: string, public available: number) {
    super("out of stock");
  }
}

/** Thrown inside the write transaction when the voucher's last slot went to a concurrent order. */
class VoucherExhausted extends Error {
  constructor(public code: string) {
    super("voucher exhausted");
  }
}

// The storefront lives on a DIFFERENT origin, so a response without CORS headers is UNREADABLE to
// it. Every explicit return below carries them — an uncaught throw does not: Next renders its own
// 500, the browser reports a CORS error, and `checkout.astro`'s `.catch` shows the generic "Gagal
// terhubung ke server."
//
// On THIS endpoint that was not merely a confusing message, it was a DOUBLE CHARGE: the throw could
// land after the order row, its line items and the stock decrement were already written. The shopper
// saw a connection error, pressed Bayar again, and bought the same cart twice with stock decremented
// twice. `/api/public/ongkir` has wrapped its handler for exactly this reason since it shipped; this
// one — the one that writes — did not.
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[order] unhandled:", err);
    return NextResponse.json(
      { ok: false, error: "Terjadi kesalahan saat memproses pesanan. Coba lagi sebentar." },
      { status: 500, headers: CORS },
    );
  }
}

async function handle(req: Request) {
  const limited = rateLimited(req, "order", 10, 60_000, CORS);
  if (limited) return limited;
  let body: {
    storeSlug?: string;
    sessionId?: string; // the storefront checkout session this order came from (checkout_sessions)
    items?: Item[];
    customer?: { name?: string; phone?: string; email?: string };
    address?: { alamat?: string; kota?: string; provinsi?: string; kodepos?: string };
    // `cost` is deliberately NOT read — the price is re-quoted below. `service`/`serviceType` ARE:
    // they say WHICH service the shopper picked, which is a choice, not a price.
    shipping?: { label?: string; cost?: number; service?: string; serviceType?: string; destId?: number };
    destId?: number; // KiriminAja district id the ongkir quote was issued for
    channelCode?: string;
    discountCode?: string; // PROMO P0 — a voucher; validated + priced by lib/promo (never trusted from the body)
    // ADR 0012 — the ad platforms' own cookies, read on the storefront. OPAQUE: never authorization,
    // never priced against, never stored beyond the conversion row; only forwarded to the merchant's
    // own pixel provider as match keys. Length-bounded in clientContextFromRequest.
    trackingCookies?: { fbp?: string; fbc?: string; ga?: string; gcl?: string; ttp?: string; ttclid?: string; utmSource?: string; utmMedium?: string };
  };
  try {
    body = await req.json();
  } catch {
    return bad("Body tidak valid.");
  }
  const items = (body.items ?? []).filter((i) => i.handle && (i.qty ?? 0) > 0);
  if (!items.length) return bad("Keranjang kosong.");
  const channelCode = body.channelCode ?? "cod";
  const isCod = channelCode === "cod";
  // The channel must be one the PLATFORM turned on — `platform_payment_channels` where
  // `enabled AND active` (ADR 0004: channels are a platform decision, super-admin owned). This used
  // to test `AUTOLARIS_KNOWN_CHANNELS`, which is the DISCOVERY roster of everything AutoLaris might
  // support, not our decision — 9 of its 15 codes are switched off in the DB right now.
  //
  // The hole that opened: POST channelCode:"ALFAMART" passed this gate, the order was written and
  // stock decremented, THEN alCreatePayment came back rc=07 — and the response is a 200 carrying
  // `payError`, so checkout.astro treats it as settled and renders the success page. The shopper is
  // told the order worked; the merchant gets a pending order with no payment row and no way for
  // anyone to pay it. Same doctrine as COD: hiding a method in the storefront is UX, THIS is the
  // boundary. The storefront already reads exactly this list (`enabledPaymentChannels`).
  // The row is also what NAMES the channel in the response — the DB is the authority now, so the
  // label the shopper reads comes from the same row that authorised the payment.
  let payChannel: { code: string; label: string; kind: string } | null = null;
  if (!isCod) {
    const [ch] = await db
      .select({
        channel: schema.platformPaymentChannels.channel,
        label: schema.platformPaymentChannels.label,
        kind: schema.platformPaymentChannels.kind,
      })
      .from(schema.platformPaymentChannels)
      .where(
        and(
          eq(schema.platformPaymentChannels.channel, channelCode),
          eq(schema.platformPaymentChannels.enabled, true),
          eq(schema.platformPaymentChannels.active, true),
        ),
      )
      .limit(1);
    if (!ch) return bad("Metode pembayaran tidak tersedia.", "payment");
    payChannel = { code: ch.channel, label: ch.label, kind: ch.kind };
  }

  // resolve store (per-client storefront → one store). Fail CLOSED on a missing slug — the storefront
  // always sends STORE_SLUG, so an absent one is a misconfigured/stray request; defaulting it to a
  // hardcoded demo store (the old `|| "batik-nusantara"`) silently attributed such orders to that shop.
  const slug = (body.storeSlug ?? "").trim();
  if (!slug) return bad("Toko tidak dikenali.");
  const [store] = await db
    .select({ id: schema.stores.id, city: schema.stores.city })
    .from(schema.stores)
    .where(eq(schema.stores.slug, slug))
    .limit(1);
  if (!store) return bad("Toko tidak ditemukan.");

  // ── VALIDATE + NORMALISE THE SHOPPER'S INPUT ──────────────────────────────────────────────────
  // The rules live in @tokophi/lib/validate and are shared with the checkout form, which runs them
  // only so the shopper sees the error early. Normalise generously (anything repairable is repaired,
  // never refused — `0812…`, `+62 812…`, `812…` all become `62812…`), reject narrowly (only what
  // cannot be a real customer). Over-validation is itself a bug: a rule that rejects a legitimate
  // Indonesian name or a brand-new carrier prefix costs a sale, and nobody ever finds out.
  const cust = body.customer ?? {};
  const addr = body.address ?? {};

  const errs: [string, string | null][] = [
    ["nama", nameError(cust.name)],
    ["whatsapp", phoneError(cust.phone)],
    ["email", emailError(cust.email)], // optional — empty is valid, and there is no domain whitelist
    ["alamat", addressError(addr.alamat)],
    ["kodepos", postcodeError(addr.kodepos)], // optional — 5 digits when given
    ["kecamatan", destIdError(body.shipping?.destId ?? body.destId)],
  ];
  const firstErr = errs.find(([, e]) => e);
  if (firstErr) return bad(firstErr[1]!, firstErr[0]);

  const name = normalizeName(cust.name);
  const phone = normalizePhone(cust.phone)!; // phoneError() already proved this resolves → 62xxx
  const email = normalizeEmail(cust.email);
  const alamat = normalizeAddress(addr.alamat);
  const kodepos = normalizePostcode(addr.kodepos) || null;

  // ── KECAMATAN: the only honest check is "does this dest_id resolve?" ──────────────────────────
  // It is picked from a list, so a character rule on the display text proves nothing. The id is what
  // the ongkir was priced against and what the parcel will be booked to — if it does not exist,
  // nothing can ship, so the order is refused rather than written. Kota + Provinsi are then DERIVED
  // from it: the typed versions are a claim (send "DKI Jakarta", ship to Papua) and we already refuse
  // to trust them for COD — so there is no reason to store them either.
  const destId = Number(body.shipping?.destId ?? body.destId);
  const area = await areaById(destId);
  if (!area) return bad("Kecamatan tujuan tidak valid — pilih dari daftar.", "kecamatan");
  const kota = area.city ?? null;
  const provinsi = area.province ?? null;

  // ── ITEMS: the cart says WHAT is being bought, the database says WHAT IT COSTS ────────────────
  // `i.price` from the body is ignored. It used to be summed straight into `orders.subtotal_idr` and
  // into every line item — i.e. the shopper's browser priced the goods, so `price: 0` bought them
  // for nothing. Same class of hole as the client-posted ongkir below. Stock is checked BEFORE
  // anything is written, so an out-of-stock cart is rejected cleanly (real oversell prevention).
  const resolved: { variantId: string; title: string; price: number; qty: number; handle: string }[] = [];
  // Flash sale (PROMO P3): productId → promo price for sales live RIGHT NOW. Applied below per line,
  // ONLY when it undercuts the variant's base price — the storefront advertised it, so the order must
  // honour it; this is where that advertised price becomes money.
  const flash = await activeFlashPrices(store.id);
  // Collected across the WHOLE cart, not thrown at the first mismatch: the shopper should be told
  // everything that moved in one go, and the client needs every corrected price to repair the cart.
  const priceChanges: { handle: string; variant: string; title: string; was: number; now: number }[] = [];

  for (const i of items) {
    const qty = Math.max(1, Math.floor(Number(i.qty) || 1));
    const [prod] = await db
      .select({ id: schema.products.id, title: schema.products.title })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.storeId, store.id),
          eq(schema.products.handle, i.handle!),
          eq(schema.products.status, "active"),
        ),
      )
      .limit(1);
    if (!prod) return bad(`Produk "${i.name ?? i.handle}" sudah tidak tersedia.`, "items");

    const vars = await db
      .select({
        id: schema.productVariants.id,
        title: schema.productVariants.title,
        price: schema.productVariants.priceIdr,
        position: schema.productVariants.position,
      })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, prod.id));
    // A NAMED variant must MATCH. It used to fall through to the position-0 variant whenever the
    // title lookup missed:
    //   (i.variant && vars.find(...)) || vars.sort(...)[0]
    // The `||` fallback is meant for legacy "sizes" products that have no variant rows at all — but
    // it fired for every product. `i.variant` is a string the BROWSER rebuilds and parks in
    // localStorage ("Hitam / L"), so a variant renamed in the Seller editor, reordered options, or a
    // week-old cart all miss the exact-title match — and the order silently became "Putih / S":
    // stock checked against the wrong variant (a sold-out Hitam / L sails through), the wrong one
    // decremented, and the wrong colour and size in the box. The shopper is never told.
    //
    // Same rule the shipping quote already follows: a picked thing that is no longer on offer is
    // REJECTED, never silently substituted. Only a cart that named NO variant takes the default.
    const match = i.variant
      ? vars.find((v) => v.title === i.variant)
      : vars.slice().sort((a, b) => a.position - b.position)[0];
    if (!match) {
      return bad(
        i.variant
          ? `Varian "${i.variant}" untuk "${prod.title}" sudah tidak tersedia. Muat ulang halaman produk.`
          : `Produk "${prod.title}" sudah tidak tersedia.`,
        "items",
      );
    }

    // The row the decrement will actually touch — NOT `sum(available)` across locations (see
    // defaultLocationRow). No row at all → 0, same answer the old `coalesce(sum(…), 0)` gave.
    const [inv] = await db
      .select({ available: schema.inventoryLevels.available })
      .from(schema.inventoryLevels)
      .where(defaultLocationRow(match.id));
    const available = Number(inv?.available ?? 0);
    if (available < qty) return bad(`Stok "${prod.title}" tidak mencukupi (sisa ${available}).`, "items");

    // A live flash sale price overrides the base, but only DOWNWARD (never raises it — a misconfigured
    // sale above list still charges list). Same object the storefront shows as the struck-through deal.
    const flashPrice = flash.get(prod.id);
    const unitPrice = flashPrice != null ? Math.min(match.price, flashPrice) : match.price;

    // ── THE CART IS REFUSED IF ITS PRICE MOVED ───────────────────────────────────────────────────
    //
    // `i.price` is still NOT trusted to price anything — `unitPrice` above is the only price that
    // becomes money. It is used here for one thing: to detect that the browser is holding a stale
    // number. `localStorage.cart` records the price at ADD-TO-CART and keeps it forever, so a flash
    // sale that starts or lapses in between leaves the shopper agreeing to one figure and being
    // charged another. This endpoint used to accept that silently and reprice UPWARD.
    //
    // Same rule the shipping path already follows: a picked service that is not in the fresh quote is
    // REJECTED, never silently substituted. A tolerance would just be a smaller hole.
    //
    // Refused in BOTH directions, deliberately. A drop is good news, but "the number you agreed to is
    // not the number we will take" is the thing being fixed, and a rule that fires one way invites
    // "why didn't it tell me when it fell?". The message says which way it moved so reloading reads
    // as safe rather than as a failure.
    //
    // 409, not 400: nothing has been written (this is before the txn) and the shopper can act on it.
    // Skipped when the client sends no price — the landing funnel posts `{handle, variant, qty}` only,
    // and it re-quotes from a fresh page load anyway.
    const quoted = Number(i.price);
    if (Number.isFinite(quoted) && quoted > 0 && quoted !== unitPrice) {
      priceChanges.push({ handle: i.handle!, variant: i.variant ?? "", title: prod.title, was: quoted, now: unitPrice });
    }

    resolved.push({
      variantId: match.id,
      // The line-item title comes from the DB too — the client's `name` is decoration.
      title: match.title && match.title !== "Default" ? `${prod.title} — ${match.title}` : prod.title,
      price: unitPrice,
      qty,
      handle: i.handle!,
    });
  }
  // ── REFUSE A CART WHOSE PRICE MOVED ──────────────────────────────────────────────────────────
  //
  // `i.price` still prices NOTHING — `unitPrice` is the only price that becomes money. It is compared
  // here for one purpose: to notice that the browser is holding a stale number. `localStorage.cart`
  // records the price at ADD-TO-CART and keeps it forever, so a flash sale that starts or lapses in
  // between left the shopper agreeing to one figure and being charged another. This endpoint used to
  // accept that silently and reprice UPWARD.
  //
  // Same rule the shipping path already follows: a picked service missing from the fresh quote is
  // REJECTED, never silently substituted. A tolerance would just be a smaller hole.
  //
  // Refused in BOTH directions. A drop is good news, but "the number you agreed to is not the number
  // we will take" is the thing being fixed, and a rule that only fires upward invites "why didn't it
  // tell me when it fell?". The message names the direction so reloading reads as safe.
  //
  // ⚠️ `repriced` is returned WITH the refusal, and it is load-bearing: the cart lives in
  // localStorage, so reloading the page does NOT re-price it. Without the corrected prices, "muat
  // ulang keranjang" is advice the shopper cannot act on — they would reload, see the same stale
  // number, press Bayar and be refused again, forever. The client rewrites the cart from this.
  //
  // 409, not 400: nothing has been written (this is before the txn) and the shopper can act on it.
  // Skipped for a client that sends no price — the landing funnel posts `{handle, variant, qty}` only
  // and re-quotes from a fresh page load anyway.
  if (priceChanges.length) {
    const first = priceChanges[0];
    const arah = first.now > first.was ? "naik" : "turun";
    const extra = priceChanges.length > 1 ? ` (dan ${priceChanges.length - 1} produk lain)` : "";
    return NextResponse.json(
      {
        ok: false,
        field: "items",
        error:
          `Harga "${first.title}" ${arah} dari ${IDR(first.was)} menjadi ${IDR(first.now)}${extra}. ` +
          `Keranjang sudah diperbarui — periksa totalnya, lalu tekan Bayar lagi.`,
        repriced: priceChanges.map((c) => ({ handle: c.handle, variant: c.variant, price: c.now })),
      },
      { status: 409, headers: CORS },
    );
  }

  const subtotal = resolved.reduce((a, r) => a + r.price * r.qty, 0);
  // ⚠️ RETURNED TO THE BROWSER, and it must be. The success page used to render `subtotal` and the
  // per-line prices from `localStorage.cart` — captured when the shopper ADDED the item, and kept
  // forever — beside a `total` this endpoint computed. The two are the same number only until a
  // price moves. When a flash sale lapses between add-to-cart and Bayar, this endpoint silently
  // reprices UPWARD (it ignores `items[].price` by design), and the shopper was shown
  // "Subtotal Rp149.000 + Ongkir" over a Total built from Rp219.000 — arithmetic that does not add
  // up, no explanation, and on COD it is the cash the courier asks for.
  // The per-line prices go back too, so the success page can render the lines the ORDER holds
  // rather than the ones the tab remembered.
  const lines = resolved.map((r) => ({ handle: r.handle, title: r.title, qty: r.qty, price: r.price }));

  // ── PPN: server-priced, like everything else here ─────────────────────────────────────────────
  // Read the store's tax settings and compute PPN on the goods subtotal (NOT ongkir — shipping is a
  // pass-through). Off unless the merchant opted in (tax_enabled). computeTax is the SAME helper the
  // checkout display uses, so the shopper is charged exactly what they were shown.
  const [taxCfg] = await db
    .select({
      enabled: schema.storeSettings.taxEnabled, ratePct: schema.storeSettings.taxRatePct, inclusive: schema.storeSettings.taxInclusive,
      freeShipEnabled: schema.storeSettings.freeShipEnabled, freeShipMinIdr: schema.storeSettings.freeShipMinIdr,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, store.id))
    .limit(1);
  const tax = computeTax(subtotal, {
    enabled: taxCfg?.enabled ?? false,
    ratePct: taxCfg?.ratePct ?? 0,
    inclusive: taxCfg?.inclusive ?? false,
  });

  // ── ONGKIR: RE-QUOTED HERE. `body.shipping.cost` is never read ────────────────────────────────
  // The weight fix closed lying about the INPUT; this closes lying about the OUTPUT. The order used
  // to store whatever the browser posted, so `shipping: { cost: 0 }` bought free shipping and the
  // merchant paid the courier the real amount out of their own margin.
  //
  // We do NOT "validate their number against ours" — a tolerance is just a smaller hole. We ignore
  // theirs and write the price WE computed, for the service THEY picked (courier + service_type; a
  // label cannot identify a service). If that service is not in our fresh quote — the seller switched
  // it off, the platform disabled the courier, the route stopped offering it — the order is REJECTED
  // rather than silently moved onto a different, differently-priced courier.
  const svcCode = body.shipping?.service ?? null;
  const svcType = body.shipping?.serviceType ?? null;
  if (!svcCode || !svcType) return bad("Pilih layanan pengiriman.", "shipping");

  const quote = await quoteShipping({
    storeId: store.id,
    storeCity: store.city,
    destinationId: destId,
    items: resolved.map((r) => ({ variantId: r.variantId, handle: r.handle, qty: r.qty })),
    itemValue: subtotal, // the SERVER-priced goods value (insurance) — not the cart's claim
    // ⚠️ SCOPED TO THE COURIER THEY PICKED — and this line is load-bearing in BOTH directions.
    //
    // It must not be the checkout's fast default (`FAST_COURIERS`): the shopper may have opened
    // "Pilih ekspedisi lain" and chosen SiCepat, and `findRate` below REJECTS a service missing from
    // this quote — so every non-SPX/JNE order would die at the last step, on a checkout that had just
    // offered that very courier. A dead checkout, not a slow one.
    //
    // It must not be UNSCOPED either: that is the 5.5s call (measured), paid at the worst possible
    // moment — after the shopper presses Bayar. We only need the price of the ONE service they chose,
    // so ask for that courier alone: 0.5s, and it is by construction always in the answer.
    //
    // This narrows LATENCY, never POLICY: platform ∩ store scope is still applied inside
    // quoteShipping, so naming a courier the merchant disabled still yields no rate and still 400s.
    // `svcCode` IS the courier code (findRate matches rate.code === svcCode).
    couriers: [svcCode],
  });
  // A quote we cannot produce is a parcel we cannot price. Failing the order is the honest outcome:
  // the alternative is falling back to the client's number, which is the bug being closed.
  if (!quote.ok) return bad(quote.error, "shipping");
  const rate = findRate(quote.rates, svcCode, svcType);
  if (!rate) {
    return bad("Layanan pengiriman yang dipilih tidak tersedia lagi. Muat ulang halaman checkout.", "shipping");
  }
  const shippingCost = Math.round(rate.cost);

  // ── VOUCHER (PROMO P0) ─────────────────────────────────────────────────────────────────────────
  // The boundary, same as ongkir/price: the code from the body is a CHOICE, the discount is priced
  // HERE from the seller's own `discounts` row. An invalid/expired/over-limit/below-minimum code is
  // REJECTED (not silently ignored), so the shopper is never charged full on a code they believed
  // applied. `discountIdr` = goods off + shipping off (gratis_ongkir); the order stores it as one line.
  let voucherPriceOff = 0;
  let voucherShipOff = 0;
  let appliedDiscountId: string | null = null;
  let appliedDiscountCode = "";
  if (body.discountCode) {
    const dres = await applyDiscount({ storeId: store.id, code: body.discountCode, subtotal, shippingCost });
    if (!dres.ok) return bad(dres.error, "discount");
    voucherPriceOff = dres.priceOff;
    voucherShipOff = dres.shipOff;
    appliedDiscountId = dres.discount.id;
    appliedDiscountCode = dres.discount.code;
  }

  // ── AUTOMATIC FREE SHIPPING (PROMO P1) ─────────────────────────────────────────────────────────
  // Store-level: goods subtotal ≥ merchant's threshold ⇒ ongkir free, no code needed. Server-priced,
  // so a client can't fake the threshold. It and a `gratis_ongkir` VOUCHER both zero the SAME ongkir —
  // take the LARGER shipping reduction (not the sum), never charging the courier's cost twice.
  const autoFreeShip = taxCfg?.freeShipEnabled && subtotal >= (taxCfg?.freeShipMinIdr ?? 0) ? shippingCost : 0;
  const shipOff = Math.max(voucherShipOff, autoFreeShip);
  const discountIdr = voucherPriceOff + shipOff;

  // Exclusive PPN adds on top; inclusive PPN is already inside `subtotal` (addToTotal = 0). Either way
  // the COD-cap check below and the payment amount both see the real amount the shopper pays.
  const total = subtotal + shippingCost + tax.addToTotal - discountIdr;

  // ── COD is a MONEY decision, so it is enforced here, not in the storefront UI ──────────────────
  // All five switches must agree (lib/cod.ts): platform on, merchant on, total ≤ the platform cap,
  // province on the allow-list, and the SERVICE the shopper picked is COD-allowed. Hiding the option
  // at checkout is UX; this is the boundary — a script posting channelCode:"cod" gets a 403 BEFORE
  // any row is written. The province is the one DERIVED from the district id (above), and `total` is
  // the one WE priced — both were client claims once, and both were the hole.
  if (isCod) {
    // `rate.cod` is the EFFECTIVE flag for THIS destination — KiriminAja's live answer for this
    // actual route (shipping-quote.ts) × the platform's `codAllowed` × the store's switch. It was
    // computed here and then never read: the gate below consults `policy.reason()`, which is built
    // purely from STORED config (platform_couriers.services[].codAllowed), so it cannot know that
    // the courier refuses COD to this particular district. The ongkir response already carries the
    // false flag and the checkout hides the option — but that is the UX layer, and a direct POST of
    // channelCode:"cod" sailed through because key("spx","1") is on the allow-list. The result is a
    // parcel booked COD on a service that will not collect COD there.
    if (!rate.cod) {
      return NextResponse.json(
        { ok: false, error: "COD tidak tersedia untuk layanan dan tujuan ini.", code: "cod_not_allowed" },
        { status: 403, headers: CORS },
      );
    }
    const policy = await getCodPolicy(store.id);
    const reason = policy.reason({ courier: svcCode, serviceType: svcType, total, province: provinsi });
    if (reason) {
      return NextResponse.json({ ok: false, error: reason, code: "cod_not_allowed" }, { status: 403, headers: CORS });
    }
  }

  // ── Customer: keyed on the WhatsApp number, which is now canonical `62…` ───────────────────────
  // In Indonesia the WA number IS the identity (email is optional and often absent). Keying on it
  // only works because it is normalised: the same person used to land twice as `0812…` and
  // `+62 812…`. Email stays a stored attribute, not the key.
  // ── THE WRITE — one transaction ───────────────────────────────────────────────────────────────
  // customer ⋈ order ⋈ line items ⋈ stock were four unguarded statements. A throw between any two
  // left an order with partial line items and partially decremented stock — a half-order nobody can
  // reconcile, because nothing records that it is half. Postgres can simply be asked not to allow it.
  //
  // The external calls stay OUTSIDE: AutoLaris is a network round-trip and must never hold a database
  // transaction open.
  // Payment channel is known before the write; the row is created INSIDE the txn (below) so an order
  // can never commit without one.
  const payMethod = channelCode === "QRIS" ? "qris" : channelCode === "DANA" ? "dana" : "va";
  const alConfigured = autolarisConfigured();
  let customerId: string;
  let order: { id: string; number: string };
  try {
    ({ customerId, order } = await db.transaction(async (tx) => {
      // Customer: keyed on the WhatsApp number (canonical `62…`).
      let cid: string;
      const [existing] = await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.storeId, store.id), eq(schema.customers.phone, phone)))
        .limit(1);
      if (existing) {
        cid = existing.id;
        // Keep the row current with what they just typed (a moved buyer, a newly given email) without
        // ever blanking what we already had.
        await tx
          .update(schema.customers)
          .set({ name, ...(email ? { email } : {}), city: kota, province: provinsi })
          .where(eq(schema.customers.id, existing.id));
      } else {
        const [ins] = await tx
          .insert(schema.customers)
          .values({ storeId: store.id, name, email, phone, city: kota, province: provinsi })
          .returning({ id: schema.customers.id });
        cid = ins.id;
      }

      // ── STOCK: lock, re-check, decrement — all inside the txn ──────────────────────────────────
      // The check up at `available < qty` is a fast fail for the shopper (and saves a pointless
      // KiriminAja call); it is NOT the authority. It read `sum(available)` and the decrement came
      // hundreds of lines later, so two orders for the last unit both passed, both inserted, and both
      // decremented. `GREATEST(… - qty, 0)` then CLAMPED the result at zero — so the oversell left no
      // trace in the data at all: stock read 0, exactly as it would after one honest sale.
      //
      // `FOR UPDATE` serialises concurrent orders for the same variant: the second waits, re-reads the
      // decremented figure, and loses honestly. No clamp — if this arithmetic can go negative the
      // lock is not doing its job, and silently flooring it is how we stopped finding out.
      //
      // It locks (and reads) THE ROW THE DECREMENT WILL WRITE — the same `defaultLocationRow`
      // expression, so check and write can never disagree about which stock is being spent. It used
      // to lock every location row and sum them, which is a total, not the figure being decremented.
      for (const r of resolved) {
        const locked = await tx
          .select({ id: schema.inventoryLevels.id, available: schema.inventoryLevels.available })
          .from(schema.inventoryLevels)
          .where(defaultLocationRow(r.variantId))
          .for("update");
        // At most one row by construction; a missing row is 0 available, exactly as before.
        const have = Number(locked[0]?.available ?? 0);
        if (have < r.qty) throw new OutOfStock(r.title, have);
      }

      // `Date.now().slice(-9)` alone against the GLOBAL `orders_number_unique` constraint: two orders
      // in the same millisecond (different shoppers, different stores) collided and the insert threw —
      // which, before the wrapper above, was a CORS-less 500 on a checkout. The random tail makes that
      // need the same millisecond AND 1-in-46656, and the wrapper now answers honestly if it ever does.
      // Math.random is fine here: an API route, not a render path (the determinism rule in CLAUDE.md
      // is about SSR/hydration).
      // PHI-, not WEB-: ONE prefix for every order on the platform. Three generators used to mint
      // three (WEB- here, INV- and ORD- in the seed) for the same entity — and INV- was shared with
      // subscription INVOICES, so "INV-4517" was an order and "INV-9006" a bill. Migration 0052
      // renamed the existing rows; invoices keep INV-.
      const number =
        "PHI-" +
        Date.now().toString().slice(-9) +
        Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, "0");
      const [ord] = await tx.insert(schema.orders).values({
    storeId: store.id, number, customerId: cid, status: "baru", financialStatus: "pending", channel: adChannel(body.trackingCookies),
    subtotalIdr: subtotal, shippingIdr: shippingCost, taxIdr: tax.taxIdr, discountIdr, totalIdr: total,
    // The courier the shopper actually picked — `rate.code`, i.e. the courier of the fresh server-side
    // quote we matched (svcCode === rate.code by findRate), never the client's raw claim. Recording it
    // here is what makes the per-courier COD return-rate report a `group by courier` instead of an
    // impossibility: without it a regular checkout booked no courier and orders.courier stayed NULL.
    courier: rate.code,
    // …and WHICH of that courier's services. `courier` alone is ambiguous — SPX Standard (type 1) and
    // SPX Economy (type 3) are different products at different prices, and we already matched the
    // shopper's pick on courier+type in the fresh quote above, so throwing the type away here is
    // throwing away the only record of what they actually bought. The admin needs it to auto-book the
    // right service, and it is the join key to platform_couriers.services[].group (1 day / reguler /
    // ekonomi / cargo). Same omission `courier` itself had until d562ee2.
    serviceType: rate.type,
    city: kota, province: provinsi,

    // SNAPSHOT the shipping address onto the order (0042). It is deliberately NOT a lookup back to
    // `customer_addresses`: that lives on the CUSTOMER and changes. Without this, a buyer who moves
    // house silently moves every past order with them — reprint an old label and the parcel goes to
    // the wrong door. The address belongs to the TRANSACTION, not the person.
    //
    // `shipDistrictId` is the KiriminAja kecamatan this order's ongkir was quoted against; it is the
    // same id the COD province gate refuses to trust the typed city over, and it is what the courier
    // will actually be booked to.
    shipRecipient: name,
    shipPhone: phone, // canonical 62xxx — the format KiriminAja books against
    shipAddress: alamat,
    shipPostcode: kodepos,
    shipDistrictId: destId,
  }).returning({ id: schema.orders.id, number: schema.orders.number });

      for (const r of resolved) {
        await tx.insert(schema.orderLineItems).values({
          orderId: ord.id, variantId: r.variantId,
          title: r.title,
          qty: r.qty, priceIdr: r.price, totalIdr: r.price * r.qty,
        });
        // No GREATEST clamp — the rows are locked and re-checked above, so this cannot go negative.
        // Flooring it at 0 is what made an oversell indistinguishable from an honest sell-out.
        // Target ONE row (the default location), not `where variant_id = X`: the latter subtracts qty
        // from EVERY location row of the variant, so the day a variant has stock at two warehouses each
        // sale over-decrements N×. Single-location today, but this is the landmine the schema's
        // unique(variant,location) is built to allow. Real cross-warehouse fulfilment is a later feature.
        // Same expression as both checks above — that shared definition is the point.
        await tx.update(schema.inventoryLevels)
          .set({ available: sql`${schema.inventoryLevels.available} - ${r.qty}` })
          .where(defaultLocationRow(r.variantId));
      }

      // Payment row, ATOMIC with the order. Previously both inserts ran AFTER this txn committed, so a
      // DB blip left a committed order with NO payment: a COD order collectCodOnDelivery can never find,
      // or an AutoLaris order the callback can't match (and the shopper retries → a second order+bill).
      // AutoLaris is a pending shell here; its gateway VA/trxId are filled in after the txn. (An
      // unconfigured-AutoLaris dev store inserts nothing and is handled below.)
      if (isCod) {
        await tx.insert(schema.payments).values({
          orderId: ord.id, storeId: store.id, method: "cod", amountIdr: total, status: "menunggu",
          provider: "cod", reffId: ord.number, channelCode: "COD", total,
        });
      } else if (alConfigured) {
        await tx.insert(schema.payments).values({
          orderId: ord.id, storeId: store.id, method: payMethod, amountIdr: total, status: "menunggu",
          provider: "autolaris", reffId: ord.number, channelCode, total,
        });
      }

      // Record the voucher redemption ATOMIC with the order. `discountUsages` has no store_id — the
      // discountId came from `applyDiscount` scoped to THIS store, so it is safe.
      //
      // ⚠️ The limit is re-checked HERE, in the UPDATE's own WHERE. `applyDiscount` read `usedCount`
      // outside any transaction, unlocked — so N concurrent orders on the last slot all passed it and
      // the bare `usedCount + 1` let every one of them through. The conditional update is the lock:
      // Postgres serialises the row, and whoever loses updates 0 rows and rolls the whole order back.
      if (appliedDiscountId) {
        await tx.insert(schema.discountUsages).values({ discountId: appliedDiscountId, orderId: ord.id });
        const bumped = await tx
          .update(schema.discounts)
          .set({ usedCount: sql`${schema.discounts.usedCount} + 1` })
          .where(
            and(
              eq(schema.discounts.id, appliedDiscountId),
              sql`(${schema.discounts.usageLimit} is null or ${schema.discounts.usedCount} < ${schema.discounts.usageLimit})`,
            ),
          )
          .returning({ id: schema.discounts.id });
        if (!bumped.length) throw new VoucherExhausted(appliedDiscountCode);
      }

      return { customerId: cid, order: ord };
    }));
  } catch (err) {
    if (err instanceof OutOfStock) {
      // 409, not 500: nothing was written (the txn rolled back) and the shopper can act on it.
      return bad(`Stok "${err.product}" tidak mencukupi (sisa ${err.available}).`, "items", 409);
    }
    if (err instanceof VoucherExhausted) {
      // Same shape: the txn rolled back, so no order and no redemption were written. Tell the shopper
      // to drop the code rather than leaving them at a generic failure they cannot act on.
      return bad(`Kuota voucher "${err.code}" baru saja habis. Hapus kodenya untuk melanjutkan.`, "discount", 409);
    }
    throw err; // → the wrapper above, which answers WITH CORS instead of a bare Next 500
  }

  // ── The checkout session BECAME this order (0044) ────────────────────────────────────────────
  // That is the only honest definition of "recovered": not "we sent a WhatsApp and they bought
  // something later", but THIS session turned into THAT order. So it is written here, at the one
  // moment we actually know it — with the order id and the timestamp, so the merchant's recovery
  // number is a join, not a vibe. The session id is the SAME one the funnel beacons carry
  // (Analytics.astro), so the cart joins to its own journey.
  //
  // Scoped to (store_id, session_id) — the UNIQUE key — so this can only ever touch a session that
  // belongs to the store the order was just created in. Non-fatal by design: a paid order must never
  // fail because a marketing table did.
  const checkoutSessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "";
  if (checkoutSessionId) {
    try {
      await db.update(schema.checkoutSessions).set({
        status: "pulih",
        recoveredOrderId: order.id,
        recoveredAt: new Date(),
        customerId, // the guest finally has a customer row — link it back
        updatedAt: new Date(),
      }).where(and(
        eq(schema.checkoutSessions.storeId, store.id),
        eq(schema.checkoutSessions.sessionId, checkoutSessionId),
      ));
    } catch (err) {
      console.error("[order] checkout session recover failed", err);
    }
  }

  // NOTE: the instant (same-day GoSend/Grab) dispatch that used to run here was REMOVED. A web order
  // is now always shipped by the seller from Pesanan → Buat pengiriman (regular expedition couriers).
  // Orders booked as instant BEFORE the removal keep their courier/awb text and render unchanged.

  // ── Conversion tracking (ADR 0012 §14.4) ────────────────────────────────────────────────────────
  // COD is a conversion the moment the order exists (signed off 2026-07-29: "COD = purchase at the
  // thanks page"); a prepaid order only becomes one when the gateway callback confirms payment, so
  // here we merely COMPUTE its ids and let /api/public/pay/callback do the enqueueing.
  // `tracking` is echoed to the browser so the storefront pixel fires the SAME `event_id` and the SAME
  // `content_ids` the server will send — that shared id is the entire de-duplication mechanism.
  // NON-FATAL: a marketing table must never fail an order that is already committed.
  // `browserPurchase` tells the storefront pixel whether THIS page view is a conversion: true for COD,
  // false for prepaid — /checkout/sukses shows an UNPAID virtual account, and counting that as a sale
  // would report every abandoned VA screen as revenue.
  let tracking: { eventId: string; contentIds: string[]; browserPurchase: boolean } | null = null;
  try {
    // Both paths enqueue HERE, because this request is the only place the shopper's user agent, IP and
    // ad-platform cookies exist — a prepaid row is just created on hold and released by the callback.
    const client = clientContextFromRequest(req, clientIp(req), body.trackingCookies);
    const facts = await enqueuePurchase(store.id, order.id, client, { hold: !isCod });
    if (facts) tracking = { eventId: facts.eventId, contentIds: facts.contentIds, browserPurchase: isCod };
  } catch (err) {
    console.error("[order] tracking enqueue failed", err);
  }

  // COD → the payment row was already written inside the order txn (collected on delivery, no gateway).
  if (isCod) {
    return NextResponse.json({ ok: true, orderNumber: order.number, cod: true, subtotal, lines, shipping: shippingCost, tax: tax.taxIdr, discount: discountIdr, total, tracking }, { headers: CORS });
  }

  // AutoLaris: the pending payment row already exists (written in the txn); the gateway call below
  // enriches it. If AutoLaris isn't configured, no row was written and there is nothing to enrich.
  if (!alConfigured) {
    return NextResponse.json({ ok: true, orderNumber: order.number, error: "Pembayaran belum dikonfigurasi.", tracking }, { headers: CORS });
  }
  // THIS is where the double charge came from. `alCreatePayment` does an unguarded `await res.json()`
  // (packages/lib/src/autolaris.ts), so a network blip or a gateway's HTML 502 page THROWS rather
  // than returning `{ok:false}` — and by this line the order, its line items and the stock decrement
  // are already committed. The throw escaped as a CORS-less 500, the shopper read "Gagal terhubung ke
  // server.", pressed Bayar again, and bought the same cart twice.
  //
  // A throw and an rc=07 are the same event to a shopper: the payment did not start. So they take the
  // same exit — the `payError` path that already existed, one line below. The order stands (it is
  // real and paid-for-later), nothing is written twice, and the merchant sees an order with no
  // payment row instead of two orders.
  let pay: Awaited<ReturnType<typeof alCreatePayment>>;
  try {
    pay = await alCreatePayment({
      reffId: order.number, channelCode, amount: total,
      customerId, customerName: name,
      customerPhone: phone, customerEmail: email || "order@tokophi.id",
      callbackUrl: (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback",
    });
  } catch (err) {
    console.error("[order] alCreatePayment threw for", order.number, err);
    pay = { ok: false, error: "Pembayaran tidak dapat dimulai. Hubungi penjual dengan nomor pesanan ini." };
  }
  if (!pay.ok) {
    return NextResponse.json({ ok: true, orderNumber: order.number, payError: pay.error, tracking }, { headers: CORS });
  }
  // Enrich the pending payment row (created atomically in the txn) with the gateway's VA/trxId/fees.
  // If this UPDATE were to fail, the order still has its payment row (pending) and the callback can
  // still match it by reffId — no orphaned order, no double bill on retry.
  await db.update(schema.payments).set({
    trxId: pay.trxId, adminFee: pay.admin ?? 0, total: pay.total ?? total,
    virtualAccount: pay.virtualAccount, qr: pay.qr, url: pay.url, paymentCode: pay.paymentCode,
  }).where(eq(schema.payments.orderId, order.id));
  // `payChannel` is set by the gate above for every non-COD order, and the COD path returned long
  // before here — so the `??` is unreachable. It exists because this line runs AFTER the payment was
  // created, and it must not be the thing that throws. It used to be
  // `AUTOLARIS_KNOWN_CHANNELS.find(...)!` — a non-null assertion against a roster this endpoint no
  // longer validates against, so a channel enabled in the DB but missing from that list would 500
  // with the shopper's money already in flight and the order already written.
  const channel = payChannel ?? { code: channelCode, label: channelCode, kind: "va" };
  return NextResponse.json({
    ok: true, orderNumber: order.number,
    // The ongkir + total the SERVER decided, echoed back so a stale quote in the browser cannot leave
    // the shopper believing a number the order does not contain.
    subtotal, lines, shipping: shippingCost, tax: tax.taxIdr, discount: discountIdr, total,
    tracking,
    payment: {
      channel: { code: channel.code, label: channel.label, kind: channel.kind },
      virtualAccount: pay.virtualAccount, qr: pay.qr, paymentCode: pay.paymentCode, url: pay.url,
      amount: pay.amount, admin: pay.admin, total: pay.total,
    },
  }, { headers: CORS });
}
