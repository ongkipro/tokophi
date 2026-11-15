import { createHash } from "node:crypto";
import type { MengantarPartnerConfig } from "./provider-config";

// Mengantar PARTNER API client ("Mengantar Partner Business API", owner 2026-11-05: replaces the
// platform key). It creates and manages SELLER accounts — one per TokoΦ store — and hands out each
// seller's Public-API key. It ships nothing; every shipment call is `mengantar.ts` with that key.
// Contract: Mengantar partner docs (private, kept off-repo). No `import "server-only"` on purpose:
// `packages/db` (the onboarding orchestrator, also run by tsx in ops scripts) imports this, and
// `server-only` is not resolvable outside Next/vitest — same reasoning as `crypto.ts`. Nothing under
// `apps/*/components` may import it.
//
// RULES
// 1. FIXED ORIGINS (`MENGANTAR_ORIGINS`). An env without a known Partner origin (production today)
//    REFUSES before anything is sent (`MengantarPartnerConfigError`).
// 2. A CREDENTIAL CALL WHOSE ANSWER WE CANNOT READ IS `unknown`, not a failure: register may have
//    created the seller, regenerate may have replaced the key. The register caller RECONCILES through
//    the seller list by `externalUserId`; a lost regenerate is recovered with "get key", never repeated.
// 3. RATE LIMITS are partner-wide (shared with every product on the same partner, owner O1). A 429 comes
//    back typed with `Retry-After` (`null` = unknown, never "retry now") for the caller to STORE.
// 4. The Partner Secret is never sent, logged or returned. A seller key in an answer goes to the caller
//    (who seals it) and never into an error message.
// 5. TESTS CAN NEVER CALL IT: under `NODE_ENV=test` every call refuses unless a `fetch` is injected.

export const MGP_TIMEOUT_MS = 15_000;
export const MGP_PATH = "/api/partner/v1";

/** Documented error codes. Unknown codes are kept verbatim. */
export type PartnerErrorCode =
  | "MISSING_FIELDS"
  | "PASSWORD_NOT_ALLOWED"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "INVALID_PHONE"
  | "INVALID_EXTERNAL_USER_ID"
  | "INVALID_PAGINATION"
  | "PHONE_NOT_ALLOWED"
  | "INVALID_TIMESTAMP"
  | "UNAUTHORIZED"
  | "IP_NOT_ALLOWED"
  | "PARTNER_DEACTIVATED"
  | "SELLER_DEACTIVATED"
  | "API_KEY_DISABLED"
  | "SELLER_NOT_FOUND"
  | "EMAIL_ALREADY_REGISTERED"
  | "RATE_LIMITED"
  | "DAILY_REGISTRATION_LIMIT"
  | "KEY_PROVISIONING_FAILED"
  | "INTERNAL_ERROR";

/** The config cannot make a Partner call at all (no origin for this env, no credential). Nothing was sent. */
export class MengantarPartnerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MengantarPartnerConfigError";
  }
}

export type PartnerFailure = {
  ok: false;
  /** 0 = no HTTP answer (timeout / network). */
  httpStatus: number;
  code: string;
  message: string;
  field?: string;
  /** 503 KEY_PROVISIONING_FAILED carries the created seller. */
  sellerId?: string;
  /** Seconds from `Retry-After`; `null` when a 429 did not say (= unknown, not "now"). */
  retryAfterSec?: number | null;
  /** TRUE = the request may have been carried out (timeout, network, 5xx, unreadable answer). */
  unknown: boolean;
};
export type PartnerResult<T> = { ok: true; httpStatus: number; data: T } | PartnerFailure;

export type PartnerCallOptions = {
  cfg: MengantarPartnerConfig;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Clock for the timestamp header (tests). */
  now?: () => number;
};

/** Request signature (exported for the offline vector test). */
export function signPartnerRequest(input: { method: string; path: string; type?: string; body: string; timestamp: string; secret: string }): string {
  const pre = `${input.method}:${input.path}:${input.type ?? ""}:${input.body}:${input.timestamp}:${input.secret}`;
  return createHash("sha256").update(pre, "utf8").digest("hex");
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function scrub(message: string, secrets: (string | null | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[REDACTED]");
  // A seller-key-shaped token in free text never leaves this module.
  return out.replace(/API-[A-Za-z0-9]{8,}/g, "[REDACTED]").slice(0, 300);
}

async function partnerPost(route: string, payload: Record<string, unknown>, opts: PartnerCallOptions): Promise<PartnerResult<Record<string, unknown>>> {
  if (process.env.NODE_ENV === "test" && !opts.fetch) {
    throw new Error(`Mengantar partner ${route} refused: a Partner call under NODE_ENV=test needs an injected fetch.`);
  }
  const { cfg } = opts;
  if (!cfg.partnerBase) {
    throw new MengantarPartnerConfigError(
      `Origin Partner API Mengantar untuk ${cfg.env} belum diketahui — isi MENGANTAR_ORIGINS di provider-config.ts setelah Mengantar memberikannya.`,
    );
  }
  if (!cfg.partnerId || !cfg.partnerSecret) throw new MengantarPartnerConfigError(`Kredensial Partner Mengantar (${cfg.env}) belum dikonfigurasi.`);
  const path = `${MGP_PATH}${route}`;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor((opts.now?.() ?? Date.now()) / 1000));
  const signature = signPartnerRequest({ method: "POST", path, body, timestamp, secret: cfg.partnerSecret });
  const red = (m: string) => scrub(m, [cfg.partnerSecret, signature]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? MGP_TIMEOUT_MS);
  let res: Response;
  let raw: string;
  try {
    res = await (opts.fetch ?? globalThis.fetch)(`${cfg.partnerBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "partner-id": cfg.partnerId, timestamp, signature },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    raw = (await res.text()).slice(0, 64_000);
  } catch (e) {
    const aborted = controller.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"));
    return { ok: false, httpStatus: 0, code: aborted ? "TIMEOUT" : "NETWORK", message: aborted ? "timeout" : red(e instanceof Error ? e.message : "network error"), unknown: true };
  } finally {
    clearTimeout(timer);
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  // A redirect, or a body that is not our JSON (sandbox Cloudflare 502 pages), tells us nothing.
  if (res.status >= 300 && res.status < 400) return { ok: false, httpStatus: res.status, code: "REDIRECT", message: `unexpected redirect ${res.status}`, unknown: true };
  if (!isObj(parsed)) return { ok: false, httpStatus: res.status, code: "UNREADABLE", message: `HTTP ${res.status}, unreadable body`, unknown: true };
  if (res.ok && parsed.success !== false) return { ok: true, httpStatus: res.status, data: parsed };

  const code = str(parsed.code) ?? (res.status >= 500 ? "INTERNAL_ERROR" : `HTTP_${res.status}`);
  const fail: PartnerFailure = {
    ok: false,
    httpStatus: res.status,
    code,
    message: red(str(parsed.message) ?? `Mengantar partner ${route} gagal (HTTP ${res.status}).`),
    // 503 KEY_PROVISIONING_FAILED is a KNOWN partial (the seller exists, its key does not yet); every
    // other 5xx may or may not have done the work.
    unknown: res.status >= 500 && code !== "KEY_PROVISIONING_FAILED",
  };
  const field = str(parsed.field);
  if (field) fail.field = field;
  const sellerId = str(parsed.sellerId) ?? (isObj(parsed.data) ? str(parsed.data.sellerId) : null);
  if (sellerId) fail.sellerId = sellerId;
  if (res.status === 429) {
    // `Number(null)` is 0 — a missing header must stay UNKNOWN, never "retry now".
    const h = res.headers.get("retry-after")?.trim();
    const ra = h ? Number(h) : NaN;
    fail.retryAfterSec = Number.isFinite(ra) && ra >= 0 ? Math.ceil(ra) : null;
  }
  return fail;
}

/** Indonesian mobile, `08` / `62` / `+62`, 10–15 digits (spaces, dashes, brackets ignored). → `62…` or null. */
export function partnerPhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(d)) return null;
  const n = d.startsWith("0") ? `62${d.slice(1)}` : d;
  return /^628\d{7,12}$/.test(n) ? n : null;
}

/**
 * The seller `name` Mengantar accepts: ASCII letters, digits, space and ' - _ . @, up to 100 characters.
 * Sandbox-proven 2026-11-12: "Kopi Señor", "Batik Café", "Toko Φ", "Toko & Co" and "Kedai 日本" are ALL
 * refused with 400 INVALID_NAME (the docs' "letters" means ASCII letters), and a 400 is never retried — so
 * an unfolded name would leave the store unconnected for good. Accents fold (é → e); anything else becomes
 * a space. The first candidate that survives wins (store name, then owner name), else "Toko".
 */
export function partnerSellerName(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const n = String(c ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 '\-_.@]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
      .trim();
    if (/[A-Za-z0-9]/.test(n)) return n;
  }
  return "Toko";
}

export type RegisteredSeller = { alreadyRegistered: boolean; sellerId: string; email: string | null; apiKey: string | null };

/**
 * `POST /sellers` — register (or, on a repeat of the same `externalUserId`, re-read) a seller. 201 new,
 * 200 `alreadyRegistered:true` with the CURRENT key (`null` = key disabled). 409 EMAIL_ALREADY_REGISTERED
 * = that email already has a Mengantar account (owner O7: no bring-your-own-key — the store stays on
 * the fallback). A 2xx without a sellerId is `unknown`.
 */
export async function partnerRegisterSeller(
  input: { name: string; email: string; phone: string; externalUserId: string },
  opts: PartnerCallOptions,
): Promise<PartnerResult<RegisteredSeller>> {
  const name = input.name.trim().slice(0, 100);
  const email = input.email.trim().toLowerCase();
  const phone = partnerPhone(input.phone);
  const ext = input.externalUserId.trim();
  if (!name || !email || !ext) return { ok: false, httpStatus: 0, code: "MISSING_FIELDS", message: "Nama, email dan externalUserId wajib.", unknown: false };
  // The provider's own code for this case (docs: 400 INVALID_EXTERNAL_USER_ID, "longer than 128 characters").
  if (ext.length > 128) return { ok: false, httpStatus: 0, code: "INVALID_EXTERNAL_USER_ID", message: "externalUserId lebih dari 128 karakter.", field: "externalUserId", unknown: false };
  if (!phone) return { ok: false, httpStatus: 0, code: "INVALID_PHONE", message: "Nomor HP pemilik harus nomor seluler Indonesia (08…/62…).", field: "phone", unknown: false };
  const r = await partnerPost("/sellers", { name, email, phone, externalUserId: ext }, opts);
  if (!r.ok) return r;
  const d = isObj(r.data.data) ? r.data.data : {};
  const sellerId = str(d.sellerId);
  if (!sellerId) return { ok: false, httpStatus: r.httpStatus, code: "UNREADABLE", message: "register answered without a sellerId", unknown: true };
  return { ok: true, httpStatus: r.httpStatus, data: { alreadyRegistered: r.data.alreadyRegistered === true, sellerId, email: str(d.email), apiKey: str(d.apiKey) } };
}

export type PartnerSeller = { sellerId: string; externalUserId: string | null; name: string | null; email: string | null; active: boolean };

/** `POST /sellers/list` — newest first, NO keys. `externalUserId` filters to one seller (the ownership proof). */
export async function partnerListSellers(
  input: { externalUserId?: string; page?: number; size?: number },
  opts: PartnerCallOptions,
): Promise<PartnerResult<{ sellers: PartnerSeller[]; total: number | null }>> {
  const body: Record<string, unknown> = {};
  if (input.externalUserId) body.externalUserId = input.externalUserId;
  if (input.page) body.page = input.page;
  if (input.size) body.size = Math.min(200, Math.max(1, input.size));
  const r = await partnerPost("/sellers/list", body, opts);
  if (!r.ok) return r;
  const d = isObj(r.data.data) ? r.data.data : {};
  const rows = Array.isArray(d.sellers) ? d.sellers.filter(isObj) : [];
  return {
    ok: true,
    httpStatus: r.httpStatus,
    data: {
      sellers: rows
        .filter((s) => str(s.sellerId))
        .map((s) => ({ sellerId: str(s.sellerId)!, externalUserId: str(s.externalUserId), name: str(s.name), email: str(s.email), active: s.active !== false })),
      total: typeof d.total === "number" ? d.total : null,
    },
  };
}

/** `POST /sellers/api-key` — the seller's CURRENT key; CREATES one if none exists (a credential operation). */
export async function partnerGetSellerKey(sellerId: string, opts: PartnerCallOptions): Promise<PartnerResult<{ sellerId: string; apiKey: string }>> {
  const r = await partnerPost("/sellers/api-key", { sellerId }, opts);
  if (!r.ok) return r;
  const d = isObj(r.data.data) ? r.data.data : {};
  const key = str(d.apiKey);
  if (!key || str(d.sellerId) !== sellerId) return { ok: false, httpStatus: r.httpStatus, code: "UNREADABLE", message: "api-key answered without this seller's key", unknown: true };
  return { ok: true, httpStatus: r.httpStatus, data: { sellerId, apiKey: key } };
}

/**
 * `POST /sellers/api-key/regenerate` — a NEW key; the old one dies IMMEDIATELY. NOT idempotent: a lost
 * answer (`unknown`) is recovered with `partnerGetSellerKey`, never by calling this again.
 * `callbackSecret` is discarded on purpose (webhooks are off, owner O9).
 */
export async function partnerRegenerateSellerKey(sellerId: string, opts: PartnerCallOptions): Promise<PartnerResult<{ sellerId: string; apiKey: string }>> {
  const r = await partnerPost("/sellers/api-key/regenerate", { sellerId }, opts);
  if (!r.ok) return r;
  const d = isObj(r.data.data) ? r.data.data : {};
  const key = str(d.apiKey);
  if (!key || str(d.sellerId) !== sellerId) return { ok: false, httpStatus: r.httpStatus, code: "UNREADABLE", message: "regenerate answered without this seller's key", unknown: true };
  return { ok: true, httpStatus: r.httpStatus, data: { sellerId, apiKey: key } };
}

/** The partner-side id of one store in one env — the CHECK constraint on `store_mengantar_accounts` mirrors it. */
export const mengantarExternalUserId = (storeId: string, env: "sandbox" | "production") =>
  env === "production" ? `tokophi:store:${storeId}` : `tokophi:sandbox:store:${storeId}`;
