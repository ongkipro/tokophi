import "server-only";
import { cacheGet, cacheSet } from "./cache";
import { isConfigured } from "./integration-status";
import { isInstantService } from "./couriers";

// KiriminAja Mitra API client (platform-managed courier aggregator). Endpoints + version
// prefixes verified against the sandbox Postman collection — versions vary PER endpoint.
const PRICE_TTL = 10 * 60 * 1000; // 10 min — cuts repeated ongkir calls under ad-driven traffic
const ENV = process.env.KIRIMINAJA_ENV ?? "sandbox";
const BASE = ENV === "production" ? "https://client.kiriminaja.com" : "https://tdev.kiriminaja.com";
const KEY = process.env.KIRIMINAJA_API_KEY ?? "";
// order_id prefix must be REGISTERED in the KiriminAja dashboard, else request_pickup 400s.
export const KA_ORDER_PREFIX = process.env.KIRIMINAJA_ORDER_PREFIX ?? "TOKOPHI";

export const kiriminajaConfigured = () => isConfigured(KEY);

async function ka<T = Record<string, unknown>>(path: string, body: unknown = {}, method: "POST" | "GET" = "POST"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json", "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json()) as T;
}

// area search: name → { id (kecamatan/district), text } — used to resolve origin/destination for pricing
export type KaAddress = { id: number; text: string };
export async function kaAddressByName(search: string): Promise<KaAddress[]> {
  const r = await ka<{ status: boolean; data?: KaAddress[] }>("/api/mitra/v2/get_address_by_name", { search });
  return r.status && Array.isArray(r.data) ? r.data : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Kelurahan (village) of a kecamatan — VERIFIED live: POST /api/mitra/kelurahan {kecamatan_id}
//   → { status: true, method: "get_kelurahan_from_kecamatan_id",
//       results: [{ id: 17617, kelurahan_name: "Cikini", kecamatan_id: 2099, postal_code: "10330" }] }
// (unversioned path — KiriminAja's versions vary per endpoint; do not add /v2/ or /v6.1/ here.)
//
// This `id` is KiriminAja's OWN kelurahan id and it is the ONLY thing `request_pickup` accepts for
// `kelurahan_id` / `destination_kelurahan_id`. The local `kelurahan` reference table (migration 0046)
// is keyed by the Kemendagri code ("11.01.01.2001") — a different namespace. It is the right source
// for a postcode and a name; it can never supply a booking id. That is why this call exists.
//
// The village list of a district changes about as often as Indonesia redraws its subdistricts, so it
// is cached for a day — the picker is used on every visit to Pengaturan → Pengiriman.
// ─────────────────────────────────────────────────────────────────────────────
const KELURAHAN_TTL = 24 * 60 * 60 * 1000;
export type KaKelurahan = { id: number; name: string; postalCode: string };

export async function kaKelurahan(kecamatanId: number): Promise<KaKelurahan[]> {
  if (!Number.isFinite(kecamatanId) || kecamatanId <= 0) return [];
  const key = `ka:kelurahan:${kecamatanId}`;
  const hit = cacheGet<KaKelurahan[]>(key);
  if (hit) return hit;
  const r = await ka<{
    status: boolean;
    results?: { id: number; kelurahan_name: string; postal_code: string }[];
  }>("/api/mitra/kelurahan", { kecamatan_id: kecamatanId });
  if (!r.status || !Array.isArray(r.results)) return [];
  const out = r.results.map((x) => ({
    id: x.id,
    name: x.kelurahan_name,
    postalCode: String(x.postal_code ?? ""),
  }));
  cacheSet(key, out, KELURAHAN_TTL);
  return out;
}

// pricing (express) — origin/destination are kecamatan (district) IDs.
//
// ⚠️ There is NO village-level pricing. `shipping_price` accepts `origin_village`/
// `destination_village` in the body and IGNORES them: sent with a nonsense destination village id
// (9999999) the sandbox still answered `status: true` with the same 20 services at the same costs
// (verified 2026-07-14). So do not add village params here — they would imply a precision the
// tariff does not have, and a parameter the API silently discards is worse than no parameter: the
// next reader will believe the quote was village-accurate. Kelurahan is a BOOKING and ADDRESS
// concern (request_pickup + the printed label), not a price one.
export type KaRate = { service: string; service_name: string; service_type: string; cost: string; etd: string; cod: boolean; group: string };
export async function kaShippingPrice(p: {
  origin: number;
  destination: number;
  weight: number; // grams
  itemValue?: number;
  insurance?: 0 | 1;
  couriers?: string[];
}): Promise<{ ok: boolean; results: KaRate[]; error?: string }> {
  // cache successful rates per route (origin+dest+weight+value+insurance+couriers) — 10 min
  const key = `ka:price:${p.origin}:${p.destination}:${p.weight}:${p.itemValue ?? 0}:${p.insurance ?? 0}:${(p.couriers ?? []).join(",")}`;
  const hit = cacheGet<{ ok: boolean; results: KaRate[] }>(key);
  if (hit) return hit;
  const r = await ka<{ status: boolean; text?: string; results?: KaRate[] }>("/api/mitra/v6.1/shipping_price", {
    origin: p.origin,
    destination: p.destination,
    weight: p.weight,
    item_value: String(p.itemValue ?? 0),
    insurance: p.insurance ?? 0,
    ...(p.couriers?.length ? { courier: p.couriers } : {}),
  });
  if (!r.status) return { ok: false, results: [], error: r.text };
  const out = { ok: true, results: Array.isArray(r.results) ? r.results : [] };
  cacheSet(key, out, PRICE_TTL);
  return out;
}

// create an express shipment (pickup request) → returns AWB / KiriminAja order id
// No lat/lng: the pickup point is identified by kecamatan/kelurahan + the written address. The
// coordinate pair only ever existed for the (removed) instant couriers.
export type KaSender = {
  name: string; phone: string; address: string;
  kecamatanId: number; kelurahanId?: number | null;
  zipcode?: string | null; // pickup postal code (store_settings.sender_zip)
};
export type KaPackage = {
  orderRef: string; // becomes `${KA_ORDER_PREFIX}-${orderRef}`
  destName: string; destPhone: string; destAddress: string;
  destKecamatanId: number; destKelurahanId?: number | null; destZipcode?: string;
  weight: number; itemValue: number; itemName: string;
  service: string; serviceType: string; shippingCost: number;
  cod?: number; // COD amount to collect (0 = non-COD)
  insuranceAmount?: number; // 0/undefined = no insurance
  qty?: number; width?: number; length?: number; height?: number; packageTypeId?: number;
};
export async function kaCreateOrder(sender: KaSender, pkg: KaPackage, schedule: string): Promise<{
  ok: boolean; awb?: string; kaOrderId?: string; pickupNumber?: string; error?: string;
}> {
  const r = await ka<{
    status: boolean; text?: string; pickup_number?: string;
    details?: { order_id: string; kj_order_id: string; awb: string | null; service: string; service_type: string }[];
  }>("/api/mitra/v6.1/request_pickup", {
    name: sender.name, phone: sender.phone, address: sender.address,
    kecamatan_id: sender.kecamatanId,
    ...(sender.kelurahanId ? { kelurahan_id: sender.kelurahanId } : {}),
    ...(sender.zipcode ? { zipcode: sender.zipcode } : {}),
    platform_name: "mitra",
    schedule,
    packages: [{
      order_id: `${KA_ORDER_PREFIX}-${pkg.orderRef}`,
      destination_name: pkg.destName, destination_phone: pkg.destPhone, destination_address: pkg.destAddress,
      destination_kecamatan_id: pkg.destKecamatanId,
      ...(pkg.destKelurahanId ? { destination_kelurahan_id: pkg.destKelurahanId } : {}),
      weight: pkg.weight, width: pkg.width ?? 10, length: pkg.length ?? 10, height: pkg.height ?? 10,
      qty: pkg.qty ?? 1, item_value: pkg.itemValue, item_name: pkg.itemName,
      service: pkg.service, service_type: pkg.serviceType, shipping_cost: pkg.shippingCost,
      cod: pkg.cod ?? 0, package_type_id: pkg.packageTypeId ?? 7,
      ...(pkg.insuranceAmount ? { insurance_amount: pkg.insuranceAmount } : {}),
      ...(pkg.destZipcode ? { destination_zipcode: pkg.destZipcode } : {}),
    }],
  });
  const d = r.details?.[0];
  return {
    ok: !!r.status,
    awb: d?.awb ?? undefined,
    kaOrderId: d?.kj_order_id,
    pickupNumber: r.pickup_number,
    error: r.status ? undefined : r.text,
  };
}

// NOTE: the instant / same-day courier client (GoSend, Grab, Borzo — `kaInstantPricing` +
// `kaCreateInstantOrder`, /api/mitra/v4/instant/*) was REMOVED. TokoΦ ships via regular expedition
// couriers only (SPX, JNE, SiCepat, AnterAja, …). Do not reintroduce it without a product decision:
// it is the only feature that ever needed lat/lng coordinates.

// cancel/void an express shipment by AWB (= kj_order_id / resi we stored)
export async function kaCancelShipment(awb: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const r = await ka<{ status: boolean; text?: string }>("/api/mitra/v3/cancel_shipment", { awb, reason });
  return { ok: !!r.status, error: r.status ? undefined : r.text };
}

// express tracking by order id / AWB
export async function kaTrack(orderId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const r = await ka<{ status: boolean; text?: string; data?: unknown }>("/api/mitra/tracking", { order_id: orderId });
  return { ok: !!r.status, data: r.data, error: r.status ? undefined : r.text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live service roster — the UNION of several reference routes, never a single one.
//
// KiriminAja has no "list couriers" endpoint: the roster is whatever `shipping_price` returns for a
// route. It used to be harvested from ONE route (Menteng → Coblong) and that was silently wrong,
// because **coverage is route- AND origin-dependent**. TIKI quotes on Menteng → Pleret and on
// Danurejan → Jakarta but does NOT serve Menteng → Coblong — so it never entered the roster, never
// entered `platform_couriers`, and no merchant could ever have enabled it. A courier absent from one
// route is not a courier that does not exist.
//
// So we price a SPREAD of routes and merge the results by `courier:service_type`:
//   2099 → 356   Menteng (Jakarta Pusat)  → Coblong (Bandung)      — the classic Jawa corridor
//   2099 → 548   Menteng (Jakarta Pusat)  → Pleret (Bantul, DIY)   — same origin, RURAL destination
//   6138 → 2099  Gubeng (Surabaya)        → Menteng                — a DIFFERENT origin (East Java)
//   6981 → 2099  Danurejan (Yogyakarta)   → Menteng                — a third origin (DIY)
// Two origins would have missed the origin effect; two destinations would have missed the rural
// effect. Verified live 2026-07-14 (sandbox, 1 kg): the union is **11 couriers / 23 services** —
// the single route gave 10/20 and lost `tiki` entirely. J&T (`jnt`) does not quote from Gubeng at
// all, on any destination: proof that "in the roster" ≠ "available to this seller" (see kaCoverage).
//
// COD MERGE RULE: a service is `cod: true` if **ANY** route reports it COD-capable. `cod` here is a
// CEILING ("KiriminAja can collect cash on this service somewhere"), not a promise for a given
// parcel — the platform still has to tick `codAllowed` per service (super-admin), the store still has
// to opt in, and the province allow-list + KiriminAja itself still decide the actual order. Taking
// the intersection instead would permanently hide a real capability (TIKI Reguler reports cod=true on
// 3 of 4 routes and false on the 4th) and make it un-tickable forever, which is a silent, invisible
// loss; over-reporting here costs nothing because the ceiling is never the last gate.
//
// The routes are priced in PARALLEL and the whole roster is cached for a day: it changes when
// KiriminAja onboards a courier, not per request.
// ─────────────────────────────────────────────────────────────────────────────
const ROSTER_TTL = 24 * 60 * 60 * 1000;
const ROSTER_ROUTES: { origin: number; destination: number }[] = [
  { origin: 2099, destination: 356 }, // Menteng → Coblong (Bandung)
  { origin: 2099, destination: 548 }, // Menteng → Pleret (Bantul) — rural destination
  { origin: 6138, destination: 2099 }, // Gubeng (Surabaya) → Menteng — second origin
  { origin: 6981, destination: 2099 }, // Danurejan (Yogyakarta) → Menteng — third origin
];

export type KaService = {
  courier: string; // KiriminAja `service` — the courier code (spx, jne, sicepat…)
  serviceType: string; // `service_type` — the code to send back when booking (REG23, "1", FLREG…)
  name: string; // `service_name` — human label ("SPX Standard", "JNE Express Reguler")
  group: string; // speed class: cargo | regular | next_day | economy | one_day
  cod: boolean; // KiriminAja will collect cash for this service on AT LEAST ONE route (a ceiling)
};

export async function kaServices(): Promise<{ ok: boolean; services: KaService[]; error?: string }> {
  const key = "ka:roster";
  const hit = cacheGet<{ ok: boolean; services: KaService[] }>(key);
  if (hit) return hit;

  const routes = await Promise.all(
    ROSTER_ROUTES.map((r) =>
      kaShippingPrice({ origin: r.origin, destination: r.destination, weight: 1000, itemValue: 100_000 }),
    ),
  );
  const ok = routes.filter((r) => r.ok);
  // Every route failed → the API is down or the key is bad. Do NOT cache an empty roster: a cached
  // "0 couriers" would survive the outage for a day and the next Sync would disable every courier.
  if (!ok.length) {
    return { ok: false, services: [], error: routes[0]?.error ?? "Gagal mengambil daftar layanan." };
  }

  // merge by courier:service_type — first sighting wins for the labels, cod is OR-ed (see above)
  const merged = new Map<string, KaService>();
  for (const r of ok) {
    for (const x of r.results) {
      const k = `${x.service}:${x.service_type}`;
      const prev = merged.get(k);
      merged.set(k, {
        courier: x.service,
        serviceType: x.service_type,
        name: prev?.name ?? x.service_name,
        group: prev?.group ?? x.group,
        cod: (prev?.cod ?? false) || !!x.cod,
      });
    }
  }
  const out = { ok: true, services: [...merged.values()] };
  cacheSet(key, out, ROSTER_TTL);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-ORIGIN COVERAGE — "enabled" is not "the shopper will see it".
//
// A courier that does not COLLECT from the seller's pickup district simply never appears in the
// quote. Measured 2026-07-14: J&T quotes from Jakarta and Yogyakarta origins but not from Gubeng
// (Surabaya) — to any destination. So a Surabaya merchant can have J&T enabled by the platform,
// ticked on their own Jasa Kirim screen, and still never sell a single J&T parcel, with nothing
// anywhere saying why. Both admin surfaces must be able to SAY it.
//
// The probe is deliberately CHEAP: ONE priced route per origin (not one per courier — that would be
// eleven calls to answer one question). The destination is a district every courier serves, so an
// absence is attributable to the ORIGIN. Cached for a day: coverage changes when a courier changes
// its pickup footprint, not per request.
//
// It answers "who collects from here", NOT "who delivers to the shopper". A courier can collect from
// the origin and still not reach a remote destination — that is the checkout's quote to answer, and
// it does, per order. This is the seller-side question, and it is the one nobody was asking.
// ─────────────────────────────────────────────────────────────────────────────
const COVERAGE_TTL = 24 * 60 * 60 * 1000;
const COVERAGE_DEST = 2099; // Menteng (Jakarta Pusat) — the best-served destination in the country
const COVERAGE_DEST_ALT = 356; // Coblong (Bandung) — used when the origin IS Menteng

export type KaCoverage = {
  ok: boolean;
  origin: number; // the pickup district we probed (a KiriminAja kecamatan id)
  destination: number; // the reference destination the probe priced against
  couriers: string[]; // courier codes that quoted FROM this origin (instant couriers excluded)
  services: string[]; // the `courier:service_type` keys that quoted, same filter
  error?: string; // set when the probe could not run (bad origin, API down) — treat as "unknown"
};

/**
 * Which couriers collect from `originId` (a KiriminAja kecamatan/district id — the same currency as
 * `store_settings.sender_kecamatan_id`). One priced reference route, cached for a day.
 *
 * `ok: false` means UNKNOWN, not "nothing covers this origin" — never render an outage as an empty
 * courier list; say the check failed.
 */
export async function kaCoverage(originId: number): Promise<KaCoverage> {
  const destination = originId === COVERAGE_DEST ? COVERAGE_DEST_ALT : COVERAGE_DEST;
  if (!Number.isFinite(originId) || originId <= 0) {
    return { ok: false, origin: originId, destination, couriers: [], services: [], error: "Alamat penjemputan belum diatur." };
  }
  const key = `ka:coverage:${originId}`;
  const hit = cacheGet<KaCoverage>(key);
  if (hit) return hit;

  const r = await kaShippingPrice({ origin: originId, destination, weight: 1000, itemValue: 100_000 });
  if (!r.ok) {
    // not cached — an outage must not be remembered as a coverage fact for a day
    return { ok: false, origin: originId, destination, couriers: [], services: [], error: r.error ?? "Gagal memeriksa jangkauan kurir." };
  }
  const quoted = r.results.filter((x) => !isInstantService({ courier: x.service, group: x.group }));
  const out: KaCoverage = {
    ok: true,
    origin: originId,
    destination,
    couriers: [...new Set(quoted.map((x) => x.service))],
    services: [...new Set(quoted.map((x) => `${x.service}:${x.service_type}`))],
  };
  cacheSet(key, out, COVERAGE_TTL);
  return out;
}

// connection check (used by super-admin) — hits the province endpoint
export async function kaTestConnection(): Promise<{ ok: boolean; env: string; provinces?: number; message: string }> {
  if (!KEY) return { ok: false, env: ENV, message: "API key belum diisi (KIRIMINAJA_API_KEY)." };
  try {
    const r = await ka<{ status: boolean; datas?: unknown[] }>("/api/mitra/province", {});
    const n = (r.datas ?? []).length;
    return r.status
      ? { ok: true, env: ENV, provinces: n, message: `Terhubung ke KiriminAja (${ENV}) — ${n} provinsi.` }
      : { ok: false, env: ENV, message: "Auth ditolak / respons tidak valid." };
  } catch (e) {
    return { ok: false, env: ENV, message: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}
