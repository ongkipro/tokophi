import "server-only";

// KiriminAja Mitra API client (platform-managed courier aggregator). Endpoints + version
// prefixes verified against the sandbox Postman collection — versions vary PER endpoint.
const ENV = process.env.KIRIMINAJA_ENV ?? "sandbox";
const BASE = ENV === "production" ? "https://client.kiriminaja.com" : "https://tdev.kiriminaja.com";
const KEY = process.env.KIRIMINAJA_API_KEY ?? "";

export const kiriminajaConfigured = () => !!KEY;

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
  const r = await ka<{ status: boolean; text?: string; results?: KaRate[] }>("/api/mitra/v6.1/shipping_price", {
    origin: p.origin,
    destination: p.destination,
    weight: p.weight,
    item_value: String(p.itemValue ?? 0),
    insurance: p.insurance ?? 0,
    ...(p.couriers?.length ? { courier: p.couriers } : {}),
  });
  return { ok: !!r.status, results: Array.isArray(r.results) ? r.results : [], error: r.status ? undefined : r.text };
}

// express tracking by order id / AWB
export async function kaTrack(orderId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const r = await ka<{ status: boolean; text?: string; data?: unknown }>("/api/mitra/tracking", { order_id: orderId });
  return { ok: !!r.status, data: r.data, error: r.status ? undefined : r.text };
}

// connection check (used by super-admin) — hits the province endpoint
export async function kaTestConnection(): Promise<{ ok: boolean; message: string }> {
  if (!KEY) return { ok: false, message: "API key belum diisi (KIRIMINAJA_API_KEY)." };
  try {
    const r = await ka<{ status: boolean; datas?: unknown[] }>("/api/mitra/province", {});
    return r.status
      ? { ok: true, message: `Terhubung ke KiriminAja (${ENV}) — ${(r.datas ?? []).length} provinsi.` }
      : { ok: false, message: "Auth ditolak / respons tidak valid." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal terhubung." };
  }
}
