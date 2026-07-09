import { NextResponse } from "next/server";
import { alCreatePayment, autolarisConfigured, PAYMENT_CHANNELS } from "@tokophi/lib/autolaris";
import { rateLimited } from "@/lib/public-guard";

// Public (no-auth) storefront-facing payment endpoint. The checkout calls this to create a
// real VA/QRIS/DANA bill via the platform PSP (AutoLaris). The brand is NEVER exposed to the
// shopper — only generic channel labels. Platform key stays server-side.
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

export async function POST(req: Request) {
  const limited = rateLimited(req, "pay", 20, 60_000, CORS);
  if (limited) return limited;
  if (!autolarisConfigured()) {
    return NextResponse.json({ ok: false, error: "Pembayaran belum dikonfigurasi." }, { status: 200, headers: CORS });
  }
  let body: { orderRef?: string; channelCode?: string; amount?: number; name?: string; phone?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body tidak valid." }, { status: 400, headers: CORS });
  }
  if (!body.channelCode || !PAYMENT_CHANNELS.some((c) => c.code === body.channelCode)) {
    return NextResponse.json({ ok: false, error: "Metode pembayaran tidak dikenal." }, { headers: CORS });
  }
  if (!body.amount || body.amount < 1) {
    return NextResponse.json({ ok: false, error: "Nominal tidak valid." }, { headers: CORS });
  }

  const callbackUrl = (process.env.PUBLIC_APP_URL ?? "http://localhost:3000") + "/api/public/pay/callback";
  const r = await alCreatePayment({
    reffId: body.orderRef || `TP-${Date.now()}`,
    channelCode: body.channelCode,
    amount: Math.round(body.amount),
    customerId: "storefront",
    customerName: body.name || "Pelanggan",
    customerPhone: body.phone || "081200000000",
    customerEmail: body.email || "order@tokophi.id",
    callbackUrl,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Gagal membuat pembayaran." }, { headers: CORS });
  const channel = PAYMENT_CHANNELS.find((c) => c.code === body.channelCode)!;
  return NextResponse.json({
    ok: true,
    channel: { code: channel.code, label: channel.label, kind: channel.kind },
    trxId: r.trxId, virtualAccount: r.virtualAccount, qr: r.qr, paymentCode: r.paymentCode, url: r.url,
    amount: r.amount, admin: r.admin, total: r.total,
  }, { headers: CORS });
}
