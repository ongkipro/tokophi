import { NextResponse } from "next/server";
import { kaAddressByName, kaShippingPrice, kiriminajaConfigured } from "@/lib/kiriminaja";

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
  if (!kiriminajaConfigured()) {
    return NextResponse.json({ ok: false, error: "Shipping belum dikonfigurasi." }, { status: 200, headers: CORS });
  }
  let body: { op?: string; q?: string; originCity?: string; destinationId?: number; weight?: number; itemValue?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body tidak valid." }, { status: 400, headers: CORS });
  }

  // area autocomplete
  if (body.op === "search") {
    const results = body.q ? await kaAddressByName(body.q) : [];
    return NextResponse.json({ ok: true, results }, { headers: CORS });
  }

  // rates
  if (body.op === "rates") {
    if (!body.destinationId) return NextResponse.json({ ok: false, error: "Tujuan belum dipilih." }, { headers: CORS });
    const originOpts = await kaAddressByName(body.originCity || "Yogyakarta");
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
