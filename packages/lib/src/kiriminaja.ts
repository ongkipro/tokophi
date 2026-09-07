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

/** A KiriminAja reply that was not JSON at all — a gateway HTML page, an empty 502, a proxy timeout. */
export class KaTransportError extends Error {
  constructor(readonly path: string, readonly httpStatus: number, readonly snippet: string) {
    super(`KiriminAja ${path} → HTTP ${httpStatus}, non-JSON body: ${snippet}`);
    this.name = "KaTransportError";
  }
}

type KaHttpResponse<T> = { body: T; httpStatus: number };

async function ka<T = Record<string, unknown>>(
  path: string,
  body: unknown = {},
  method: "POST" | "GET" = "POST",
): Promise<KaHttpResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json", "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  // This was a bare `await res.json()`, which never looked at the HTTP status. An HTML 502/504 from
  // KiriminAja's gateway therefore threw a raw JSON parse error ("Unexpected token <") from deep
  // inside the client — unattributable, and in the tracking cron it killed the WHOLE sweep because
  // that call sits outside the per-order try. A transport failure is now its own named error
  // carrying the path, the HTTP status and what actually came back, so a caller can decide whether
  // to skip one order or give up.
  //
  // ⚠️ A JSON body is still RETURNED even on a 4xx/5xx, deliberately: KiriminAja signals business
  // failures as `{status:false, text:"…"}` with assorted HTTP codes, and callers already read that
  // `status`/`text` pair to surface the courier's own message. Throwing on those would turn an
  // actionable rejection ("sudah melewati jam cut-off") into a generic crash.
  const raw = await res.text();
  try {
    return { body: JSON.parse(raw) as T, httpStatus: res.status };
  } catch {
    throw new KaTransportError(path, res.status, raw.slice(0, 200).replace(/\s+/g, " ").trim() || "(empty)");
  }
}

// area search: name → { id (kecamatan/district), text } — used to resolve origin/destination for pricing
export type KaAddress = { id: number; text: string };
export async function kaAddressByName(search: string): Promise<KaAddress[]> {
  const { body: r } = await ka<{ status: boolean; data?: KaAddress[] }>("/api/mitra/v2/get_address_by_name", { search });
  return r.status && Array.isArray(r.data) ? r.data : [];
}

// pricing (express) — origin/destination are kecamatan (district) IDs
export type KaRate = {
  service: string; service_name: string; service_type: string; cost: string; etd: string; cod: boolean; group: string;
  // Per-service fee config. `cod_fee` is a FRACTION already divided by 100 (vendor doc: "0.03" = 3%),
  // `minimum_cod_fee` is an IDR floor, and `cod_fee_amount` is the vendor-computed COD fee in IDR for
  // THIS quote (from item_value + shipping cost + insurance). Numbers arrive as strings sometimes —
  // `cost` above already does — so parse through kaCodFee(), never Number() at a call site.
  setting?: { cod_fee?: string | number; minimum_cod_fee?: string | number; cod_fee_amount?: string | number } | null;
};

/** The COD fee KiriminAja charges on a rate, parsed (N31). All-null when the vendor sent nothing. */
export type KaCodFee = {
  /** vendor-computed COD fee for this quote, IDR */
  amount: number | null;
  /** fee rate in PERCENT (vendor sends the fraction: "0.03" → 3) */
  pct: number | null;
  /** minimum fee, IDR */
  minimum: number | null;
};
export function kaCodFee(rate: Pick<KaRate, "setting">): KaCodFee {
  const num = (v: string | number | undefined | null): number | null => {
    if (v == null || v === "") return null; // Number("") and Number(null) are 0 — a fee of Rp0 would be invented
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const s = rate.setting;
  const frac = num(s?.cod_fee);
  return {
    amount: num(s?.cod_fee_amount),
    // ×100 in floating point drifts (0.03 * 100 = 3.0000000000000004) — round to 2 decimals of a percent.
    pct: frac === null ? null : Math.round(frac * 10_000) / 100,
    minimum: num(s?.minimum_cod_fee),
  };
}
export async function kaShippingPrice(p: {
  origin: number;
  destination: number;
  weight: number; // grams
  // ⚠️ A PRICE INPUT, not metadata. KiriminAja applies VOLUMETRIC weight (w × l × h ÷ 6) whenever it
  // exceeds the actual weight — their pricing doc says so, and it is measurable: the same 1.000 g
  // parcel quotes Rp13.700 with weight alone and Rp54.800 once 40×30×20 cm is supplied, which is
  // exactly the 4.000 g those dimensions imply. `createShipment` has ALWAYS sent them when it books,
  // so omitting them here meant the quote and the booking priced two different parcels and the
  // merchant absorbed the difference. Omitted from the request when undefined — a catalogue with no
  // dimensions behaves exactly as before.
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  itemValue?: number;
  insurance?: 0 | 1;
  couriers?: string[];
}): Promise<{ ok: boolean; results: KaRate[]; error?: string }> {
  // cache successful rates per route (origin+dest+weight+value+insurance+couriers) — 10 min
  // ⚠️ The dimensions are part of the CACHE KEY. They change the price, so two carts that differ
  // only in box size must not share a cached quote.
  const key = `ka:price:${p.origin}:${p.destination}:${p.weight}:${p.lengthCm ?? 0}x${p.widthCm ?? 0}x${p.heightCm ?? 0}:${p.itemValue ?? 0}:${p.insurance ?? 0}:${(p.couriers ?? []).join(",")}`;
  const hit = cacheGet<{ ok: boolean; results: KaRate[] }>(key);
  if (hit) return hit;
  const { body: r } = await ka<{ status: boolean; text?: string; results?: KaRate[] }>("/api/mitra/v6.1/shipping_price", {
    origin: p.origin,
    destination: p.destination,
    weight: p.weight,
    ...(p.lengthCm ? { length: p.lengthCm } : {}),
    ...(p.widthCm ? { width: p.widthCm } : {}),
    ...(p.heightCm ? { height: p.heightCm } : {}),
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
  ok: boolean; awb?: string; kaOrderId?: string; pickupNumber?: string;
  /** Vendor `payment_status` (unpaid | pending | paid), verbatim. See below — this is load-bearing. */
  paymentStatus?: string; paymentUrl?: string; error?: string;
}> {
  // ⚠️ The payment fields are NOT decoration. One booking call carries two opposite money flows:
  // for a NON-COD parcel WE owe KiriminAja the shipping cost (`payment_method` defaults to `va`),
  // and an UNPAID booking never gets a waybill — so the parcel silently does not ship while the
  // order reads "dibooking". For a COD parcel the vendor ignores `payment_method` entirely and
  // settles from the buyer. These were parsed away for both, which made the first case invisible.
  // `apps/admin/lib/shipment-payment.ts` is the ONE place that separates the two.
  const { body: r } = await ka<{
    status: boolean; text?: string; pickup_number?: string;
    payment_status?: string; qr_url?: string | null;
    details?: { order_id: string; kj_order_id: string; awb: string | null; service: string; service_type: string }[];
    // ⚠️ v6.2 — MIGRATED 2026-08-20 (N40), and the contract is BYTE-FOR-BYTE the v6.1 one plus two
    // optional KA-Credit fields we do not send. That was not taken from the docs, which contradict
    // themselves three ways on the destination fields: the v6.2 table names
    // `destination_subdistrict_id`/`destination_village_id`, its own example names
    // `destination_kecamatan_id`/`destination_kabupaten_id`, and it omits the village field
    // altogether. The sandbox settled it — v6.2 is a Go service, so a candidate field sent with the
    // WRONG JSON TYPE makes the unmarshal name the real struct field and stay silent for one that
    // does not exist. Measured: only `destination_kecamatan_id` and `destination_kelurahan_id` bind
    // (`RequestPickupV62RequestPackage`); every name unique to the v6.2 doc is silently ignored.
    // **v6.1's names ARE the v6.2 names.** Full field-by-field evidence:
    // `specs/docs/tasks/2026-08-12-n40-v62-contract.md`.
    //
    // ⚠️ DO NOT ADD AN HTTP-STATUS CHECK WHILE TOUCHING THIS. v6.1 answered business failures as
    // HTTP 200 `{status:false}`; v6.2 answers **HTTP 400**, often with no `method` field. `ka()`
    // parses the JSON body regardless of status and we read only `status`/`text`, which is the only
    // reason this migration is one line — a status check would turn every ordinary refusal
    // ("Jadwal penjemputan tidak lagi tersedia") into a thrown error.
    //
    // ⚠️ `package_type_id` STAYS 7. The v6.2 doc says "default 7, or 9 for regular packages" and its
    // example sends 9, but what 9 changes is undocumented and cannot be probed without booking.
    // Conservative until the vendor answers. `add_cost` is in the doc's table and NOT in the struct
    // — we never sent it; do not start.
  }>("/api/mitra/v6.2/request_pickup", {
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
      // Sent EXPLICITLY rather than left to the vendor's default, which is not stated anywhere in
      // the docs. `drop: true` means the seller delivers the parcel to a drop point themselves;
      // every booking this product has ever made is a PICKUP, and the whole "Resi terbit" flow
      // (cron-tracking waiting for a courier to accept a pickup) assumes it. Pinning the value we
      // already depend on costs one field and removes a silent behaviour change from the vendor's
      // side. It binds as `bool` in the v6.2 struct.
      drop: false,
      ...(pkg.insuranceAmount ? { insurance_amount: pkg.insuranceAmount } : {}),
      ...(pkg.destZipcode ? { destination_zipcode: pkg.destZipcode } : {}),
    }],
  });
  const d = r.details?.[0];
  return {
    ok: !!r.status,
    // ⚠️ v6.2 RETURNS `awb: ""`, NOT `awb: null` — measured on the one authorised sandbox booking
    // (2026-08-20, kj_order_id `5758-…`, pickup `EPR-…`). v6.1 returned null, and `?? undefined`
    // passes an empty string straight through, so the migration would have started writing `""`
    // into `orders.awb` where the column had always been NULL. Nothing crashes — every reader tests
    // truthiness — but the row would then claim a waybill it does not have, `(awb is not null)`
    // sorts it to the BACK of the tracking poller's queue (it orders un-waybilled parcels first),
    // and any future `is not null` check would read it as issued. An empty string is not a waybill.
    awb: d?.awb ? d.awb : undefined,
    kaOrderId: d?.kj_order_id,
    pickupNumber: r.pickup_number,
    paymentStatus: r.payment_status,
    paymentUrl: r.qr_url ?? undefined,
    error: r.status ? undefined : r.text,
  };
}

// NOTE: the instant / same-day courier client (GoSend, Grab, Borzo — `kaInstantPricing` +
// `kaCreateInstantOrder`, /api/mitra/v4/instant/*) was REMOVED. TokoΦ ships via regular expedition
// couriers only (SPX, JNE, SiCepat, AnterAja, …). Do not reintroduce it without a product decision:
// it is the only feature that ever needed lat/lng coordinates.

// Cancel/void an express shipment. ⚠️ **BY AWB, AND ONLY BY AWB.**
// This comment used to read "by AWB (= kj_order_id / resi we stored)". That equivalence is FALSE and
// the vendor doc says so in as many words — *"awb: AWB Number Already Obtained, Not Order ID"*.
// Verified against the sandbox: passing a `kj_order_id` returns **"Paket tidak ditemukan"**, so a
// fresh booking (whose `awb` is always null) could not be cancelled at all. `cancelShipment` in
// apps/admin now refuses before the call and tells the merchant to fetch the waybill first.
// ⚠️ Cancellation is only possible BEFORE the courier collects, and a non-COD void is queued for up
// to 48 h — `status: true` means "accepted for cancellation", not "cancelled".
export async function kaCancelShipment(awb: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const { body: r } = await ka<{ status: boolean; text?: string }>("/api/mitra/v3/cancel_shipment", { awb, reason });
  return { ok: !!r.status, error: r.status ? undefined : r.text };
}

// express tracking by order id / AWB
export async function kaTrack(orderId: string): Promise<{ ok: boolean; data?: unknown; error?: string; httpStatus: number }> {
  const { body: r, httpStatus } = await ka<{ status: boolean; text?: string; data?: unknown }>("/api/mitra/tracking", { order_id: orderId });
  return { ok: !!r.status, data: r.data, error: r.status ? undefined : r.text, httpStatus };
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

// connection check (used by super-admin) — hits the province endpoint, which costs nothing.
//
// Task 8.3: this reply feeds BOTH the manual "Test koneksi" button and the cached health probe on
// Super Admin → Pengaturan, so it carries FACTS, not a verdict: `configured` (was anything called at
// all), `httpStatus`, and the vendor's own `text` verbatim on a `{status:false}` reply. The 401 that
// took every quote down on 2026-09-07 reads "Your IP address 45.77.33.112 were not allowed to access
// this API" — the sentence names the IP that has to be re-added, and it used to be flattened into
// "Auth ditolak / respons tidak valid." ADR 0004 hides provider words from SHOPPERS; the operator is
// exactly who must read them. `classifyKaProbe` (super-admin) turns these facts into a state.
export type KaTestResult = {
  ok: boolean;
  env: string;
  /** `false` = no API key, so nothing was called. */
  configured: boolean;
  /** HTTP status of whatever came back — a JSON refusal or a non-JSON transport failure alike. */
  httpStatus?: number;
  provinces?: number;
  /** The vendor's sentence on a parseable `{status:false}` reply, verbatim. Absent when no JSON arrived. */
  text?: string;
  message: string;
};

export async function kaTestConnection(): Promise<KaTestResult> {
  if (!KEY) return { ok: false, env: ENV, configured: false, message: "API key belum diisi (KIRIMINAJA_API_KEY)." };
  try {
    const { body: r, httpStatus } = await ka<{ status: boolean; datas?: unknown[]; text?: string; message?: string }>("/api/mitra/province", {});
    const n = (r.datas ?? []).length;
    if (r.status) return { ok: true, env: ENV, configured: true, httpStatus, provinces: n, message: `Terhubung ke KiriminAja (${ENV}) — ${n} provinsi.` };
    const text = r.text ?? r.message ?? "respons tidak valid";
    return { ok: false, env: ENV, configured: true, httpStatus, text, message: `KiriminAja (${ENV}) menolak — HTTP ${httpStatus}: ${text}` };
  } catch (e) {
    return {
      ok: false,
      env: ENV,
      configured: true,
      httpStatus: e instanceof KaTransportError ? e.httpStatus : undefined,
      message: e instanceof Error ? e.message : "Gagal terhubung.",
    };
  }
}
