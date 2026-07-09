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
export type KaSender = {
  name: string; phone: string; address: string;
  kecamatanId: number; kelurahanId?: number | null; lat?: string | null; lng?: string | null;
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
    ...(sender.lat ? { latitude: Number(sender.lat) } : {}),
    ...(sender.lng ? { longitude: Number(sender.lng) } : {}),
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

// create an instant (same-day) pickup order — verified: shipping_price MUST be `shipping_costs`
// (not total_price, which adds admin_fee), plus a top-level `order_prefix` + `service_type`.
export async function kaCreateInstantOrder(p: {
  orderRef: string; service: string; serviceType: string; shippingCosts: number;
  origin: { name: string; phone: string; lat: number; long: number; address: string; note?: string };
  dest: { name: string; phone: string; lat: number; long: number; address: string; note?: string };
  item: { name: string; description: string; price: number; weight: number };
}): Promise<{ ok: boolean; orderId?: string; paymentId?: string; error?: string }> {
  const r = await ka<{
    status: boolean; text?: string;
    result?: { payment?: { payment_id?: string }; packages?: { order_id?: string; awb?: string }[] };
  }>("/api/mitra/v4/instant/pickup/request", {
    service: p.service, service_type: p.serviceType, order_prefix: KA_ORDER_PREFIX,
    packages: [{
      order_id: `${KA_ORDER_PREFIX}-${p.orderRef}`,
      origin_name: p.origin.name, origin_phone: p.origin.phone, origin_lat: p.origin.lat, origin_long: p.origin.long,
      origin_address: p.origin.address, origin_address_note: p.origin.note || "Toko",
      destination_name: p.dest.name, destination_phone: p.dest.phone, destination_lat: p.dest.lat, destination_long: p.dest.long,
      destination_address: p.dest.address, destination_address_note: p.dest.note || "Rumah",
      shipping_price: p.shippingCosts, item: p.item,
    }],
  });
  return { ok: !!r.status, orderId: r.result?.packages?.[0]?.order_id, paymentId: r.result?.payment?.payment_id, error: r.status ? undefined : r.text };
}

// cancel/void an express shipment by AWB (= kj_order_id / resi we stored)
export async function kaCancelShipment(awb: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const r = await ka<{ status: boolean; text?: string }>("/api/mitra/v3/cancel_shipment", { awb, reason });
  return { ok: !!r.status, error: r.status ? undefined : r.text };
}

// instant (same-day / on-demand) pricing — uses lat/long, not district ids. gosend/grab/borzo.
export type KaInstantRate = { name: string; code: string; serviceType: string; cost: number; shippingCosts: number; etd: string };
export async function kaInstantPricing(p: {
  originLat: number; originLng: number; destLat: number; destLng: number;
  weight: number; itemPrice: number; originAddress?: string; destAddress?: string; services?: string[];
}): Promise<{ ok: boolean; results: KaInstantRate[]; distanceKm?: number; error?: string }> {
  const r = await ka<{
    status: boolean; text?: string; meta?: { distance?: number };
    result?: { name: string; costs?: { service_type: string; estimation: string; price?: { total_price?: number; shipping_costs?: number } }[] }[];
  }>("/api/mitra/v4/instant/pricing", {
    service: p.services ?? ["gosend", "grab_express", "borzo"],
    item_price: p.itemPrice,
    origin: { lat: p.originLat, long: p.originLng, address: p.originAddress || "Lokasi toko" },
    destination: { lat: p.destLat, long: p.destLng, address: p.destAddress || "Lokasi pelanggan" },
    weight: Math.max(1, p.weight), vehicle: "motor", timezone: "WIB",
  });
  if (!r.status) return { ok: false, results: [], error: r.text };
  const results: KaInstantRate[] = [];
  for (const courier of r.result ?? []) {
    for (const c of courier.costs ?? []) {
      results.push({
        name: `${courier.name.toUpperCase()} ${c.service_type}`,
        code: courier.name, serviceType: c.service_type,
        cost: c.price?.total_price ?? 0, shippingCosts: c.price?.shipping_costs ?? c.price?.total_price ?? 0, etd: c.estimation,
      });
    }
  }
  return { ok: true, results, distanceKm: r.meta?.distance };
}

// express tracking by order id / AWB
export async function kaTrack(orderId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const r = await ka<{ status: boolean; text?: string; data?: unknown }>("/api/mitra/tracking", { order_id: orderId });
  return { ok: !!r.status, data: r.data, error: r.status ? undefined : r.text };
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
