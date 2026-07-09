import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { kaShippingPrice, kaInstantPricing, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { resolveArea } from "@/lib/data/areas";
import { rateLimited } from "@/lib/public-guard";

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

export async function POST(req: Request) {
  const limited = rateLimited(req, "ongkir", 60, 60_000, CORS);
  if (limited) return limited;
  if (!kiriminajaConfigured()) {
    return NextResponse.json({ ok: false, error: "Shipping belum dikonfigurasi." }, { status: 200, headers: CORS });
  }
  let body: { op?: string; q?: string; originCity?: string; destinationId?: number; weight?: number; itemValue?: number; storeSlug?: string; destLat?: number; destLng?: number };
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

  // instant (same-day) pricing — needs shopper coordinates; origin = store sender lat/lng (or default)
  if (body.op === "instant") {
    if (!body.destLat || !body.destLng) return NextResponse.json({ ok: false, error: "Lokasi tujuan belum ada." }, { headers: CORS });
    let originLat = -7.8014, originLng = 110.3644; // default: Yogyakarta (Batik Nusantara)
    const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, body.storeSlug || "batik-nusantara")).limit(1);
    if (store) {
      const [ss] = await db.select({ lat: schema.storeSettings.senderLat, lng: schema.storeSettings.senderLng }).from(schema.storeSettings).where(eq(schema.storeSettings.storeId, store.id)).limit(1);
      if (ss?.lat && ss?.lng) { originLat = Number(ss.lat); originLng = Number(ss.lng); }
    }
    const r = await kaInstantPricing({ originLat, originLng, destLat: body.destLat, destLng: body.destLng, weight: Math.max(1000, body.weight || 1000), itemPrice: body.itemValue || 0 });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Gagal ambil tarif instan." }, { headers: CORS });
    return NextResponse.json({ ok: true, instant: r.results, distanceKm: r.distanceKm }, { headers: CORS });
  }

  // rates
  if (body.op === "rates") {
    if (!body.destinationId) return NextResponse.json({ ok: false, error: "Tujuan belum dipilih." }, { headers: CORS });
    const originOpts = await resolveArea(body.originCity || "Yogyakarta", 1);
    const origin = originOpts[0]?.id;
    if (!origin) return NextResponse.json({ ok: false, error: "Area asal tidak ditemukan." }, { headers: CORS });
    const r = await kaShippingPrice({
      origin,
      destination: body.destinationId,
      weight: Math.max(1000, body.weight || 1000),
      itemValue: body.itemValue || 0,
      insurance: 0,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Gagal mengambil tarif." }, { headers: CORS });
    return NextResponse.json({
      ok: true,
      rates: r.results.map((x) => ({ name: x.service_name, code: x.service, type: x.service_type, cost: Number(x.cost), etd: x.etd, cod: x.cod })),
    }, { headers: CORS });
  }

  return NextResponse.json({ ok: false, error: "op tidak dikenal." }, { status: 400, headers: CORS });
}
