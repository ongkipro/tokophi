import "server-only";
import type { MengantarConfig } from "./provider-config";

// Mengantar PUBLIC API client — the shipment half. PARTNER model (owner 2026-11-05, supersedes D1/D4):
// every store has ITS OWN Mengantar seller account; every call here takes that seller's `cfg`
// (`{ env, base, key }`, opened by `@tokophi/db/mengantar-account`) EXPLICITLY — there is no platform
// key and no default config to fall back on. The Partner half (register / list / key) is
// `mengantar-partner.ts`. Reference: Mengantar's public API docs and the API reference (private, kept
// off-repo; its §15 mismatch list — S*/M* tags below — is what this file was corrected against).
//
// THE RULES THIS FILE EXISTS TO HOLD
//
// 1. THE KEY IS IN THE URL PATH (`{base}/api/public/{key}/…`), so any error that echoes the URL leaks
//    it. Every message this module throws or returns passes through `redactKey()` — raw AND
//    URL-encoded forms become `[REDACTED]`. Never attach an original error as `cause`.
// 2. A WRITE WHOSE OUTCOME WE CANNOT READ IS NOT A FAILURE. On a timeout, a dropped connection, a 5xx
//    or an unreadable 2xx, the shipment (or cancel, or payment) may have happened. That is
//    `MengantarOutcomeUnknownError`, and the caller must block a blind retry — the `idempotencyKey`
//    header is proven in the SANDBOX only (below), so a production retry may still be a second parcel
//    and a second wallet debit (risk R4) until it is proven there.
// 3. A BUSINESS REFUSAL IS DATA. A 4xx carrying JSON, or `success:false`, is returned as
//    `{ ok:false, error }` — the provider's own sentence, for the SELLER (never the shopper, ADR 0004).
//    Two refusals are typed because a caller acts on them: POS-COD ineligibility (403 trio) and
//    "Not allowed" (endpoint not whitelisted for the account).
// 4. TESTS CAN NEVER BOOK. Every write function refuses when `NODE_ENV === "test"` unless the caller
//    injected its own `fetch`. A sandbox exists now, but a test that books — even in the sandbox — is a
//    network call nobody approved, and a production key in a test env would be real money.
// 5. THREE COURIER NAMESPACES (trap 1). An estimate key (`SAP`, `JNECargo`) is not a booking name
//    (`Sap`, `JNE`+cargo). `shipmentName()` is the ONE map; `mgCreateOrder` refuses a courier that is
//    not a booking name before anything leaves the process.
// 6. A WAYBILL IS NOT A PICKUP (risk R5). Mengantar returns `cnote_no` at booking, before any courier
//    has touched the parcel. `outcomeFromMengantar` reads status only; nothing here derives "shipped"
//    from a waybill existing.
// 7. ONLY A PLAIN 400 IS A KNOWN NO-OP ON A WRITE (reference M2). 403 with a typed body (POS-COD,
//    "Not allowed") is definitive too; 409 on POST /order is the documented "a batch is already in
//    flight for this account" refusal — unless it carries an IDEMPOTENCY_* code. Every other 4xx on a
//    write is outcome-unknown.
// 8. A GREEN ENVELOPE IS NOT A BOOKING (M1): `POST /order` answers 200 `success:true` with an item
//    `status:"error"` and no ORDER_ID. Every item is judged.

export type { MengantarConfig } from "./provider-config";

/** 10 s, as adsbookcms runs it in production. */
export const MG_TIMEOUT_MS = 10_000;

// ─── Errors ─────────────────────────────────────────────────────────────────────────────────────

/** A READ that failed below the business layer: network, timeout, non-JSON body. Safe to retry. */
export class MengantarTransportError extends Error {
  constructor(readonly path: string, readonly httpStatus: number, detail: string) {
    super(`Mengantar ${path} → ${httpStatus ? `HTTP ${httpStatus}` : "no response"}: ${detail}`);
    this.name = "MengantarTransportError";
  }
}

/**
 * A WRITE that may or may not have been carried out — timeout, network drop, 5xx, unreadable 2xx.
 * For `POST /order` a shipment may exist: block the order from re-push until someone checks.
 */
export class MengantarOutcomeUnknownError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`Mengantar ${path}: outcome unknown — ${detail}. Do not retry blindly; check the Mengantar dashboard first.`);
    this.name = "MengantarOutcomeUnknownError";
  }
}

const POS_COD_BLOCK_REASONS = {
  new_seller: "akun belum punya riwayat pengiriman",
  insufficient: "data pengiriman akun belum cukup untuk dinilai",
  blocked: "tiga periode evaluasi terakhir di bawah ambang",
} as const;
export type MgPosCodBlockStatus = keyof typeof POS_COD_BLOCK_REASONS;

/**
 * POS refuses a COD order with 403 when the SELLER ACCOUNT's delivered rate is under its threshold
 * (82%, rolling 21–60 days). The estimate does not reveal it; only create-order does. Per seller
 * account = per store under the partner model (reference S4) — a fresh partner seller is `new_seller`.
 */
export class MengantarPosCodIneligibleError extends Error {
  constructor(
    readonly status: MgPosCodBlockStatus,
    readonly deliveredRate: number | null,
    readonly minimumDeliveredRate: number | null,
  ) {
    const rate =
      deliveredRate === null ? "" : `, delivered rate ${deliveredRate}%${minimumDeliveredRate === null ? "" : ` < ${minimumDeliveredRate}%`}`;
    super(`COD Pos Indonesia diblokir Mengantar untuk akun ini (${POS_COD_BLOCK_REASONS[status]}${rate}).`);
    this.name = "MengantarPosCodIneligibleError";
  }
}

/**
 * 403 "Not allowed": the SAME body for a missing permission, an invalid or disabled key, and a refused
 * IP (reference M16) — so it can mean "this store's key was rotated/disabled" too. A retry never helps.
 */
export class MengantarNotWhitelistedError extends Error {
  constructor(readonly path: string) {
    super(`Mengantar ${path}: akun belum di-whitelist untuk fitur ini. Minta akses ke CS Mengantar.`);
    this.name = "MengantarNotWhitelistedError";
  }
}

// ─── Plumbing ───────────────────────────────────────────────────────────────────────────────────

/** A business answer: the data, or the provider's own refusal (redacted). `httpStatus` 0 = never sent. */
export type MgResult<T> = { ok: true; data: T } | { ok: false; error: string; httpStatus: number; code?: string };

export type MgCallOptions = {
  /** THE SELLER ACCOUNT this call acts as. Required: there is no platform key to default to. */
  cfg: MengantarConfig;
  /** Injected transport. A write under `NODE_ENV=test` REFUSES without one. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Replace the key — raw and URL-encoded — with `[REDACTED]`. The one sanitiser every message passes. */
export function redactKey(message: string, key: string | null | undefined): string {
  if (!key) return message;
  let out = message;
  for (const s of new Set([key, encodeURIComponent(key)])) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}

/** Rule 4: tests can never reach the production API through a write. */
function assertWriteAllowed(fn: string, opts: MgCallOptions | undefined): void {
  if (process.env.NODE_ENV === "test" && !opts?.fetch) {
    throw new Error(`${fn} refused: a Mengantar WRITE under NODE_ENV=test needs an injected fetch (no unapproved network write from a test).`);
  }
}

type Envelope = Record<string, unknown> & { success?: unknown; data?: unknown; message?: unknown };
type Raw = { ok: true; body: Envelope; httpStatus: number } | { ok: false; error: string; httpStatus: number; code?: string };

type Body = { json: unknown } | { form: Record<string, string> };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function mg(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: MgCallOptions | undefined,
  body?: Body,
  extra?: { headers?: Record<string, string>; refusals?: number[] },
): Promise<Raw> {
  const write = method !== "GET";
  if (write) assertWriteAllowed(`Mengantar ${method} ${path.split("?")[0]}`, opts);
  const cfg = opts?.cfg;
  const key = cfg?.key;
  if (!cfg || !key) return { ok: false, error: "Akun Mengantar toko ini belum terhubung.", httpStatus: 0 };
  const label = `${method} ${path.split("?")[0]}`;
  const red = (m: string) => redactKey(m, key);
  const doFetch = opts?.fetch ?? globalThis.fetch;

  const headers: Record<string, string> = { Accept: "application/json", "x-client-source": "directCall", ...(extra?.headers ?? {}) };
  let payload: string | undefined;
  if (body && "json" in body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body && "form" in body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body.form).toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? MG_TIMEOUT_MS);
  let res: Response;
  let raw: string;
  try {
    res = await doFetch(`${cfg.base}/api/public/${encodeURIComponent(key)}${path}`, {
      method,
      headers,
      body: payload,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    raw = await res.text();
  } catch (e) {
    const aborted = controller.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));
    const detail = aborted ? "timeout" : red(e instanceof Error && e.message ? e.message : "network error");
    if (write) throw new MengantarOutcomeUnknownError(label, detail);
    throw new MengantarTransportError(label, 0, detail);
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown = undefined;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!isObj(parsed)) {
    // Redact BEFORE truncating or collapsing whitespace: either can break the key so it no longer matches.
    const snippet = red(raw).replace(/\s+/g, " ").trim().slice(0, 200) || "(empty)";
    if (write && (res.ok || res.status >= 500)) throw new MengantarOutcomeUnknownError(label, `HTTP ${res.status}, unreadable body: ${snippet}`);
    throw new MengantarTransportError(label, res.status, `non-JSON body: ${snippet}`);
  }

  const env = parsed as Envelope;
  const message = str(env.message);
  if (res.status === 403) {
    const st = env.status;
    if (typeof st === "string" && Object.hasOwn(POS_COD_BLOCK_REASONS, st)) {
      throw new MengantarPosCodIneligibleError(st as MgPosCodBlockStatus, num(env.deliveredRate), num(env.minimumDeliveredRate));
    }
    if (message === "Not allowed") throw new MengantarNotWhitelistedError(label);
  }
  if (write && res.status >= 500) throw new MengantarOutcomeUnknownError(label, red(`HTTP ${res.status}${message ? `: ${message}` : ""}`));
  // Rule 7: on a write, only the refusals the caller names (default: a plain 400) are known no-ops.
  if (write && res.status >= 300 && !(extra?.refusals ?? [400]).includes(res.status)) {
    throw new MengantarOutcomeUnknownError(label, red(`HTTP ${res.status}${message ? `: ${message}` : ""}${str(env.code) ? ` (${str(env.code)})` : ""}`));
  }
  if (!res.ok || env.success === false) {
    return { ok: false, error: red(message ?? `Mengantar ${label} gagal (HTTP ${res.status}).`), httpStatus: res.status, ...(str(env.code) ? { code: str(env.code)! } : {}) };
  }
  return { ok: true, body: env, httpStatus: res.status };
}

const fail = <T>(r: { error: string; httpStatus: number; code?: string }): MgResult<T> => ({ ok: false, error: r.error, httpStatus: r.httpStatus, ...(r.code ? { code: r.code } : {}) });
const refuse = <T>(error: string): MgResult<T> => ({ ok: false, error, httpStatus: 0 });

// ─── Areas & pickup addresses ───────────────────────────────────────────────────────────────────

export type MgArea = {
  /** Mengantar area `_id` (24-hex, kelurahan grain). */
  id: string;
  province: string;
  city: string;
  district: string;
  subdistrict: string;
  postalCode: string;
  originCode: string | null;
  destinationCode: string | null;
};

/** `GET /address/search?keyword=` — AND of substrings, hard cap 50 rows, no paging. */
export async function mgSearchArea(keyword: string, opts?: MgCallOptions): Promise<MgResult<MgArea[]>> {
  const q = keyword.trim();
  if (!q) return { ok: true, data: [] };
  const r = await mg("GET", `/address/search?${new URLSearchParams({ keyword: q })}`, opts);
  if (!r.ok) return fail(r);
  const rows = Array.isArray(r.body.data) ? r.body.data.filter(isObj) : [];
  return {
    ok: true,
    data: rows
      .filter((a) => str(a._id))
      .map((a) => ({
        id: str(a._id)!,
        province: str(a.PROVINCE_NAME) ?? "",
        city: str(a.CITY_NAME) ?? "",
        district: str(a.DISTRICT_NAME) ?? "",
        subdistrict: str(a.SUBDISTRICT_NAME) ?? "",
        postalCode: str(a.ZIP_CODE) ?? "",
        originCode: str(a.ORIGIN_CODE),
        destinationCode: str(a.DESTINATION_CODE),
      })),
  };
}

export type MgPickupAddress = { id: string; name: string; pic: string; picPhone: string; address: string; areaId: string | null };

const toPickup = (a: Record<string, unknown>): MgPickupAddress => ({
  id: str(a._id) ?? "",
  name: str(a.PICKUP_NAME) ?? "",
  pic: str(a.PICKUP_PIC) ?? "",
  picPhone: str(a.PICKUP_PIC_PHONE) ?? "",
  address: str(a.PICKUP_ADDRESS) ?? "",
  areaId: str(a.PICKUP_AUTOFILL) ?? (isObj(a.PICKUP_AUTOFILL) ? str(a.PICKUP_AUTOFILL._id) : null),
});

/** `GET /address` — the account's registered pickup addresses. */
export async function mgPickupAddresses(opts?: MgCallOptions): Promise<MgResult<MgPickupAddress[]>> {
  const r = await mg("GET", "/address", opts);
  if (!r.ok) return fail(r);
  const rows = Array.isArray(r.body.data) ? r.body.data.filter(isObj) : [];
  return { ok: true, data: rows.map(toPickup).filter((a) => a.id) };
}

export type MgPickupAddressInput = {
  /** The stored `_id` — present = update in place, absent = create. */
  id?: string | null;
  name: string;
  pic: string;
  picPhone: string;
  address: string;
  /** Mengantar area `_id` of the pickup kelurahan (`PICKUP_AUTOFILL`). */
  areaId: string;
};

const norm = (v: string) => v.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("id-ID");
const digits = (v: string) => v.replace(/\D/g, "");

/**
 * `POST /address` (form-encoded, as adsbookcms ships it). Returns the address `_id`. Mengantar
 * sometimes answers success with no `_id`; the list is then read back and matched (by id, else by
 * name + phone + address). Accepted-but-unidentifiable is outcome-unknown, not a failure: a retry
 * would register a second address.
 */
export async function mgUpsertPickupAddress(input: MgPickupAddressInput, opts?: MgCallOptions): Promise<MgResult<string>> {
  assertWriteAllowed("mgUpsertPickupAddress", opts);
  const form: Record<string, string> = {
    PICKUP_NAME: input.name,
    PICKUP_PIC: input.pic,
    PICKUP_PIC_PHONE: input.picPhone,
    PICKUP_ADDRESS: input.address,
    PICKUP_AUTOFILL: input.areaId,
  };
  const wantId = str(input.id);
  if (wantId) form._id = wantId;
  const r = await mg("POST", "/address", opts, { form });
  if (!r.ok) return fail(r);
  const d = isObj(r.body.data) ? r.body.data : {};
  const id = str(d._id) ?? str(d.address_id) ?? str(d.id);
  if (id) return { ok: true, data: id };

  const list = await mgPickupAddresses(opts);
  if (list.ok) {
    const hit =
      (wantId ? list.data.find((a) => a.id === wantId) : undefined) ??
      list.data.find((a) => norm(a.name) === norm(input.name) && digits(a.picPhone) === digits(input.picPhone) && norm(a.address) === norm(input.address));
    if (hit) return { ok: true, data: hit.id };
  }
  throw new MengantarOutcomeUnknownError("POST /address", "accepted without an _id and no matching address on re-list");
}

// ─── Pickup slots ───────────────────────────────────────────────────────────────────────────────

/** Provider slots: one hour each, 9:00 … 18:00 WIB. */
export const MG_PICKUP_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
/** A slot must start at least this far ahead; the provider refuses sooner. */
export const MG_PICKUP_LEAD_MS = 90 * 60 * 1000;

// An impossible date ("2026-13-45") is an Invalid Date, whose toISOString() THROWS — checked first.
const realIsoDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00+07:00`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
const clockMinutes = (v: unknown) => {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * The `time_id` for `addressId` on `date` (`YYYY-MM-DD`, Jakarta) at `hour`. Re-uses an existing slot
 * (`GET /time?address=`) before creating one (`POST /time`, date `mm-dd-yyyy`, time `H:00`). The hour
 * is compared numerically — whether Mengantar answers `9:00` or `09:00` is unverified, and a strict
 * string match that never hits books a fresh slot on every call.
 */
export async function mgPickupSlot(
  addressId: string,
  date: string,
  hour: number,
  opts?: MgCallOptions & { now?: number },
): Promise<MgResult<string>> {
  assertWriteAllowed("mgPickupSlot", opts);
  if (!str(addressId)) return refuse("Alamat pickup Mengantar belum terdaftar.");
  if (!realIsoDate(date)) return refuse(`Tanggal pickup tidak valid: ${date}`);
  if (!(MG_PICKUP_HOURS as readonly number[]).includes(hour)) return refuse("Jam pickup harus 09.00–18.00 WIB.");
  const startsAt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime();
  if (startsAt < (opts?.now ?? Date.now()) + MG_PICKUP_LEAD_MS) return refuse("Jadwal pickup minimal 90 menit dari sekarang.");

  const [y, m, d] = date.split("-");
  const slot = { date: `${m}-${d}-${y}`, time: `${hour}:00` };
  // Rows are compared NORMALISED (`slotRows`): GET answers epoch-ms dates, POST an ISO midnight, the
  // form we send is mm-dd-yyyy (reference M11). A raw string compare never matched and booked a fresh
  // slot on every call.
  const pick = (data: unknown) => slotRows(data, addressId).find((r) => r.date === date && r.hour === hour)?.id ?? null;
  // Documented: GET /time takes NO parameters (M10); the address filter happens in `slotRows`.
  const list = async () => mg("GET", "/time", opts);

  const existing = await list();
  if (!existing.ok) return fail(existing);
  const found = pick(existing.body.data);
  if (found) return { ok: true, data: found };

  const r = await mg("POST", "/time", opts, { form: { address_id: addressId, ...slot } });
  if (!r.ok) return fail(r);
  const created = pick(r.body.data) ?? (isObj(r.body.data) ? str(r.body.data._id) : null);
  if (created) return { ok: true, data: created };
  const again = await list();
  const late = again.ok ? pick(again.body.data) : null;
  if (late) return { ok: true, data: late };
  throw new MengantarOutcomeUnknownError("POST /time", "accepted without a slot _id and no matching slot on re-list");
}

/** One slot of `GET /time?address=`, normalised. `startsAt` = epoch ms of the slot start (WIB). */
export type MgPickupSlotRow = { id: string; date: string; hour: number; startsAt: number };

/**
 * A slot's DAY as `yyyy-mm-dd`. Accepts what the API has been seen or documented to send: epoch
 * MILLISECONDS (GET /time, a number or a digit string), an ISO timestamp (POST /time echoes
 * `…T00:00:00.000Z`), `mm-dd-yyyy` (what we send) and `yyyy-mm-dd`. A timestamp's day is read in UTC:
 * both documented examples put the slot's own day on the UTC calendar (reference §5.2 — UNVERIFIED
 * live). Anything else → null, never a guess.
 */
function slotDate(v: unknown): string | null {
  if (typeof v === "number" || (typeof v === "string" && /^\d{11,14}$/.test(v.trim()))) {
    const t = new Date(Number(v));
    return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  const us = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  return iso && realIsoDate(iso) ? iso : null;
}

/** The address a slot row names, when it names one (`address._id`, `address`, `address_id`). */
const slotAddress = (row: Record<string, unknown>): string | null =>
  isObj(row.address) ? str(row.address._id) : (str(row.address) ?? str(row.address_id));

/** Normalise slot rows; a row naming ANOTHER pickup address of this seller is dropped. */
function slotRows(data: unknown, addressId: string): MgPickupSlotRow[] {
  const rows = (Array.isArray(data) ? data : isObj(data) ? [data] : []).filter(isObj);
  const out: MgPickupSlotRow[] = [];
  for (const row of rows) {
    const id = str(row._id);
    const date = slotDate(row.date);
    const mins = clockMinutes(row.time);
    const addr = slotAddress(row);
    if (!id || !date || !Number.isFinite(mins) || mins % 60 !== 0) continue;
    if (addr && addr !== addressId) continue;
    const hour = mins / 60;
    if (!(MG_PICKUP_HOURS as readonly number[]).includes(hour)) continue;
    out.push({ id, date, hour, startsAt: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime() });
  }
  return out;
}

/**
 * `GET /time` (documented with no parameters, M10) — the seller's pickup slots, normalised for
 * `addressId`. A row whose date or hour cannot be read, whose hour is outside the 09–18 grid, or that
 * names another pickup address is dropped (never guessed into a slot). The sandbox answers `[]`.
 */
export async function mgPickupSlots(addressId: string, opts?: MgCallOptions): Promise<MgResult<MgPickupSlotRow[]>> {
  if (!str(addressId)) return refuse("Alamat pickup Mengantar belum terdaftar.");
  const r = await mg("GET", "/time", opts);
  if (!r.ok) return fail(r);
  return { ok: true, data: slotRows(r.body.data, addressId) };
}

/** The earliest listed slot that is still bookable (starts ≥ 90 min from `now`), or null. */
export function earliestPickupSlot(rows: MgPickupSlotRow[], now: number): MgPickupSlotRow | null {
  let best: MgPickupSlotRow | null = null;
  for (const r of rows) if (r.startsAt >= now + MG_PICKUP_LEAD_MS && (!best || r.startsAt < best.startsAt)) best = r;
  return best;
}

/** The earliest slot the provider's own rule allows (09:00–18:00 WIB, ≥ 90 min ahead), for `POST /time`. */
export function nextPickupStart(now: number): { date: string; hour: number; startsAt: number } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  for (let d = 0; d < 8; d++) {
    const date = day.format(new Date(now + d * 24 * 60 * 60 * 1000));
    for (const hour of MG_PICKUP_HOURS) {
      const startsAt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime();
      if (startsAt >= now + MG_PICKUP_LEAD_MS) return { date, hour, startsAt };
    }
  }
  /* c8 ignore next */
  throw new Error("no pickup slot within 8 days");
}

// ─── Courier namespaces ─────────────────────────────────────────────────────────────────────────

/**
 * THE ONE estimate-key → booking-name map (trap 1, docs `02-couriers-and-rules.md` §1.1). Keyed in
 * lower case because the docs advise matching estimate keys case-insensitively; the VALUES are the
 * exact strings `POST /order` takes. `SAPLite` is deliberately ABSENT (reference M8): it would book
 * as `Sap`, and how Mengantar tells SAP Lite from SAP at booking is UNVERIFIED — a Lite price for a
 * regular booking. Absent here = never quoted, never booked. `spx` has never been booked live (R6).
 */
const SHIPMENT_NAMES: Record<string, { courier: string; cargo: boolean }> = {
  jne: { courier: "JNE", cargo: false },
  jnecargo: { courier: "JNE", cargo: true },
  sicepat: { courier: "SiCepat", cargo: false },
  sicepatcargo: { courier: "SiCepat", cargo: true },
  sap: { courier: "Sap", cargo: false },
  sapcargo: { courier: "Sap", cargo: true },
  idexpress: { courier: "iDexpress", cargo: false },
  idexpresscargo: { courier: "iDexpress", cargo: true },
  jt: { courier: "JT", cargo: false },
  lion: { courier: "lion", cargo: false },
  anteraja: { courier: "anteraja", cargo: false },
  pos: { courier: "pos", cargo: false },
  spx: { courier: "spx", cargo: false },
};

/** The `POST /order` booking name for an estimate key, or `null` for a key we do not know how to book. */
export function shipmentName(estimateKey: string | null | undefined): { courier: string; cargo: boolean } | null {
  const hit = SHIPMENT_NAMES[(estimateKey ?? "").trim().toLowerCase()];
  return hit ? { ...hit } : null;
}

/**
 * Estimate key → TokoΦ's own courier code (the `COURIERS` roster in `couriers.ts`, the code
 * `platform_couriers.courier` / `store_settings.couriers` / `store_shipping_methods.courier` hold).
 * This is what lets the PLATFORM and STORE courier switches apply to a Mengantar quote without a
 * second roster. `null` = a key with no TokoΦ courier (Cargo keys, anything unknown): never quoted.
 * Additive helper for the quote wiring (SHIP-MENGANTAR, apps/admin/lib/shipping-quote.ts).
 */
const TOKOPHI_COURIER: Record<string, string> = {
  jne: "jne",
  sicepat: "sicepat",
  sap: "sap",
  idexpress: "idx",
  jt: "jnt",
  lion: "lion",
  anteraja: "anteraja",
  pos: "pos",
  spx: "spx",
};

export function mgCourierCode(estimateKey: string | null | undefined): string | null {
  return TOKOPHI_COURIER[(estimateKey ?? "").trim().toLowerCase()] ?? null;
}

const BOOKING_NAMES = new Set(Object.values(SHIPMENT_NAMES).map((s) => s.courier));

export type MgGroup = "regular" | "economy" | "cargo";
/** No service type in the API; derived from the key: `*Cargo` → cargo, `SAPLite` → economy, else regular. */
export function mgGroup(estimateKey: string): MgGroup {
  if (/cargo$/i.test(estimateKey)) return "cargo";
  if (/^saplite$/i.test(estimateKey)) return "economy";
  return "regular";
}

// ─── Estimate ───────────────────────────────────────────────────────────────────────────────────

export type MgRate = {
  /** The estimate key verbatim (`JNE`, `SAPLite`, `spx`) — a quote's service `type`. */
  key: string;
  /** What `POST /order` takes for this rate. */
  shipment: { courier: string; cargo: boolean };
  group: MgGroup;
  /** What the SHOPPER pays: Mengantar's public `price`. Never `estimatedSpecialPrice`. */
  price: number;
  /** Seller's net cost: `estimatedSpecialPrice − codFee` (the special price INCLUDES the COD fee, M6). `null` = not sent. */
  cost: number | null;
  /** Raw COD capability (`!unsupported_cod`). The platform's own COD chain still decides. */
  cod: boolean;
  /** `codFee`, present only when `COD_AMOUNT` was sent. */
  codFee: number | null;
  /** ETD text when Mengantar sends one (`estimate_delivery` / `estimatedDate`), else "". */
  etd: string;
};

/**
 * `GET /order/estimate?courier=all` → one rate per BOOKABLE courier. The answer is a MAP keyed by
 * estimate key; it is flattened here once. Dropped: Cargo keys (bulk freight, not consumer
 * parcels), `unsupported` and `unsupportedOriginSpx` (SPX's undocumented "cannot pick up from this
 * origin"), a missing/zero `price`, and any key `shipmentName()` cannot book. Weight is KG.
 */
export async function mgEstimate(
  input: { originId: string; destinationId: string; kg: number; codAmount?: number | null },
  opts?: MgCallOptions,
): Promise<MgResult<MgRate[]>> {
  const originId = input.originId.trim();
  const destinationId = input.destinationId.trim();
  if (!originId || !destinationId) return refuse("Area asal dan tujuan Mengantar wajib diisi.");
  if (!Number.isFinite(input.kg) || input.kg <= 0) return refuse(`Berat tidak valid: ${input.kg} kg`);
  const q = new URLSearchParams({ origin_id: originId, destination_id: destinationId, courier: "all", weight: String(input.kg) });
  if (input.codAmount && input.codAmount > 0) q.set("COD_AMOUNT", String(Math.round(input.codAmount)));
  const r = await mg("GET", `/order/estimate?${q}`, opts);
  if (!r.ok) return fail(r);
  const map = isObj(r.body.data) ? r.body.data : {};
  const rates: MgRate[] = [];
  for (const [key, v] of Object.entries(map)) {
    if (!isObj(v)) continue;
    if (mgGroup(key) === "cargo") continue;
    // SiCepat carries its own "cannot pick up here" pair (M7), SPX its origin flag.
    if (v.unsupported === true || v.unsupportedOriginSpx === true || v.unsupportedPickup === true || v.unsupportedOriginSicepat === true) continue;
    const shipment = shipmentName(key);
    const price = num(v.price);
    if (!shipment || price === null || price <= 0) continue;
    const special = num(v.estimatedSpecialPrice);
    const codFee = num(v.codFee);
    const cost = special !== null ? special - (codFee ?? 0) : null;
    rates.push({
      key,
      shipment,
      group: mgGroup(key),
      price,
      cost: cost !== null && cost > 0 ? cost : null,
      cod: v.unsupported_cod !== true && v.coverage_cod !== false,
      codFee,
      etd: str(v.estimate_delivery) ?? str(v.estimatedDate) ?? "",
    });
  }
  return { ok: true, data: rates };
}

// ─── Booking ────────────────────────────────────────────────────────────────────────────────────

/** `volume` is REQUIRED for a scheduled pickup (reference M13). Drop-off = the seller brings it to the courier. */
export type MgPickup =
  | { type: "dropOff"; address_id: string }
  | { type: "scheduledPickup"; address_id: string; time_id: string; volume: "volumeMotor" | "volumeMobil" | "volumeTruck" };

/** One parcel of `POST /order` `orders[]`. Weight is KG and must be the WHOLE order's (Σ lines, A1). */
export type MgOrderLine = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  /** Destination area `_id`. */
  customerAddressDataId: string;
  parcelContent: string;
  weight: number;
  quantity: number;
  /** What the buyer pays on delivery. Mutually exclusive with `goodsValue`. */
  COD?: number;
  goodsValue?: number;
  /** Our order number — the only marker of it on Mengantar's side (no client order id exists). */
  destinationMark?: string;
  deliveryInstruction?: string;
  assignee?: string;
  dontIncludeSubdistrict?: boolean;
  cargo?: boolean;
  isDangerousGoods?: boolean;
  /** If sent, weight and quantity must equal the sums exactly (docs). Shape UNVERIFIED — passed through. */
  customProducts?: Record<string, unknown>[];
};

export type MgCreateOrderInput = { courier: string; pickup: MgPickup; orders: MgOrderLine[] };

export type MgCreatedOrder = {
  /** Mengantar `_id` — what cancel takes. */
  id: string;
  orderId: string;
  /** Batch OBJECT id — what pay-unpaid takes. */
  batchId: string;
  /** Batch CODE — what `GET /order?batch=` takes (M3). */
  batchCode: string;
  /** The waybill. `null` when the wallet could not pay (non-COD) — NOT a failure; see `mgPayUnpaid`. */
  cnoteNo: string | null;
  isPaid: boolean;
};

/** The optional replay key (M19): 1–50 chars, header only, remembered 24 h per seller account. */
export const MG_IDEMPOTENCY_RE = /^[A-Za-z0-9:_-]{1,50}$/;

/**
 * `POST /order` — creates a shipment on THE STORE'S seller account and, for non-COD, debits THAT
 * seller's wallet (S5). One JT/SiCepat batch in flight per account (409). Judged per item (M1): an
 * item with `status:"error"` or no ORDER_ID is a refusal; an item whose `destinationMark` echo names
 * another order is outcome-unknown; a 2xx with no item `_id` is outcome-unknown.
 *
 * `idempotencyKey` is SENT (derived from our booking id by the caller). MEASURED in the sandbox
 * 2026-11-05 (one store, JT drop-off): the same key + same body a second time returned the SAME `_id`
 * (no second parcel); the same key + a different body → HTTP 422 `IDEMPOTENCY_KEY_REUSED` (read here as
 * outcome-unknown, conservative); a new key created a new order. Still NOT RELIED ON until the same is
 * seen in production: every unclear answer stays outcome-unknown.
 */
export async function mgCreateOrder(
  input: MgCreateOrderInput,
  opts?: MgCallOptions & { idempotencyKey?: string },
): Promise<MgResult<MgCreatedOrder>> {
  assertWriteAllowed("mgCreateOrder", opts);
  if (!BOOKING_NAMES.has(input.courier)) {
    return refuse(`"${input.courier}" bukan nama kurir booking Mengantar — petakan lewat shipmentName().`);
  }
  if (!input.orders.length) return refuse("Tidak ada paket untuk dibooking.");
  if (input.pickup.type === "scheduledPickup" && !input.pickup.volume) return refuse("Volume penjemputan wajib untuk scheduledPickup.");
  const idem = opts?.idempotencyKey?.trim();
  if (idem !== undefined && !MG_IDEMPOTENCY_RE.test(idem)) return refuse("idempotencyKey tidak valid (1–50 karakter).");
  const r = await mg("POST", "/order", opts, { json: input }, {
    headers: idem ? { idempotencyKey: idem } : undefined,
    // 409 = a batch already in flight for this account (documented, nothing created) — unless it is an
    // IDEMPOTENCY_* answer, which `mg()` cannot tell apart, so it is re-checked below.
    refusals: [400, 409],
  });
  if (!r.ok) {
    if (r.httpStatus === 409 && /IDEMPOTENCY/i.test(`${r.code ?? ""} ${r.error}`)) throw new MengantarOutcomeUnknownError("POST /order", "409 idempotency answer");
    return fail(r);
  }
  const items = Array.isArray(r.body.data) ? r.body.data.filter(isObj) : isObj(r.body.data) ? [r.body.data] : [];
  const first = items[0];
  const id = first ? str(first._id) : null;
  if (!first || !id) throw new MengantarOutcomeUnknownError("POST /order", "2xx without a shipment _id");
  const mark = str(first.destinationMark);
  const want = str(input.orders[0]?.destinationMark);
  if (mark && want && mark !== want) throw new MengantarOutcomeUnknownError("POST /order", "item echoes another destinationMark");
  const orderId = str(first.ORDER_ID);
  if (str(first.status)?.toLowerCase() === "error" || !orderId) {
    const why = str(first.error) && str(first.error) !== "{}" ? str(first.error)! : str(first.message) ?? "item status error";
    return { ok: false, error: redactKey(`Mengantar menolak paket: ${why}`, opts?.cfg.key), httpStatus: r.httpStatus };
  }
  return {
    ok: true,
    data: {
      id,
      orderId,
      batchId: str(first.batch_id) ?? str(r.body.batch_id) ?? "",
      batchCode: str(first.batch) ?? str(r.body.batch) ?? "",
      cnoteNo: str(first.cnote_no),
      isPaid: first.isPaid === true,
    },
  };
}

/**
 * `POST /order/pay-unpaid {batch_id, courier}` — pays a batch a short wallet left unpaid, from THE
 * STORE'S wallet (S6). Reads the paid COUNT (`data`) and the top-level `cnote_no[]` (M4); the AWB order
 * does not prove a mapping, so callers reconcile each order by `GET /order`. A 2xx whose count cannot
 * be read is outcome-unknown; a readable 0 is a refusal (nothing was paid).
 */
export async function mgPayUnpaid(batchId: string, courier: string, opts?: MgCallOptions): Promise<MgResult<{ paid: number; cnotes: string[] }>> {
  assertWriteAllowed("mgPayUnpaid", opts);
  if (!str(batchId)) return refuse("batch_id kosong.");
  const r = await mg("POST", "/order/pay-unpaid", opts, { json: { batch_id: batchId, courier } });
  if (!r.ok) return fail(r);
  const paid = num(r.body.data);
  if (paid === null) throw new MengantarOutcomeUnknownError("POST /order/pay-unpaid", "2xx without a readable paid count");
  if (paid <= 0) return { ok: false, error: "Mengantar tidak membayar pesanan apa pun di batch ini (saldo kurang?).", httpStatus: r.httpStatus };
  const cnotes = (Array.isArray(r.body.cnote_no) ? r.body.cnote_no : []).map(str).filter((c): c is string => !!c);
  return { ok: true, data: { paid, cnotes } };
}

/**
 * `DELETE /order {courier, ids}` — keyed by the Mengantar `_id`, not the waybill. Anteraja only after
 * 5 minutes. Past pickup an order is SILENTLY SKIPPED, so the answer's `deletedCount` decides (M5): 0
 * = not cancelled (a refusal); unreadable = outcome-unknown. Refund timing is UNVERIFIED.
 */
export async function mgCancel(courier: string, ids: string[], opts?: MgCallOptions): Promise<MgResult<{ deleted: number }>> {
  assertWriteAllowed("mgCancel", opts);
  const clean = ids.map((i) => i.trim()).filter(Boolean);
  if (!clean.length) return refuse("Tidak ada order Mengantar untuk dibatalkan.");
  const r = await mg("DELETE", "/order", opts, { json: { courier, ids: clean } });
  if (!r.ok) return fail(r);
  const deleted = num(r.body.deletedCount) ?? (isObj(r.body.data) ? num(r.body.data.deletedCount) : null);
  if (deleted === null) throw new MengantarOutcomeUnknownError("DELETE /order", "2xx without a readable deletedCount");
  if (deleted < clean.length) {
    return { ok: false, error: "Mengantar tidak menghapus pengiriman ini (kemungkinan sudah dijemput kurir).", httpStatus: r.httpStatus };
  }
  return { ok: true, data: { deleted } };
}

/**
 * SANDBOX ONLY: `POST /order/simulation` — moves an order to ON DELIVERY / DELIVERED / RTS so tracking
 * can be exercised deterministically (reference §8.2). Refused outright for a production config.
 */
export async function mgSimulate(
  input: { courier: string; orderId: string; statusCategory: "ON DELIVERY" | "DELIVERED" | "RTS" },
  opts?: MgCallOptions,
): Promise<MgResult<{ statusCategory: string | null }>> {
  assertWriteAllowed("mgSimulate", opts);
  if (opts?.cfg.env !== "sandbox") return refuse("Simulasi status hanya ada di sandbox Mengantar.");
  const r = await mg("POST", "/order/simulation", opts, { json: { courier: input.courier, orderId: input.orderId, statusCategory: input.statusCategory } });
  if (!r.ok) return fail(r);
  return { ok: true, data: { statusCategory: isObj(r.body.data) ? str(r.body.data.statusCategory) : null } };
}

// ─── Tracking ───────────────────────────────────────────────────────────────────────────────────

/** The same union as the admin's `KaOutcome` (`apps/admin/lib/ka-tracking.ts`), so one sync path reads both. */
export type MgOutcome = "booked" | "shipped" | "delivered" | "returned" | "canceled" | "problem";

const OUTCOME_BY_TOKEN: Record<string, MgOutcome | null> = {
  "PENDING PICKUP": "booked",
  "PICKED UP": "shipped",
  "PICKUP COMPLETE": "shipped",
  "PICKUP COMPLETED": "shipped",
  "ON DELIVERY": "shipped",
  "IN TRANSIT": "shipped",
  "OUT FOR DELIVERY": "shipped",
  DELIVERED: "delivered",
  "DELIVERED COMPLETE": "delivered",
  "DELIVERED COMPLETED": "delivered",
  "DELIVERY COMPLETE": "delivered",
  RTS: "returned",
  RETURNED: "returned",
  "RETURN TO SENDER": "returned",
  "DELIVERY COURIER": "shipped", // SiCepat / lion / anteraja / pos in-delivery (M15)
  CANCELED: "canceled",
  CANCELLED: "canceled",
  UNDELIVERED: "problem",
  "PICKUP FAILED": "problem",
  "PICKUP FAILED API": "problem",
  ERROR: "problem",
  LOST: "problem",
  "DELIVERY PROBLEM": "problem",
  // Mengantar-internal, no movement: deliberately no outcome.
  "ACTIVE/WAITING NEXT PROCESS": null,
  ACTIVE: null,
  "WAITING NEXT PROCESS": null,
};
// When several flags are true at once, the furthest-along fact wins.
const OUTCOME_RANK: Record<MgOutcome, number> = { booked: 1, shipped: 2, problem: 3, delivered: 4, canceled: 5, returned: 6 };

const token = (s: string) =>
  s
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9/]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .trim();

function outcomeOfToken(raw: string): MgOutcome | null {
  const t = token(raw);
  if (!t) return null;
  if (t in OUTCOME_BY_TOKEN) return OUTCOME_BY_TOKEN[t];
  if (t.startsWith("RTS ")) return "returned"; // RTS_* flag family
  return null;
}

/** Active (true) flags of a flag object or the JSON string of one; anything else → []. */
function activeFlags(v: unknown): string[] {
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return isObj(o) ? Object.entries(o).filter(([, on]) => on === true).map(([k]) => k) : [];
}

/**
 * A Mengantar status → the shared outcome, or `null` (no movement / not understood). Accepts a
 * `statusCategory` (`"PICKED UP"`), a plain-string `status` (sandbox: `"active"`), the production flag
 * JSON STRING (`{"DELIVERED_COMPLETED":true}`), or the parsed flag object. Unknown input is `null`,
 * never a guess. 🔴 Status only — a waybill existing is NOT "shipped" (risk R5).
 */
export function outcomeFromMengantar(input: unknown): MgOutcome | null {
  if (typeof input === "string" && !input.trim().startsWith("{")) return outcomeOfToken(input);
  let best: MgOutcome | null = null;
  for (const f of activeFlags(input)) {
    const o = outcomeOfToken(f);
    if (o && (!best || OUTCOME_RANK[o] > OUTCOME_RANK[best])) best = o;
  }
  return best;
}

export type MgTracking = {
  cnoteNo: string | null;
  orderId: string | null;
  /** The shipment `_id` (what `DELETE /order` takes), when the row carries one. */
  id: string | null;
  batchId: string | null;
  /** `isPaid` as sent; `null` = not in the row. */
  isPaid: boolean | null;
  /** Our order number as we sent it (`destinationMark`), when the row echoes it. Field presence UNVERIFIED. */
  destinationMark: string | null;
  courier: string | null;
  /** Active flag names as sent (evidence; nothing else maps off them). */
  flags: string[];
  outcome: MgOutcome | null;
  /** `date` is Mengantar's `DD-MM-YYYY HH:mm` WIB string, untouched. */
  histories: { date: string; desc: string }[];
};

/**
 * Parse one `GET /order` row. `statusCategory` decides when present (reference M14 — `status`
 * diverges per courier); the flag-JSON / plain `status` is the fallback. Parsed HERE, once.
 */
export function parseMgTracking(row: unknown): MgTracking {
  const r = isObj(row) ? row : {};
  const category = str(r.statusCategory);
  const plain = typeof r.status === "string" && !r.status.trim().startsWith("{") ? str(r.status) : null;
  const flags = category ? [category] : plain ? [plain] : activeFlags(r.status);
  return {
    cnoteNo: str(r.cnote_no),
    orderId: str(r.ORDER_ID),
    id: str(r._id),
    batchId: str(r.batch_id),
    isPaid: typeof r.isPaid === "boolean" ? r.isPaid : null,
    destinationMark: str(r.destinationMark),
    courier: str(r.courier),
    flags,
    outcome: (category ? outcomeFromMengantar(category) : null) ?? outcomeFromMengantar(r.status),
    histories: (Array.isArray(r.history) ? r.history : []).filter(isObj).map((h) => ({ date: str(h.date) ?? "", desc: str(h.desc) ?? "" })),
  };
}

async function track(param: "tracking_id" | "order_id", value: string, opts?: MgCallOptions): Promise<MgResult<MgTracking | null>> {
  const v = value.trim();
  if (!v) return refuse(`${param} kosong.`);
  const r = await mg("GET", `/order?${new URLSearchParams({ [param]: v })}`, opts);
  if (!r.ok) return fail(r);
  const rows = Array.isArray(r.body.data) ? r.body.data.filter(isObj) : [];
  // An EMPTY answer is "no such shipment". A NON-empty answer must name the shipment we asked for
  // (waybill or ORDER_ID): taking "the first row" of an answer about something else would map another
  // parcel's status onto this order — and an answer we cannot match is unknown, never "not found".
  if (!rows.length) return { ok: true, data: null };
  const want = v.toUpperCase();
  const row = rows.find((x) => [x.cnote_no, x.ORDER_ID].some((id) => str(id)?.toUpperCase() === want));
  if (!row) return { ok: false, error: "Jawaban pelacakan Mengantar tidak menyebut pengiriman yang diminta.", httpStatus: r.httpStatus };
  return { ok: true, data: parseMgTracking(row) };
}

/** `GET /order?tracking_id=` — by waybill. `data: null` = no such shipment. */
export const mgTrackByCnote = (cnote: string, opts?: MgCallOptions) => track("tracking_id", cnote, opts);
/** `GET /order?order_id=` — by Mengantar ORDER_ID, for a booking whose waybill is still null. */
export const mgTrackByOrderId = (orderId: string, opts?: MgCallOptions) => track("order_id", orderId, opts);

// ─── Wallet & health ────────────────────────────────────────────────────────────────────────────

/** `GET /invoices?size=1` → THE STORE'S wallet `balance` (IDR, top-level per the docs, M20). `null` = not in the answer. */
export async function mgBalance(opts?: MgCallOptions): Promise<MgResult<{ balance: number | null }>> {
  const r = await mg("GET", `/invoices?${new URLSearchParams({ page: "1", size: "1" })}`, opts);
  if (!r.ok) return fail(r);
  return { ok: true, data: { balance: num(r.body.balance) } };
}

/** Read-only probe (`GET /address`). Never throws: a transport failure is reported, redacted. */
export async function mgTestConnection(opts?: MgCallOptions): Promise<MgResult<{ pickupAddresses: number }>> {
  try {
    const r = await mgPickupAddresses(opts);
    return r.ok ? { ok: true, data: { pickupAddresses: r.data.length } } : r;
  } catch (e) {
    return refuse(e instanceof Error ? e.message : "Gagal menghubungi Mengantar.");
  }
}

// No webhook verifier: the status webhook is set by each SELLER in their own Mengantar dashboard and
// signed with a per-seller secret only `regenerate` reveals (reference §11, S9). TokoΦ tracks by
// POLLING (owner O9) — the cron sweep opens each order's own seller key.
