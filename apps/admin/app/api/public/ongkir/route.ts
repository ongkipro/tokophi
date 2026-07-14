import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { kaShippingPrice, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { isInstantCourier, isInstantService } from "@tokophi/lib/couriers";
import { resolveArea, kelurahanForDistrict } from "@/lib/data/areas";
import { rateLimited } from "@/lib/public-guard";
import { getCodPolicy } from "@/lib/cod";
import { weightForCart } from "@/lib/shipping-weight";

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
  let body: { op?: string; q?: string; destinationId?: number; items?: { handle?: string; variant?: string; variantId?: string; qty?: number }[]; itemValue?: number; storeSlug?: string };
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

  // rates
  if (body.op === "rates") {
    if (!body.destinationId) return NextResponse.json({ ok: false, error: "Tujuan belum dipilih." }, { headers: CORS });
    // Two-level courier control: platform (super-admin) sets the hard-enabled pool; the merchant
    // picks a subset. Effective = (merchant selection ?? all) ∩ platform-enabled.
    const platformRows = await db
      .select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled })
      .from(schema.platformCouriers);
    // Instant / on-demand couriers are out of scope (@tokophi/lib/couriers): a stale `gosend` row in
    // platform_couriers must not become a checkout option, so it is dropped from the enabled pool.
    const platformOn = platformRows.filter((p) => p.enabled && !isInstantCourier(p.courier)).map((p) => p.courier);
    const [store] = await db
      .select({ id: schema.stores.id, city: schema.stores.city })
      .from(schema.stores)
      .where(eq(schema.stores.slug, body.storeSlug || "batik-nusantara"))
      .limit(1);

    // ── ORIGIN = the seller's SAVED PICKUP ADDRESS (Pengaturan → Alamat) ──────────────────────────
    // It used to be `resolveArea(body.originCity || "Yogyakarta")`: a CITY NAME posted by the
    // shopper's browser, fuzzy-matched to whatever district happened to come back first, with a
    // hard-coded Yogyakarta behind it. Two things were wrong with that, and both cost money:
    //   1. The pickup address the seller actually configures was never read. A merchant shipping out
    //      of Surabaya quoted Yogyakarta rates on every order — wrong in both directions, and the
    //      parcel is collected from an address that had nothing to do with the price.
    //   2. The origin was CLIENT-SUPPLIED. `originCity` is an untrusted string that decided a price;
    //      a script could post any city and pick the ongkir it liked.
    // `sender_kecamatan_id` IS a KiriminAja district id — the same currency as `destinationId` — so
    // there is nothing to resolve and nothing to guess. `body.originCity` is now ignored entirely.
    const [settings] = store
      ? await db
          .select({
            kecamatanId: schema.storeSettings.senderKecamatanId,
            kecamatanName: schema.storeSettings.senderKecamatanName,
            couriers: schema.storeSettings.couriers,
          })
          .from(schema.storeSettings)
          .where(eq(schema.storeSettings.storeId, store.id))
          .limit(1)
      : [];

    let origin: number | undefined = settings?.kecamatanId ?? undefined;
    let originFrom = "pickup";
    if (!origin) {
      // The seller has not set a pickup address yet. Fall back to the store's REGISTERED city (still
      // the shop's own data, never the shopper's) so checkout keeps working — but say so, because a
      // fuzzy city match is a guess and a quote built on a guess should be visible as one.
      originFrom = "store-city";
      const opts = await resolveArea(store?.city || "Yogyakarta", 1);
      origin = opts[0]?.id;
    }
    if (!origin) return NextResponse.json({ ok: false, error: "Alamat pengambilan toko belum diatur." }, { headers: CORS });

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
      merchant = settings?.couriers ?? null;

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

    // ── WEIGHT = summed from the CART, in the database, never from the browser ────────────────────
    // It used to be `Math.max(1000, body.weight)`, and the storefront posted `totalQty * 500` — a
    // fabricated 500 g per item. A 3-piece apparel cart that really weighs 670 g was billed as
    // 1.500 g: Rp27.400 instead of Rp13.700, i.e. the shopper was quoted 3x the true postage on
    // every order, and nobody could see why the carts were abandoned.
    // Weight is a PRICE INPUT. If the client states it, the client sets the price and the merchant
    // eats the difference with the courier. Same lesson as the ongkir origin (now the seller's
    // pickup district) and the COD province (now the KiriminAja district id): a claim from the
    // client is not a fact. There is no `body.weight` to fall back to — that is deliberate.
    if (!store) return NextResponse.json({ ok: false, error: "Toko tidak ditemukan." }, { headers: CORS });
    const cart = (body.items ?? []).filter((i) => (i.qty ?? 0) > 0);
    if (!cart.length) {
      return NextResponse.json(
        { ok: false, error: "Keranjang kosong — ongkir tidak bisa dihitung." },
        { headers: CORS },
      );
    }
    const pkg = await weightForCart(db, store.id, cart);

    const r = await kaShippingPrice({
      origin,
      destination: body.destinationId,
      weight: pkg.billableGrams,
      itemValue: body.itemValue || 0,
      insurance: 0,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error ?? "Gagal mengambil tarif." }, { headers: CORS });
    // `cod` on a rate is the EFFECTIVE flag, not KiriminAja's raw capability: the merchant's switch
    // (store_settings.cod_enabled) AND the platform's per-service allowance must both agree, or the
    // storefront would keep advertising COD on a store that turned it off (lib/cod.ts).
    const cod = store ? await getCodPolicy(store.id) : null;
    let rates = r.results
      // Never quote an instant courier, whatever KiriminAja returns — the checkout cannot book one.
      .filter((x) => !isInstantService({ courier: x.service, group: x.group }))
      .map((x) => ({
        name: x.service_name,
        code: x.service,
        type: x.service_type,
        cost: Number(x.cost),
        etd: x.etd,
        cod: !!x.cod && !!cod?.allows(x.service, x.service_type),
        // KiriminAja's own speed class (cargo | regular | next_day | economy | one_day). The checkout
        // groups the "other couriers" list by THIS — a storefront that guessed the group from the
        // service NAME would be inventing a taxonomy the booking API does not share.
        group: x.group,
      }));
    // filter by effective couriers (platform is the hard cap; empty platform = show all as fallback)
    if (platformOn.length) rates = rates.filter((x) => effective.includes(x.code));
    // …then by the merchant's per-service selection, which is the finer of the two and the one the
    // seller actually sees a switch for.
    if (services) rates = rates.filter((x) => services.has(`${x.code}:${x.type}`));
    // `origin`/`originFrom` are returned so the caller can never be confused about which address the
    // price was built from — and so a missing pickup address is visible instead of silently priced
    // from a fuzzy city guess.
    return NextResponse.json(
      { ok: true, rates, weight: pkg.grams, billableWeight: pkg.billableGrams, weightFallback: pkg.missing, codEnabled: !!cod?.enabled, origin, originFrom, originName: settings?.kecamatanName || store?.city || null },
      { headers: CORS },
    );
  }

  return NextResponse.json({ ok: false, error: "op tidak dikenal." }, { status: 400, headers: CORS });
}
