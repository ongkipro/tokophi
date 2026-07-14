import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { kaShippingPrice, kaInstantPricing, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { resolveArea, kelurahanForDistrict } from "@/lib/data/areas";
import { rateLimited } from "@/lib/public-guard";
import { getCodPolicy } from "@/lib/cod";

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
    // Two-level courier control: platform (super-admin) sets the hard-enabled pool; the merchant
    // picks a subset. Effective = (merchant selection ?? all) ∩ platform-enabled.
    const platformRows = await db
      .select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled })
      .from(schema.platformCouriers);
    const platformOn = platformRows.filter((p) => p.enabled).map((p) => p.courier);
    const [store] = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.slug, body.storeSlug || "batik-nusantara"))
      .limit(1);
    let merchant: string[] | null = null;
    // The merchant's PER-SERVICE selection (store_shipping_methods) — what the Jasa Kirim card in
    // Pengaturan actually writes, and what it promises the seller: "Pilih layanan yang ditawarkan ke
    // pembeli saat checkout." That promise was not kept: this endpoint filtered on the COURIER column
    // only (store_settings.couriers), so a seller who switched OFF, say, JNE YES still had it offered
    // at checkout — and the courier-level model cannot even express that choice, which is precisely
    // why the per-service table exists. Keyed "<courier>:<service_type>" because a service_type is
    // only unique within its courier.
    let services: Set<string> | null = null;
    if (store) {
      const [ss] = await db
        .select({ couriers: schema.storeSettings.couriers })
        .from(schema.storeSettings)
        .where(eq(schema.storeSettings.storeId, store.id))
        .limit(1);
      merchant = ss?.couriers ?? null;

      const picked = await db
        .select({ courier: schema.storeShippingMethods.courier, service: schema.storeShippingMethods.service })
        .from(schema.storeShippingMethods)
        .where(
          and(
            eq(schema.storeShippingMethods.storeId, store.id),
            eq(schema.storeShippingMethods.enabled, true),
          ),
        );
      // No rows = the merchant has never opened the card. Fall back to the courier-level behaviour
      // rather than showing a checkout with zero shipping options.
      if (picked.length) services = new Set(picked.map((s) => `${s.courier}:${s.service}`));
    }
    const effective = (merchant ?? platformOn).filter((c) => platformOn.includes(c));
    const r = await kaShippingPrice({
      origin,
      destination: body.destinationId,
      weight: Math.max(1000, body.weight || 1000),
      itemValue: body.itemValue || 0,
      insurance: 0,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Gagal mengambil tarif." }, { headers: CORS });
    // `cod` on a rate is the EFFECTIVE flag, not KiriminAja's raw capability: the merchant's switch
    // (store_settings.cod_enabled) AND the platform's per-service allowance must both agree, or the
    // storefront would keep advertising COD on a store that turned it off (lib/cod.ts).
    const cod = store ? await getCodPolicy(store.id) : null;
    let rates = r.results.map((x) => ({
      name: x.service_name,
      code: x.service,
      type: x.service_type,
      cost: Number(x.cost),
      etd: x.etd,
      cod: !!x.cod && !!cod?.allows(x.service, x.service_type),
    }));
    // filter by effective couriers (platform is the hard cap; empty platform = show all as fallback)
    if (platformOn.length) rates = rates.filter((x) => effective.includes(x.code));
    // …then by the merchant's per-service selection, which is the finer of the two and the one the
    // seller actually sees a switch for.
    if (services) rates = rates.filter((x) => services.has(`${x.code}:${x.type}`));
    return NextResponse.json({ ok: true, rates, codEnabled: !!cod?.enabled }, { headers: CORS });
  }

  return NextResponse.json({ ok: false, error: "op tidak dikenal." }, { status: 400, headers: CORS });
}
