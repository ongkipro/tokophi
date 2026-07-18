import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { resolveArea, kelurahanForDistrict } from "@/lib/data/areas";
import { rateLimited } from "@/lib/public-guard";
import { quoteShipping, FAST_COURIERS } from "@/lib/shipping-quote";

// Public (no-auth) storefront-facing shipping endpoint. The storefront checkout calls this to
// (a) search a destination area and (b) get live KiriminAja rates. Shipping is platform-managed
// (ADR 0004) so the platform key stays here, never in the storefront bundle.
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

// The storefront lives on a DIFFERENT origin (<slug>.tokophi.com → app.tokophi.com), so a response
// without CORS headers is unreadable to it. Every explicit return below carries them — but an
// UNCAUGHT throw does not: Next renders its own 500, the browser sees a missing
// Access-Control-Allow-Origin, and the console reports a CORS problem. That is how a missing
// `kelurahan` table showed up as a CORS error for hours: the message pointed at the wrong layer.
// Wrap the handler so a failure looks like a failure.
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[ongkir] unhandled:", err);
    return NextResponse.json({ ok: false, error: "Gagal menghitung ongkir." }, { status: 500, headers: CORS });
  }
}

async function handle(req: Request) {
  const limited = rateLimited(req, "ongkir", 60, 60_000, CORS);
  if (limited) return limited;
  if (!kiriminajaConfigured()) {
    return NextResponse.json({ ok: false, error: "Shipping belum dikonfigurasi." }, { status: 200, headers: CORS });
  }
  let body: { op?: string; q?: string; destinationId?: number; items?: { handle?: string; variant?: string; variantId?: string; qty?: number }[]; itemValue?: number; storeSlug?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body tidak valid." }, { status: 400, headers: CORS });
  }

  // area autocomplete
  if (body.op === "search") {
    const results = body.q ? await resolveArea(body.q) : [];
    return NextResponse.json({ ok: true, results }, { headers: CORS });
  }

  // kelurahan of a district → the checkout fills the kodepos from the one the shopper picks.
  // A kodepos is assigned per kelurahan, not per kecamatan (17% of kecamatan span several — the
  // urban ones), so it cannot be derived from the district alone. Districts we could not match to
  // the Kemendagri dataset (~4%) return an empty list, and the checkout keeps kodepos manual for
  // them — an unmatched district must degrade to "the shopper types it", never to a guess.
  if (body.op === "kelurahan") {
    const id = Number(body.destinationId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: true, kelurahan: [] }, { headers: CORS });
    }
    return NextResponse.json({ ok: true, kelurahan: await kelurahanForDistrict(id) }, { headers: CORS });
  }

  // NOTE: `op === "instant"` (GoSend/Grab same-day pricing) was REMOVED — the product ships via
  // regular expedition couriers only. It was the only consumer of shopper/store coordinates.

  // rates — the price itself is produced by lib/shipping-quote.ts, the SAME function
  // /api/public/order re-quotes with before it writes `orders.shipping_idr`. Two copies of this
  // logic would be two prices, and the one the order keeps is the one that decides what the merchant
  // gets paid.
  if (body.op === "rates") {
    // Fail closed on a missing slug rather than defaulting to a hardcoded demo store (see order route).
    const slug = (body.storeSlug ?? "").trim();
    if (!slug) return NextResponse.json({ ok: false, error: "Toko tidak dikenali." }, { headers: CORS });
    const [store] = await db
      .select({ id: schema.stores.id, city: schema.stores.city })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (!store) return NextResponse.json({ ok: false, error: "Toko tidak ditemukan." }, { headers: CORS });

    // TWO-STAGE QUOTE. `all: true` = the shopper opened "Pilih ekspedisi lain"; otherwise quote only
    // the fast couriers.
    //
    // Measured against the live API (same route, 2026-07-17): every courier **5.50s / 5.45s**, vs
    // `["spx","jne"]` **0.65s / 0.54s** — ~10x. KiriminAja aggregates per courier and the slowest
    // carrier sets the pace, so the shopper was waiting ~5.5s for carriers they never asked about.
    // And they pay it EVERY time: each shopper has a unique destination, so the 10-min rate cache is
    // always cold for them — the sub-second numbers seen while testing one address are a mirage.
    //
    // Nothing is hidden by policy: the full list is one click away and quoted on demand. The client
    // chooses the SCOPE, never the price, the origin, or which couriers are allowed — platform ∩
    // store filtering happens inside quoteShipping either way, so `all: true` from a hostile caller
    // buys them a slower query and nothing else.
    const q = await quoteShipping({
      storeId: store.id,
      storeCity: store.city,
      destinationId: Number(body.destinationId),
      items: body.items ?? [],
      itemValue: body.itemValue || 0,
      couriers: body.all === true ? undefined : [...FAST_COURIERS],
    });
    if (!q.ok) return NextResponse.json({ ok: false, error: q.error }, { headers: CORS });

    // `origin`/`originFrom` are returned so the caller can never be confused about which address the
    // price was built from — a missing pickup address is visible instead of silently priced from a
    // fuzzy city guess.
    return NextResponse.json(
      {
        ok: true,
        rates: q.rates,
        weight: q.grams,
        billableWeight: q.billableGrams,
        weightFallback: q.weightFallback,
        codEnabled: q.codEnabled,
        origin: q.origin,
        originFrom: q.originFrom,
        originName: q.originName,
      },
      { headers: CORS },
    );
  }

  return NextResponse.json({ ok: false, error: "op tidak dikenal." }, { status: 400, headers: CORS });
}
