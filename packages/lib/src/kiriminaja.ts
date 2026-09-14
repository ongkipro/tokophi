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

// ─────────────────────────────────────────────────────────────────────────────
// `order_id` — 20 CHARACTERS, INCLUDING THE PREFIX AND ITS HYPHEN (Task 8.20)
//
// The two endpoints disagree and we sat on the wrong side of it:
//   POST /api/mitra/v6.2/request_pickup → packages[].order_id   no maxLength
//   POST /api/mitra/tracking            → order_id              maxLength: 20
// So a booking is ACCEPTED with an id the tracking endpoint declares it will not take — which is
// the strongest available explanation for issue #12's "awbFilled has only ever been 0".
//
// ⚠️ NEVER TRUNCATE AT SEND TIME. An id the vendor stores in truncated form is an id we can never
// look up again. `buildKaOrderRef` shortens the CONSTRUCTION and `kaOrderId` THROWS rather than
// trimming, so a prefix change that would breach the limit fails loudly instead of silently
// minting unqueryable parcels.
export const KA_ORDER_ID_MAX = 20;
/**
 * The fewest order-identifying characters a reference may carry. The real order-number format is
 * `PHI-<9 digits of Date.now()><3 base36>`; 8 characters keeps the whole 3-char random tail plus
 * five timestamp digits, which is the floor at which a human can still find the order. A prefix
 * long enough to push the body under this is a MISCONFIGURATION, not something to absorb.
 */
const KA_REF_MIN_BODY = 8;

/** Characters left for the reference once `${prefix}-` is paid for. */
export function kaOrderRefBudget(prefix: string = KA_ORDER_PREFIX): number {
  return KA_ORDER_ID_MAX - prefix.length - 1;
}

/**
 * Build the reference half of `order_id` for one booking ATTEMPT of one order.
 *
 * - The leading `PHI` is dropped: it is constant across every order on the platform and the vendor
 *   prefix already identifies us, so it carried 0 bits while costing 3 of 20 characters. What is
 *   left (`768771328ISC`) is still the order number a human can search for in `orders.number`.
 * - `attempt` is the number of `shipment_bookings` rows this order already has, read under the same
 *   per-store advisory lock the reservation takes — a COUNTER, not a random tail. One base36
 *   character therefore separates 36 repeat bookings of one order EXACTLY (probability 0), where a
 *   random character would collide on ~27% of a mere five re-bookings. `provider_reference` is
 *   UNIQUE in the database and remains the backstop.
 * - Different ORDERS cannot collide on the production prefix `5758`, where nothing is dropped
 *   (`orders.number` is globally unique). On the longer `TOKOPHI` fallback one timestamp digit is
 *   dropped from the LEFT — the slowest-varying, least identifying one — so two orders would have
 *   to be placed exactly 10^8 ms (27,8 h) apart to the millisecond AND draw the same 1-in-46 656
 *   tail.
 */
export function buildKaOrderRef(
  orderNumber: string,
  attempt: number,
  prefix: string = KA_ORDER_PREFIX,
): string {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 35) {
    throw new Error(`KiriminAja order_id: booking attempt ${attempt} is outside 0..35 for ${orderNumber}`);
  }
  const suffix = attempt.toString(36).toUpperCase();
  const budget = kaOrderRefBudget(prefix);
  if (budget - suffix.length < KA_REF_MIN_BODY) {
    throw new Error(
      `KIRIMINAJA_ORDER_PREFIX "${prefix}" leaves only ${budget - suffix.length} characters for the order reference; ` +
        `${KA_REF_MIN_BODY} are needed to keep an order identifiable within the ${KA_ORDER_ID_MAX}-character tracking limit`,
    );
  }
  const compact = orderNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^PHI/, "");
  if (!compact) throw new Error(`KiriminAja order_id: order number "${orderNumber}" carries no identifier`);
  return compact.slice(-(budget - suffix.length)) + suffix;
}

/** The whole `order_id`. Throws — never trims — when the vendor's tracking limit would be breached. */
export function kaOrderId(orderRef: string, prefix: string = KA_ORDER_PREFIX): string {
  const id = `${prefix}-${orderRef}`;
  if (id.length > KA_ORDER_ID_MAX) {
    throw new Error(
      `KiriminAja order_id "${id}" is ${id.length} characters; POST /api/mitra/tracking accepts ${KA_ORDER_ID_MAX}. ` +
        `Refusing to book a parcel we could never track (Task 8.20).`,
    );
  }
  return id;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// THE SINK GUARD FOR `*_kelurahan_id` (Task 8.17)
//
// Every id sent as `kelurahan_id` or `destination_kelurahan_id` passes through here. The two id
// spaces this product holds for one village are trivially distinguishable, and that is the whole
// reason a runtime check is worth its lines:
//   Kemendagri  "34.02.07.2001"  text, dotted, 13 characters. Strip the dots and it is 3402072001 —
//                                a 10-digit number, which a well-meaning `Number()`/`replace` mints.
//   KiriminAja  31483            a plain integer; the vendor's subdistrict table is ~83k rows, so
//                                six digits is already generous and seven is the refusal line.
// TypeScript stops the obvious version (the column is `text`, the field is `number`), but the
// dangerous version type-checks: a `Number(row.id)` or a `parseInt` somewhere upstream produces a
// number that is not a courier id, and the vendor would take it — a pickup routed to a subdistrict
// nobody chose, with no error anywhere. So this THROWS rather than dropping the field: a booking
// built from a wrong id must fail loudly, the same rule `kaOrderId` follows.
export const KA_KELURAHAN_ID_MAX = 9_999_999;

/** Throws on anything that is not a plausible KiriminAja subdistrict id. Returns the id. */
export function assertKaKelurahanId(value: unknown, field: "kelurahan_id" | "destination_kelurahan_id"): number {
  if (typeof value === "string") {
    throw new Error(
      `KiriminAja ${field}: got the string ${JSON.stringify(value)}. This field takes KiriminAja's own ` +
        `numeric subdistrict id (POST /api/mitra/kelurahan). \`kelurahan.id\` is a Kemendagri code and is not one.`,
    );
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`KiriminAja ${field}: ${JSON.stringify(value)} is not a positive integer subdistrict id.`);
  }
  if (value > KA_KELURAHAN_ID_MAX) {
    throw new Error(
      `KiriminAja ${field}: ${value} is too large to be a KiriminAja subdistrict id (max ${KA_KELURAHAN_ID_MAX}). ` +
        `A 10-digit value is a Kemendagri village code with its dots stripped — sending it would route the parcel ` +
        `to a subdistrict nobody chose.`,
    );
  }
  return value;
}

/**
 * The conditional spread for one of the two fields. Absent/NULL -> `{}` (the field is OMITTED,
 * which is what NULL means and what shipped before this column existed); a value -> the field,
 * after the guard. Deliberately not `{ [field]: value ?? null }`: `null` is a value to the vendor.
 */
function kelurahanField<K extends "kelurahan_id" | "destination_kelurahan_id">(
  field: K,
  value: number | null | undefined,
): Record<K, number> | Record<string, never> {
  if (value === null || value === undefined) return {};
  return { [field]: assertKaKelurahanId(value, field) } as Record<K, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SINK GUARD FOR COORDINATES (Task 8.14, 0109 — KiriminAja's UAT review, 2026-09-14)
//
// v6.2 marks `latitude`/`longitude` (sender) and `destination_latitude`/`destination_longitude`
// (each package) REQUIRED. Until 0109 this product held no coordinate for anyone and sent none —
// and KiriminAja read that payload as "still v6.1". What it can honestly send now is a CENTROID:
// the kelurahan's when the checkout collected one, else the district's, both from the Kemendagri
// boundaries dataset (`@tokophi/db` `resolveAreaCoords`). Two rules, both enforced here rather than
// at each caller:
//   · BOTH OR NEITHER. A lone latitude is meaningless and the vendor would bind the other as 0.
//   · NEVER 0,0 AND NEVER OUTSIDE INDONESIA. `0,0` is a real point in the Gulf of Guinea, not "no
//     data"; a dispatcher on a geolocated service would route on it. Out-of-range is a dataset or
//     unit bug (lng/lat swapped is the classic) and must fail loudly, like `assertKaKelurahanId`.
export function coordFields<P extends "latitude" | "destination_latitude">(
  prefix: P,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Record<string, number> {
  if (lat == null && lng == null) return {};
  const lngKey = prefix === "latitude" ? "longitude" : "destination_longitude";
  if (lat == null || lng == null) {
    throw new Error(`KiriminAja ${prefix}/${lngKey}: got one coordinate without the other (${lat}, ${lng}). Send both or neither.`);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new Error(`KiriminAja ${prefix}/${lngKey}: ${lat},${lng} is not a coordinate. 0,0 means "unknown" to nobody — omit the fields instead.`);
  }
  if (lat < -11.5 || lat > 6.5 || lng < 94.5 || lng > 141.5) {
    throw new Error(`KiriminAja ${prefix}/${lngKey}: ${lat},${lng} is outside Indonesia (latitude −11,5…6,5 · longitude 94,5…141,5) — swapped axes or a bad row.`);
  }
  return { [prefix]: lat, [lngKey]: lng };
}

// create an express shipment (pickup request) → returns AWB / KiriminAja order id
//
// ✅ THE v6.2 FIELDS THE SPEC MARKS REQUIRED ARE ALL SENT WHEN WE HOLD THEM — Task 8.14, closed
// 2026-09-14 after KiriminAja's UAT review. Both postal codes, both subdistrict ids, the `items`
// manifest (with `metadata.sku`/`variant_label`) and, since 0109, both coordinate pairs as
// centroids. Each stays CONDITIONAL: a value we do not have is omitted, never sent as `0`/`""`.
//
// 🔴 `kelurahan_id` / `destination_kelurahan_id` TAKE KIRIMINAJA'S OWN SUBDISTRICT ID AND NOTHING
// ELSE — Task 8.17. Two id spaces exist for one village and they are not interchangeable:
//   · `kelurahan.id`            Kemendagri code, TEXT, dotted, 13 chars ("34.02.07.2001"). It is
//                               the key the POSTCODE dataset is published under, which is the only
//                               reason that table exists. It is NOT a courier id.
//   · `kelurahan.ka_kelurahan_id`  KiriminAja's own, a small integer (31483), from
//                               `POST /api/mitra/kelurahan` (kecamatan_id -> results[].id).
// The Kemendagri code used to be the only one we held, so both fields were omitted — correctly:
// a wrong id is worse than an absent one. `ka_kelurahan_id` (migration 0107) is populated by
// `packages/db/scripts/build-ka-kelurahan-ids.mjs`, which matches by NAME within one district and
// reports its unmatched rate rather than hiding it. It is NULL for the rows that did not match, and
// the fields below are still spread CONDITIONALLY: NULL means omit, exactly as before. Never make
// them unconditional on a column that may be NULL, and never send `0`/`""` for "unknown".
//
// `assertKaKelurahanId` above is the sink guard: it refuses anything shaped like a Kemendagri code.
//
// The SENDER half is wired (`store_settings.sender_kelurahan_id`, written from the Seller's pickup
// form). The DESTINATION half is not: `orders` carries no kelurahan column at all — the checkout
// collects one to derive the kodepos and `/api/public/order` ignores it — so `destKelurahanId` has
// no producer yet and stays undefined. That needs its own column and its own capture.
export type KaSender = {
  name: string; phone: string; address: string;
  kecamatanId: number; kelurahanId?: number | null;
  /** Sender postal code (`store_settings.sender_postcode`). Spec-required; omitted when we have none. */
  zipcode?: string | null;
  /**
   * Pickup coordinates — spec-required since v6.2 (KiriminAja's UAT review, 2026-09-14). The
   * value this product can honestly produce is the CENTROID of the seller's kelurahan (or district)
   * from `@tokophi/db` `resolveAreaCoords`; a street-level geocode does not exist here. Both or
   * neither: a lone coordinate is omitted with its pair, and `0,0` is refused by `coordFields`.
   */
  latitude?: number | null; longitude?: number | null;
};
/** One line of the parcel, as the v6.2 `packages[].items` schema wants it. `price` is PER UNIT. */
export type KaItem = {
  name: string; price: number; weight: number; qty: number;
  width: number; length: number; height: number;
  /** v6.2 `items[].metadata` — free-form partner data the spec names: SKU and variant label. */
  metadata?: { sku?: string | null; variant_label?: string | null } | null;
};
export type KaPackage = {
  orderRef: string; // becomes `${KA_ORDER_PREFIX}-${orderRef}`, ≤ 20 chars total — see buildKaOrderRef
  destName: string; destPhone: string; destAddress: string;
  destKecamatanId: number; destKelurahanId?: number | null; destZipcode?: string;
  weight: number; itemValue: number; itemName: string;
  service: string; serviceType: string; shippingCost: number;
  cod?: number; // COD amount to collect (0 = non-COD)
  insuranceAmount?: number; // 0/undefined = no insurance
  qty?: number; width?: number; length?: number; height?: number; packageTypeId?: number;
  /** Recipient coordinates — same rule as `KaSender.latitude`: a centroid, both or neither. */
  destLatitude?: number | null; destLongitude?: number | null;
  /** v6.2 `packages[].note` — free text for the courier (optional in the spec; omitted when empty). */
  note?: string | null;
  /**
   * The order's real lines. REQUIRED on the type, not optional: the spec requires the field, and a
   * caller that forgets it must fail `tsc` rather than silently book a parcel with no manifest
   * (same reasoning as `StoreBillingRow.suspendedAt`). Empty is legal only for a caller that
   * genuinely has no lines — the spec says `minItems: 1`, so we omit the key rather than send `[]`.
   */
  items: KaItem[];
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
    ...kelurahanField("kelurahan_id", sender.kelurahanId),
    ...coordFields("latitude", sender.latitude, sender.longitude),
    // Spec-required (Task 8.14). It has always been in `store_settings.sender_postcode` and rode
    // only inside the written pickup `address`; it is now ALSO its own field, which is what the
    // vendor documents. Omitted, never sent as `""`/`0`, when the seller has no kelurahan-derived
    // postcode — an empty string is not a postal code and today's lenient server accepts the
    // omission, so inventing a value could only make a real booking worse.
    ...(sender.zipcode ? { zipcode: sender.zipcode } : {}),
    platform_name: "mitra",
    schedule,
    packages: [{
      order_id: kaOrderId(pkg.orderRef),
      destination_name: pkg.destName, destination_phone: pkg.destPhone, destination_address: pkg.destAddress,
      destination_kecamatan_id: pkg.destKecamatanId,
      ...kelurahanField("destination_kelurahan_id", pkg.destKelurahanId),
      ...coordFields("destination_latitude", pkg.destLatitude, pkg.destLongitude),
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
      ...(pkg.note?.trim() ? { note: pkg.note.trim() } : {}),
      // Spec-required (Task 8.14): the parcel's real manifest, one entry per `order_line_items`
      // row — never one synthetic line, which is what `item_name` ("Pesanan INV-…") already is.
      // `price` is PER UNIT per the schema, and every numeric field carries `minimum: 1`, so the
      // caller floors them; see `createShipment` for where each number comes from. Omitted rather
      // than sent as `[]` when a caller genuinely has no lines — the schema says `minItems: 1`.
      ...(pkg.items.length
        ? {
            items: pkg.items.map((i) => ({
              name: i.name, price: i.price, weight: i.weight, qty: i.qty, width: i.width, length: i.length, height: i.height,
              // Only the keys the spec names, only when they carry a value — `metadata: {}` says nothing.
              ...(i.metadata?.sku || i.metadata?.variant_label
                ? { metadata: { ...(i.metadata.sku ? { sku: i.metadata.sku } : {}), ...(i.metadata.variant_label ? { variant_label: i.metadata.variant_label } : {}) } }
                : {}),
            })),
          }
        : {}),
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
