import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { rateLimited } from "@/lib/public-guard";
import { applyDiscount } from "@/lib/promo";

// Voucher PREVIEW (PROMO P0) — the checkout calls this on "Terapkan" to show the discount live before
// submit. It is UX only: `/api/public/order` re-validates + re-prices the same voucher at the boundary
// (both call lib/promo.applyDiscount, so the preview can never disagree with what the order charges).
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const limited = rateLimited(req, "promo", 30, 60_000, CORS);
  if (limited) return limited;

  let body: { storeSlug?: string; code?: string; subtotal?: number; shipping?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Permintaan tidak valid." }, { status: 400, headers: CORS });
  }

  const slug = (body.storeSlug ?? "").trim();
  if (!slug) return NextResponse.json({ ok: false, error: "Toko tidak dikenali." }, { status: 400, headers: CORS });
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: "Toko tidak ditemukan." }, { status: 404, headers: CORS });

  const subtotal = Math.max(0, Math.round(Number(body.subtotal) || 0));
  const shipping = Math.max(0, Math.round(Number(body.shipping) || 0));
  const res = await applyDiscount({ storeId: store.id, code: body.code ?? "", subtotal, shippingCost: shipping });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { headers: CORS });
  return NextResponse.json(
    { ok: true, code: res.discount.code, kind: res.discount.kind, priceOff: res.priceOff, shipOff: res.shipOff },
    { headers: CORS },
  );
}
