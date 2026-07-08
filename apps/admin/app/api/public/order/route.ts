import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { alCreatePayment, autolarisConfigured, PAYMENT_CHANNELS } from "@/lib/autolaris";

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
  let body: {
    storeSlug?: string;
    items?: Item[];
    customer?: { name?: string; phone?: string; email?: string };
    address?: { alamat?: string; kota?: string; provinsi?: string; kodepos?: string };
    shipping?: { label?: string; cost?: number };
    channelCode?: string;
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
  if (!isCod && !PAYMENT_CHANNELS.some((c) => c.code === channelCode)) {
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

  const number = "WEB-" + Date.now().toString().slice(-9);
  const [order] = await db.insert(schema.orders).values({
    storeId: store.id, number, customerId, status: "baru", financialStatus: "pending", channel: "organic",
    subtotalIdr: subtotal, shippingIdr: shippingCost, totalIdr: total,
    city: addr.kota ?? null, province: addr.provinsi ?? null,
  }).returning({ id: schema.orders.id, number: schema.orders.number });

  await db.insert(schema.orderLineItems).values(items.map((i) => ({
    orderId: order.id,
    title: i.variant ? `${i.name} — ${i.variant}` : i.name!,
    qty: i.qty ?? 1,
    priceIdr: i.price ?? 0,
    totalIdr: (i.price ?? 0) * (i.qty ?? 1),
  })));

  // COD → order created, no bill
  if (isCod) {
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
  const channel = PAYMENT_CHANNELS.find((c) => c.code === channelCode)!;
  return NextResponse.json({
    ok: true, orderNumber: order.number,
    payment: {
      channel: { code: channel.code, label: channel.label, kind: channel.kind },
      virtualAccount: pay.virtualAccount, qr: pay.qr, paymentCode: pay.paymentCode, url: pay.url,
      amount: pay.amount, admin: pay.admin, total: pay.total,
    },
  }, { headers: CORS });
}
