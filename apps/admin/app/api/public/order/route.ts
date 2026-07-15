import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { alCreatePayment, autolarisConfigured, AUTOLARIS_KNOWN_CHANNELS } from "@tokophi/lib/autolaris";
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

export async function POST(req: Request) {
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
  if (!isCod && !AUTOLARIS_KNOWN_CHANNELS.some((c) => c.code === channelCode)) {
    return bad("Metode pembayaran tidak dikenal.", "payment");
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
    // Same resolution as the weight sum (lib/shipping-weight.ts): the exact combo title, else the
    // default (position-0) variant — legacy "sizes" products have no matching variant row and must
    // still sell.
    const match =
      (i.variant && vars.find((v) => v.title === i.variant)) || vars.slice().sort((a, b) => a.position - b.position)[0];
    if (!match) return bad(`Produk "${prod.title}" sudah tidak tersedia.`, "items");

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
  let customerId: string;
  const [existing] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.storeId, store.id), eq(schema.customers.phone, phone)))
    .limit(1);
  if (existing) {
    customerId = existing.id;
    // Keep the row current with what they just typed (a moved buyer, a newly given email) without
    // ever blanking what we already had.
    await db
      .update(schema.customers)
      .set({ name, ...(email ? { email } : {}), city: kota, province: provinsi })
      .where(eq(schema.customers.id, existing.id));
  } else {
    const [ins] = await db
      .insert(schema.customers)
      .values({ storeId: store.id, name, email, phone, city: kota, province: provinsi })
      .returning({ id: schema.customers.id });
    customerId = ins.id;
  }

  const number = "WEB-" + Date.now().toString().slice(-9);
  const [order] = await db.insert(schema.orders).values({
    storeId: store.id, number, customerId, status: "baru", financialStatus: "pending", channel: "organic",
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
    await db.insert(schema.orderLineItems).values({
      orderId: order.id, variantId: r.variantId,
      title: r.title,
      qty: r.qty, priceIdr: r.price, totalIdr: r.price * r.qty,
    });
    await db.update(schema.inventoryLevels)
      .set({ available: sql`GREATEST(${schema.inventoryLevels.available} - ${r.qty}, 0)` })
      .where(eq(schema.inventoryLevels.variantId, r.variantId));
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
  const pay = await alCreatePayment({
    reffId: order.number, channelCode, amount: total,
    customerId, customerName: name,
    customerPhone: phone, customerEmail: email || "order@tokophi.id",
    callbackUrl: (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback",
  });
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
  const channel = AUTOLARIS_KNOWN_CHANNELS.find((c) => c.code === channelCode)!;
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
