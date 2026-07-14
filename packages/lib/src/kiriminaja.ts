import "server-only";
import { cacheGet, cacheSet } from "./cache";
import { isConfigured } from "./integration-status";

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

// pricing (express) — origin/destination are kecamatan (district) IDs
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
// Live service roster.
//
// KiriminAja has no "list couriers" endpoint — the roster is whatever `shipping_price`
// returns for a route. So we price ONE reference route and harvest the services from the
// response. That is the only source of truth: it carries the real `service_type` codes,
// the speed `group`, and — crucially — the per-service `cod` flag.
//
// This replaces the hand-written COURIERS list in ./couriers.ts, which had drifted badly:
// it listed TIKI and Pos Indonesia (KiriminAja returns NEITHER) and gave SPX the services
// "Standard"/"Hemat" when the live service_types are "1" and "3". A merchant could enable a
// service that does not exist, and the storefront filter would silently never match it.
//
// Reference route = Menteng (Jakarta Pusat) → Coblong (Bandung), 1 kg. Cross-province and
// well-served, so it exercises every group (cargo / regular / next_day / economy / one_day).
// Cached for a day: the roster changes when KiriminAja onboards a courier, not per request.
// ─────────────────────────────────────────────────────────────────────────────
const ROSTER_TTL = 24 * 60 * 60 * 1000;
const REF_ORIGIN = 2099; // Menteng, Jakarta Pusat
const REF_DEST = 356; // Coblong, Bandung

export type KaService = {
  courier: string; // KiriminAja `service` — the courier code (spx, jne, sicepat…)
  serviceType: string; // `service_type` — the code to send back when booking (REG23, "1", FLREG…)
  name: string; // `service_name` — human label ("SPX Standard", "JNE Express Reguler")
  group: string; // speed class: cargo | regular | next_day | economy | one_day
  cod: boolean; // whether KiriminAja will collect cash for this service
};

export async function kaServices(): Promise<{ ok: boolean; services: KaService[]; error?: string }> {
  const key = "ka:roster";
  const hit = cacheGet<{ ok: boolean; services: KaService[] }>(key);
  if (hit) return hit;

  const r = await kaShippingPrice({ origin: REF_ORIGIN, destination: REF_DEST, weight: 1000, itemValue: 100_000 });
  if (!r.ok) return { ok: false, services: [], error: r.error ?? "Gagal mengambil daftar layanan." };

  const services: KaService[] = r.results.map((x) => ({
    courier: x.service,
    serviceType: x.service_type,
    name: x.service_name,
    group: x.group,
    cod: !!x.cod,
  }));
  const out = { ok: true, services };
  cacheSet(key, out, ROSTER_TTL);
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
