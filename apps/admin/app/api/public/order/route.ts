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
import { rateLimited } from "@/lib/public-guard";
import { getCodPolicy } from "@/lib/cod";
import { quoteShipping, findRate } from "@/lib/shipping-quote";

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

/** Thrown inside the write transaction when a variant sold out between the pre-check and the lock. */
class OutOfStock extends Error {
  constructor(public product: string, public available: number) {
    super("out of stock");
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

  // resolve store (per-client storefront → one store)
  const [store] = await db
    .select({ id: schema.stores.id, city: schema.stores.city })
    .from(schema.stores)
    .where(eq(schema.stores.slug, body.storeSlug || "batik-nusantara"))
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

    const [inv] = await db
      .select({ available: sql<number>`coalesce(sum(${schema.inventoryLevels.available}), 0)` })
      .from(schema.inventoryLevels)
      .where(eq(schema.inventoryLevels.variantId, match.id));
    const available = Number(inv?.available ?? 0);
    if (available < qty) return bad(`Stok "${prod.title}" tidak mencukupi (sisa ${available}).`, "items");

    resolved.push({
      variantId: match.id,
      // The line-item title comes from the DB too — the client's `name` is decoration.
      title: match.title && match.title !== "Default" ? `${prod.title} — ${match.title}` : prod.title,
      price: match.price,
      qty,
      handle: i.handle!,
    });
  }
  const subtotal = resolved.reduce((a, r) => a + r.price * r.qty, 0);

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
  });
  // A quote we cannot produce is a parcel we cannot price. Failing the order is the honest outcome:
  // the alternative is falling back to the client's number, which is the bug being closed.
  if (!quote.ok) return bad(quote.error, "shipping");
  const rate = findRate(quote.rates, svcCode, svcType);
  if (!rate) {
    return bad("Layanan pengiriman yang dipilih tidak tersedia lagi. Muat ulang halaman checkout.", "shipping");
  }
  const shippingCost = Math.round(rate.cost);
  const total = subtotal + shippingCost;

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
      for (const r of resolved) {
        const locked = await tx
          .select({ id: schema.inventoryLevels.id, available: schema.inventoryLevels.available })
          .from(schema.inventoryLevels)
          .where(eq(schema.inventoryLevels.variantId, r.variantId))
          .for("update");
        const have = locked.reduce((n, l) => n + Number(l.available ?? 0), 0);
        if (have < r.qty) throw new OutOfStock(r.title, have);
      }

      // `Date.now().slice(-9)` alone against the GLOBAL `orders_number_unique` constraint: two orders
      // in the same millisecond (different shoppers, different stores) collided and the insert threw —
      // which, before the wrapper above, was a CORS-less 500 on a checkout. The random tail makes that
      // need the same millisecond AND 1-in-46656, and the wrapper now answers honestly if it ever does.
      // Math.random is fine here: an API route, not a render path (the determinism rule in CLAUDE.md
      // is about SSR/hydration).
      const number =
        "WEB-" +
        Date.now().toString().slice(-9) +
        Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, "0");
      const [ord] = await tx.insert(schema.orders).values({
    storeId: store.id, number, customerId: cid, status: "baru", financialStatus: "pending", channel: "organic",
    subtotalIdr: subtotal, shippingIdr: shippingCost, totalIdr: total,
    // The courier the shopper actually picked — `rate.code`, i.e. the courier of the fresh server-side
    // quote we matched (svcCode === rate.code by findRate), never the client's raw claim. Recording it
    // here is what makes the per-courier COD return-rate report a `group by courier` instead of an
    // impossibility: without it a regular checkout booked no courier and orders.courier stayed NULL.
    courier: rate.code,
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
        await tx.update(schema.inventoryLevels)
          .set({ available: sql`${schema.inventoryLevels.available} - ${r.qty}` })
          .where(eq(schema.inventoryLevels.variantId, r.variantId));
      }

      return { customerId: cid, order: ord };
    }));
  } catch (err) {
    if (err instanceof OutOfStock) {
      // 409, not 500: nothing was written (the txn rolled back) and the shopper can act on it.
      return bad(`Stok "${err.product}" tidak mencukupi (sisa ${err.available}).`, "items", 409);
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

  // COD → order created; record a COD payment (collected on delivery), no gateway bill
  if (isCod) {
    await db.insert(schema.payments).values({
      orderId: order.id, storeId: store.id, method: "cod", amountIdr: total, status: "menunggu",
      provider: "cod", reffId: order.number, channelCode: "COD", total,
    });
    return NextResponse.json({ ok: true, orderNumber: order.number, cod: true, shipping: shippingCost, total }, { headers: CORS });
  }

  // create the AutoLaris payment + link it to the order
  if (!autolarisConfigured()) {
    return NextResponse.json({ ok: true, orderNumber: order.number, error: "Pembayaran belum dikonfigurasi." }, { headers: CORS });
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
    return NextResponse.json({ ok: true, orderNumber: order.number, payError: pay.error }, { headers: CORS });
  }
  const method = channelCode === "QRIS" ? "qris" : channelCode === "DANA" ? "dana" : "va";
  await db.insert(schema.payments).values({
    orderId: order.id, storeId: store.id, method, amountIdr: total, status: "menunggu",
    provider: "autolaris", reffId: order.number, trxId: pay.trxId, channelCode,
    adminFee: pay.admin ?? 0, total: pay.total ?? total,
    virtualAccount: pay.virtualAccount, qr: pay.qr, url: pay.url, paymentCode: pay.paymentCode,
  });
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
    shipping: shippingCost, total,
    payment: {
      channel: { code: channel.code, label: channel.label, kind: channel.kind },
      virtualAccount: pay.virtualAccount, qr: pay.qr, paymentCode: pay.paymentCode, url: pay.url,
      amount: pay.amount, admin: pay.admin, total: pay.total,
    },
  }, { headers: CORS });
}
