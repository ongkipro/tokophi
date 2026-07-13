import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { alCreatePayment, autolarisConfigured, AUTOLARIS_KNOWN_CHANNELS } from "@tokophi/lib/autolaris";
import { kaCreateInstantOrder } from "@tokophi/lib/kiriminaja";
import { rateLimited } from "@/lib/public-guard";
import { getCodPolicy } from "@/lib/cod";

// Public (no-auth) storefront checkout → creates a REAL order (customer + order + line items),
// then an AutoLaris payment linked to it (unless COD). Runs as owner + explicit store_id (the
// storefront has no session). The order then appears in the merchant admin, payment linked.
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

export async function POST(req: Request) {
  const limited = rateLimited(req, "order", 10, 60_000, CORS);
  if (limited) return limited;
  let body: {
    storeSlug?: string;
    items?: Item[];
    customer?: { name?: string; phone?: string; email?: string };
    address?: { alamat?: string; kota?: string; provinsi?: string; kodepos?: string };
    shipping?: { label?: string; cost?: number; service?: string; serviceType?: string };
    channelCode?: string;
    instant?: { service?: string; serviceType?: string; shippingCosts?: number; destLat?: number; destLng?: number };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body tidak valid." }, { status: 400, headers: CORS });
  }
  const items = (body.items ?? []).filter((i) => i.name && (i.qty ?? 0) > 0);
  if (!items.length) return NextResponse.json({ ok: false, error: "Keranjang kosong." }, { headers: CORS });
  const channelCode = body.channelCode ?? "cod";
  const isCod = channelCode === "cod";
  if (!isCod && !AUTOLARIS_KNOWN_CHANNELS.some((c) => c.code === channelCode)) {
    return NextResponse.json({ ok: false, error: "Metode pembayaran tidak dikenal." }, { headers: CORS });
  }

  // resolve store (per-client storefront → one store)
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, body.storeSlug || "batik-nusantara")).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "Toko tidak ditemukan." }, { headers: CORS });

  const cust = body.customer ?? {};
  const addr = body.address ?? {};
  const subtotal = items.reduce((a, i) => a + (i.price ?? 0) * (i.qty ?? 1), 0);
  const shippingCost = Math.round(body.shipping?.cost ?? 0);
  const total = subtotal + shippingCost;

  // ── COD is a MONEY decision, so it is enforced here, not in the storefront UI ──────────────
  // All five switches must agree (lib/cod.ts): platform on, merchant on, total <= the platform cap,
  // province on the allow-list, and the SERVICE the shopper picked is COD-allowed. Hiding the option
  // at checkout is UX; this is the boundary — a script posting channelCode:"cod" straight at the API
  // gets a 403 BEFORE any row is written, never a silently-downgraded order (which would hide a COD
  // request as a "transfer"). Runs after `total` is known, because the cap is checked against it.
  //
  // ⚠️ HONEST LIMIT — the province is the one the buyer TYPED (body.address.provinsi); we normalise
  // and match it, but we do not VERIFY it. The trustworthy signal would be the province of the
  // KiriminAja destination district the ongkir quote was issued for, but the storefront only sends us
  // the resulting label/cost, not `dest_id`. So a hostile client can claim an allowed province and
  // ship elsewhere. Cap + merchant switch + service allowance ARE hard-enforced; province is
  // enforced only as far as the data we receive permits. Closing it = pass dest_id here and resolve
  // it server-side against the ongkir API.
  if (isCod) {
    const policy = await getCodPolicy(store.id);
    const svc = body.instant?.service ? null : body.shipping?.service; // instant is not in the roster → never COD
    const svcType = body.instant?.service ? null : body.shipping?.serviceType;
    const reason = policy.reason({ courier: svc, serviceType: svcType, total, province: addr.provinsi });
    if (reason) {
      return NextResponse.json({ ok: false, error: reason, code: "cod_not_allowed" }, { status: 403, headers: CORS });
    }
  }

  // upsert customer (by email within store)
  let customerId: string | null = null;
  if (cust.email) {
    const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
      .where(and(eq(schema.customers.storeId, store.id), eq(schema.customers.email, cust.email))).limit(1);
    if (existing) customerId = existing.id;
  }
  if (!customerId) {
    const [ins] = await db.insert(schema.customers).values({
      storeId: store.id, name: cust.name || "Pelanggan", email: cust.email ?? null, phone: cust.phone ?? null,
      city: addr.kota ?? null, province: addr.provinsi ?? null,
    }).returning({ id: schema.customers.id });
    customerId = ins.id;
  }

  // resolve each item → product + variant (by combo title, else default position-0) + check stock
  // BEFORE creating anything, so an out-of-stock cart is rejected cleanly (real oversell prevention).
  const resolved: { i: Item; variantId: string | null; qty: number }[] = [];
  for (const i of items) {
    const qty = i.qty ?? 1;
    let variantId: string | null = null;
    if (i.handle) {
      const [prod] = await db.select({ id: schema.products.id }).from(schema.products)
        .where(and(eq(schema.products.storeId, store.id), eq(schema.products.handle, i.handle))).limit(1);
      if (prod) {
        const vars = await db.select({ id: schema.productVariants.id, title: schema.productVariants.title, position: schema.productVariants.position })
          .from(schema.productVariants).where(eq(schema.productVariants.productId, prod.id));
        const match = (i.variant && vars.find((v) => v.title === i.variant)) || vars.slice().sort((a, b) => a.position - b.position)[0];
        variantId = match?.id ?? null;
      }
    }
    if (variantId) {
      const [inv] = await db.select({ available: sql<number>`coalesce(sum(${schema.inventoryLevels.available}), 0)` })
        .from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, variantId));
      const available = Number(inv?.available ?? 0);
      if (available < qty) {
        return NextResponse.json({ ok: false, error: `Stok "${i.name}" tidak mencukupi (sisa ${available}).` }, { headers: CORS });
      }
    }
    resolved.push({ i, variantId, qty });
  }

  const number = "WEB-" + Date.now().toString().slice(-9);
  const [order] = await db.insert(schema.orders).values({
    storeId: store.id, number, customerId, status: "baru", financialStatus: "pending", channel: "organic",
    subtotalIdr: subtotal, shippingIdr: shippingCost, totalIdr: total,
    city: addr.kota ?? null, province: addr.provinsi ?? null,
  }).returning({ id: schema.orders.id, number: schema.orders.number });

  for (const { i, variantId, qty } of resolved) {
    await db.insert(schema.orderLineItems).values({
      orderId: order.id, variantId,
      title: i.variant ? `${i.name} — ${i.variant}` : i.name!,
      qty, priceIdr: i.price ?? 0, totalIdr: (i.price ?? 0) * qty,
    });
    if (variantId) {
      await db.update(schema.inventoryLevels)
        .set({ available: sql`GREATEST(${schema.inventoryLevels.available} - ${qty}, 0)` })
        .where(eq(schema.inventoryLevels.variantId, variantId));
    }
  }

  // Instant (same-day) → dispatch a driver now from the store's coordinates → save the reference
  const inst = body.instant;
  if (inst?.service && inst.serviceType && inst.shippingCosts && inst.destLat && inst.destLng) {
    const [ss] = await db.select({
      name: schema.storeSettings.senderName, phone: schema.storeSettings.senderPhone,
      address: schema.storeSettings.senderAddress, lat: schema.storeSettings.senderLat, lng: schema.storeSettings.senderLng,
    }).from(schema.storeSettings).where(eq(schema.storeSettings.storeId, store.id)).limit(1);
    const r = await kaCreateInstantOrder({
      orderRef: order.number.replace(/[^A-Za-z0-9]/g, ""),
      service: inst.service, serviceType: inst.serviceType, shippingCosts: inst.shippingCosts,
      origin: {
        name: ss?.name || "Toko", phone: ss?.phone || "081200000000",
        lat: Number(ss?.lat) || -7.8014, long: Number(ss?.lng) || 110.3644, address: ss?.address || "Toko",
      },
      dest: {
        name: cust.name || "Pelanggan", phone: cust.phone || "081200000000",
        lat: inst.destLat, long: inst.destLng, address: addr.alamat || addr.kota || "Rumah",
      },
      item: { name: `Pesanan ${order.number}`, description: items.map((i) => i.name).join(", ").slice(0, 100) || "Barang", price: subtotal, weight: 1000 },
    });
    if (r.ok && r.orderId) {
      await db.update(schema.orders).set({ awb: r.orderId, courier: `${inst.service.toUpperCase()} Instant`, kaOrderId: r.orderId, status: "dikirim" }).where(eq(schema.orders.id, order.id));
    }
  }

  // COD → order created; record a COD payment (collected on delivery), no gateway bill
  if (isCod) {
    await db.insert(schema.payments).values({
      orderId: order.id, storeId: store.id, method: "cod", amountIdr: total, status: "menunggu",
      provider: "cod", reffId: order.number, channelCode: "COD", total,
    });
    return NextResponse.json({ ok: true, orderNumber: order.number, cod: true }, { headers: CORS });
  }

  // create the AutoLaris payment + link it to the order
  if (!autolarisConfigured()) {
    return NextResponse.json({ ok: true, orderNumber: order.number, error: "Pembayaran belum dikonfigurasi." }, { headers: CORS });
  }
  const pay = await alCreatePayment({
    reffId: order.number, channelCode, amount: total,
    customerId: customerId!, customerName: cust.name || "Pelanggan",
    customerPhone: cust.phone || "081200000000", customerEmail: cust.email || "order@tokophi.id",
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
    payment: {
      channel: { code: channel.code, label: channel.label, kind: channel.kind },
      virtualAccount: pay.virtualAccount, qr: pay.qr, paymentCode: pay.paymentCode, url: pay.url,
      amount: pay.amount, admin: pay.admin, total: pay.total,
    },
  }, { headers: CORS });
}
