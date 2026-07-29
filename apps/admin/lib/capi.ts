import "server-only";
import { createHash } from "node:crypto";

// Server-side conversion senders (ADR 0012 §16) — Meta Conversions API, GA4 Measurement Protocol,
// TikTok Events API. ONE provider boundary: everything above this file speaks the normalized
// `ServerEvent`; everything provider-specific (URL, field names, hashing rules) lives here, so a
// provider changing its contract is a change to one file.
//
// ⚠️ Nothing here throws into a request path. Every send returns a RESULT the caller persists —
// `retryable` decides whether the cron backs off or dead-letters, and a permanent failure (revoked
// token, wrong pixel) must stop retrying instead of hammering the provider forever (§23.2).
//
// PRIVACY: identity is hashed HERE and nowhere else. Raw email/phone arrive as arguments, become
// SHA-256 hex, and are never returned, logged or persisted (§25). `sanitize()` guards the error path —
// a provider error body can echo back the request, so it is truncated and stripped of anything that
// looks like a token before it reaches `last_error_message`.

// Meta's Graph version. Configured, never scattered (§5): one env, one default, one place to bump.
// v25.0 = the newest stable at 2026-07-29 (verified against the changelog + a live probe: v26.0 does
// not resolve). Meta supports a version for ~2 years — v21.0, the previous default here, expires around
// Oct 2026, which is not a default to leave lying around.
const META_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const TIMEOUT_MS = 10_000;

export type ServerEventName = "Purchase";

export type ServerEvent = {
  eventName: ServerEventName;
  /** Shared with the browser pixel — this is what makes the provider de-duplicate (§14.3). */
  eventId: string;
  /** Unix seconds. The provider rejects events that are too old, so this is the ORDER's time. */
  eventTime: number;
  value: number;
  currency: string;
  contentIds: string[];
  numItems: number;
  orderNumber: string;
  sourceUrl?: string;
  /** Hashed inside this module, never stored on the delivery row. */
  identity?: { email?: string | null; phone?: string | null };
  /**
   * Browser context captured when the order was placed. Meta documents `client_user_agent` (and
   * `event_source_url`) as REQUIRED for website events, and `fbp`/`fbc` as the strongest match keys —
   * without them a server event is accepted and then attributed to nobody. TikTok wants ip + UA for the
   * same reason. This is why they travel on the queue row: by the time the cron runs, the shopper's
   * request is long gone.
   */
  client?: {
    userAgent?: string | null;
    ip?: string | null;
    /** `_fbp` / `_fbc` cookies, read on the storefront and passed through the order API. */
    fbp?: string | null;
    fbc?: string | null;
    /** `_ga` cookie value → GA4's real client id, so the purchase joins the shopper's own session. */
    gaClientId?: string | null;
  };
};

export type SendResult = {
  ok: boolean;
  /** Retryable = network/timeout/5xx/429. Permanent = auth/validation → dead-letter (§23.2). */
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Every provider agrees on email: trim, lowercase, then SHA-256. */
const hashEmail = (v?: string | null) => {
  const e = (v ?? "").trim().toLowerCase();
  return e && e.includes("@") ? sha256(e) : null;
};

/**
 * Phone, and the providers do NOT agree — which is exactly the kind of difference that fails silently:
 * hash the wrong shape and the digest simply never matches anything, forever, with a 200 OK.
 *   • Meta: "remove symbols, letters and any leading zeros", country code required → `628123…`
 *   • TikTok / GA4: E.164, which INCLUDES the leading `+`                        → `+628123…`
 * So the caller says which one it wants. One shared normalizer would be a bug wearing a helper's hat.
 */
const hashPhone = (v: string | null | undefined, opts: { e164: boolean }) => {
  const d = (v ?? "").replace(/[^\d]/g, "");
  if (d.length < 8) return null;
  return sha256(opts.e164 ? `+${d}` : d);
};

// Redaction + retry classification live in the pure half so they can be tested (capi-sanitize.test.ts).
export { sanitize, classify } from "./capi-sanitize";
import { classify, sanitize } from "./capi-sanitize";

/** One fetch with a hard timeout — a hanging provider must not hold a cron tick open. */
async function post(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; text: string } | { networkError: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: res.status, text: (await res.text()).slice(0, 2000) };
  } catch (err) {
    return { networkError: err instanceof Error ? err.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Meta Conversions API ─────────────────────────────────────────────────────────────────────────
// POST /{pixel_id}/events — `event_id` here + `eventID` in fbq() is the documented de-dup pair.
export async function sendMetaPurchase(args: {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  event: ServerEvent;
}): Promise<SendResult> {
  const { event } = args;
  // ⚠️ A SERVER-SIDE CONVERSION WITHOUT AN IDENTIFIER IS NOT A CONVERSION — Meta rejects an event whose
  // `user_data` has no key, and there is no browser cookie out here to fall back on. So the hashed
  // phone/email always travel with a server event; that IS what "Conversions API" means, and the
  // Seller's "Advanced matching" switch governs the BROWSER pixel, not this.
  //
  // This used to be gated on that switch — which defaults to OFF — so the out-of-the-box configuration
  // sent `user_data: {}` and Meta 400'd every single Purchase straight into dead_letter. A feature that
  // fails closed on its own default is a feature that does not exist.
  // `client_user_agent` and `client_ip_address` are `user_data` fields too — Meta documents the UA as
  // REQUIRED for website events, and together with `fbp`/`fbc` they are what actually attributes the
  // conversion. They also mean `user_data` is never empty even for an order with no email/phone.
  const user_data: Record<string, unknown> = {};
  const em = hashEmail(event.identity?.email);
  const ph = hashPhone(event.identity?.phone, { e164: false }); // Meta: digits, NO leading +
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (event.client?.userAgent) user_data.client_user_agent = event.client.userAgent; // never hashed
  if (event.client?.ip) user_data.client_ip_address = event.client.ip; // never hashed
  if (event.client?.fbp) user_data.fbp = event.client.fbp;
  if (event.client?.fbc) user_data.fbc = event.client.fbc;
  if (Object.keys(user_data).length === 0) {
    // Never fabricate an identifier to satisfy the API. Fail permanently with a reason the merchant
    // can act on.
    return {
      ok: false,
      retryable: false,
      errorCode: "no_identity",
      errorMessage: "Pesanan tidak punya data pencocokan (email/telepon/perangkat), jadi Meta tidak bisa mencocokkan konversinya.",
    };
  }
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        action_source: "website",
        ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
        user_data,
        custom_data: {
          value: event.value,
          currency: event.currency,
          content_ids: event.contentIds,
          content_type: "product",
          // NO `num_items` — Meta documents it as "use only with InitiateCheckout events".
          order_id: event.orderNumber,
        },
      },
    ],
    access_token: args.accessToken,
  };
  if (args.testEventCode) body.test_event_code = args.testEventCode;

  const res = await post(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(args.pixelId)}/events`, body);
  if ("networkError" in res) return { ok: false, retryable: true, errorCode: "network", errorMessage: sanitize(res.networkError) };
  const http = classify(res.status, res.text);
  if (http.ok) return http;
  // ⚠️ Graph answers HTTP 400 for EVERYTHING, throttling included — so the status alone would send a
  // rate-limited batch to dead_letter and lose those conversions. The verdict is `error.code`:
  // 1/2 (transient/unknown), 4/17/32/613 (rate limits) are documented as "wait and retry"; 190
  // (bad/expired token) and validation errors are ours to fix and must NOT be retried.
  try {
    const parsed = JSON.parse(res.text) as { error?: { code?: number; message?: string } };
    const code = parsed.error?.code;
    if (typeof code === "number") {
      const transient = [1, 2, 4, 17, 32, 613].includes(code);
      // WIDENS retryability, never narrows it: a Graph 5xx that happens to carry a validation-looking
      // code is still an outage, and dead-lettering it on the first blip loses the sale.
      return { ok: false, retryable: transient || http.retryable, errorCode: `meta_${code}`, errorMessage: sanitize(parsed.error?.message ?? res.text) };
    }
  } catch {
    /* non-JSON error body — keep the HTTP verdict */
  }
  return http;
}

// ── Credential probes ────────────────────────────────────────────────────────────────────────────
// "Is this token real, and does it reach THIS pixel?" — answered before a merchant's first sale rather
// than after their conversions have already been dead-lettering for a week.
//
// ⚠️ None of these may create a conversion. In particular a Meta/TikTok event carrying
// `test_event_code` is NOT a sandbox: Meta documents that such events "are not dropped… and are used
// for targeting and ads measurement purposes". So the Meta probe sends an EMPTY `data` array, which
// Graph rejects on auth before it ever looks at the payload.

export type ProbeResult = { ok: boolean; message: string };

/**
 * Meta: `POST /{pixel_id}/events` with `data: []`. Auth is evaluated first, so the response tells us
 * about the token and the pixel without submitting anything.
 *   190              → token invalid / expired / revoked
 *   100 (subcode 33) → token is fine but cannot see THIS pixel
 *   200–299          → a required permission was removed
 */
export async function probeMeta(pixelId: string, accessToken: string): Promise<ProbeResult> {
  const res = await post(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(pixelId)}/events`, {
    data: [],
    access_token: accessToken,
  });
  if ("networkError" in res) return { ok: false, message: "Tidak bisa menghubungi Meta. Coba lagi sebentar." };
  let code: number | undefined;
  let sub: number | undefined;
  try {
    const parsed = JSON.parse(res.text) as { error?: { code?: number; error_subcode?: number } };
    code = parsed.error?.code;
    sub = parsed.error?.error_subcode;
  } catch {
    /* ignore */
  }
  if (code === 190) return { ok: false, message: "Token akses ditolak Meta — kedaluwarsa atau sudah dicabut. Buat token baru di Events Manager." };
  if (code === 100 && sub === 33) return { ok: false, message: "Token valid, tapi tidak punya akses ke Pixel ID ini. Periksa ID-nya, atau berikan akses ke token tersebut." };
  if (code !== undefined && code >= 200 && code < 300) return { ok: false, message: "Izin token dicabut di Meta. Buat ulang token dengan akses Conversions API." };
  if (res.status >= 200 && res.status < 300) return { ok: true, message: "Token valid dan punya akses ke Pixel ini." };
  // A complaint about the PAYLOAD (we deliberately sent an empty `data` array) means Graph got past
  // authentication and past the pixel lookup — which is the whole question. Without this branch the
  // success path is only reachable if Graph happens to answer 2xx to an empty batch, which is
  // undocumented; a probe that reports failure for a perfectly good token is worse than no probe.
  if (code === 100 && sub !== 33) return { ok: true, message: "Token valid dan punya akses ke Pixel ini." };
  // Never the raw provider body (ADR 0012 §20.4) — a code the merchant can quote to support instead.
  return { ok: false, message: `Meta menolak permintaan${code !== undefined ? ` (kode ${code})` : ""}. Periksa Pixel ID dan token.` };
}

/**
 * TikTok: the Events API is the only endpoint we can reach without an advertiser id, so the probe is a
 * real call whose verdict is read from the body `code`.
 *   40104/40105/40102 → token empty / invalid-revoked / expired
 *   40001             → token fine, no permission on this pixel
 *   0                 → valid and authorized
 */
export async function probeTiktok(pixelId: string, accessToken: string): Promise<ProbeResult> {
  const res = await post(
    "https://business-api.tiktok.com/open_api/v1.3/event/track/",
    { event_source: "web", event_source_id: pixelId, data: [] },
    { "Access-Token": accessToken },
  );
  if ("networkError" in res) return { ok: false, message: "Tidak bisa menghubungi TikTok. Coba lagi sebentar." };
  let code: number | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(res.text) as { code?: number; message?: string };
    code = parsed.code;
    message = parsed.message;
  } catch {
    /* ignore */
  }
  if (code === 0) return { ok: true, message: "Token valid dan punya akses ke Pixel ini." };
  if (code === 40104 || code === 40105 || code === 40102)
    return { ok: false, message: "Token akses ditolak TikTok — kosong, salah, atau kedaluwarsa. Buat ulang di Events Manager." };
  if (code === 40001) return { ok: false, message: "Token valid, tapi tidak punya izin atas Pixel ID ini." };
  // A throttle is not a verdict on the credential — say so instead of showing a green tick.
  if (code !== undefined && TIKTOK_RETRYABLE.has(code))
    return { ok: false, message: "TikTok sedang membatasi permintaan. Coba uji lagi sebentar lagi." };
  // Anything else: TikTok evaluates the token BEFORE the payload (proven — a missing token returns
  // 40104 even with `data: []`), so reaching a non-auth, non-permission, non-throttle code means the
  // credential authenticated and it is the empty batch being refused. Reported as a pass WITH the
  // caveat, because TikTok's full code table is not published anywhere we can read.
  if (code !== undefined)
    return { ok: true, message: "Token diterima TikTok. Pastikan Pixel ID benar lewat Test Events." };
  return { ok: false, message: sanitize(message ?? res.text).slice(0, 160) };
}

/**
 * Google: **there is no credential validation.** Officially, "the validation server does not validate
 * the api_secret or measurement_id" — a garbage secret with a valid payload returns no messages, and
 * `/mp/collect` answers 204 for anything. So this checks the PAYLOAD shape against Google's own debug
 * endpoint and says exactly that. Never render this as "Terhubung".
 */
export async function probeGa4(measurementId: string, apiSecret: string): Promise<ProbeResult> {
  const url =
    `https://www.google-analytics.com/debug/mp/collect` +
    `?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const res = await post(url, {
    client_id: "555.555",
    events: [{ name: "purchase", params: { transaction_id: "TEST", value: 1, currency: "IDR", items: [{ item_id: "TEST" }] } }],
  });
  if ("networkError" in res) return { ok: false, message: "Tidak bisa menghubungi Google. Coba lagi sebentar." };
  try {
    const parsed = JSON.parse(res.text) as { validationMessages?: { description?: string }[] };
    const msgs = parsed.validationMessages ?? [];
    if (msgs.length === 0) {
      return {
        ok: true,
        message:
          "Format sudah benar. Google TIDAK memvalidasi Measurement ID / API secret, jadi pastikan datanya muncul di GA4 → Realtime sebelum dianggap live.",
      };
    }
    return { ok: false, message: sanitize(msgs.map((m) => m.description).join("; ")).slice(0, 200) };
  } catch {
    return { ok: false, message: "Jawaban Google tidak bisa dibaca." };
  }
}

// ── GA4 Measurement Protocol ─────────────────────────────────────────────────────────────────────
// ⚠️ MP answers **204 for everything** — valid payload, malformed body, even no query params at all
// (probed 2026-07-29). So `ok` here means "accepted", never "correct"; the merchant verifies in GA4
// DebugView. Validate changes against https://www.google-analytics.com/debug/mp/collect, which DOES
// return validation messages, before believing a green row in the health panel.
export async function sendGa4Purchase(args: {
  measurementId: string;
  apiSecret: string;
  clientId: string;
  event: ServerEvent;
}): Promise<SendResult> {
  const { event } = args;
  // Backdating: with the default validation behaviour MP does NOT discard an old event — it ACCEPTS it
  // and clamps the timestamp to 72 hours ago. An earlier version of this file refused to send past that
  // window, which permanently dead-lettered conversions GA4 would have recorded (a prepaid order paid
  // four days after checkout hits it every time). So we send, and let Google clamp; the sale is
  // reported, dated later than it happened. That trade is deliberate — under-reporting revenue is worse
  // than mis-dating it — and it is why `timestamp_micros` is still sent rather than omitted.
  const url =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${encodeURIComponent(args.measurementId)}&api_secret=${encodeURIComponent(args.apiSecret)}`;
  // Hashed user data — MP does have a documented contract for it (top-level `user_data` with
  // `sha256_email_address` / `sha256_phone_number`), contrary to what this file used to claim. Phone
  // must be E.164 **with** the `+` before hashing, or the digest matches nothing.
  const ga_email = hashEmail(event.identity?.email);
  const ga_phone = hashPhone(event.identity?.phone, { e164: true });
  const body: Record<string, unknown> = {
    client_id: args.clientId,
    // `eventTime` is Unix SECONDS; MP wants microseconds. Backdating beyond 72 h is silently dropped,
    // which is why the guard above refuses to send instead of recording a delivery that never happened.
    timestamp_micros: event.eventTime * 1_000_000,
    ...(ga_email || ga_phone
      ? {
          user_data: {
            ...(ga_email ? { sha256_email_address: ga_email } : {}),
            ...(ga_phone ? { sha256_phone_number: ga_phone } : {}),
          },
        }
      : {}),
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: event.orderNumber,
          value: event.value,
          currency: event.currency,
          items: event.contentIds.map((id) => ({ item_id: id })),
        },
      },
    ],
  };
  const res = await post(url, body);
  if ("networkError" in res) return { ok: false, retryable: true, errorCode: "network", errorMessage: sanitize(res.networkError) };
  return classify(res.status, res.text);
}

// ── TikTok Events API ────────────────────────────────────────────────────────────────────────────
// Auth failures DO come back as real 4xx (probed 2026-07-29: no token → 400 `40104`, bad token → 401
// `40105`), so `classify()` handles those. But TikTok can also answer HTTP 200 with a non-zero `code`
// for other rejections, so the body's `code` is parsed as the real verdict.
// ⚠️ The 40000–49999 = permanent rule is INFERRED, not sourced: TikTok's error-code table is a
// client-rendered page we could not read from an official primary source. If a rate-limit code turns
// out to live in that range we are dead-lettering something we should back off — verify at launch.
export async function sendTiktokPurchase(args: {
  pixelId: string;
  accessToken: string;
  event: ServerEvent;
  testEventCode?: string | null;
}): Promise<SendResult> {
  const { event } = args;
  // Same reasoning as Meta: a server event with no match key is WORSE than a rejection — TikTok answers
  // `code: 0`, we record "delivered", and the merchant sees zero attributed conversions with nothing
  // anywhere saying why. ip + user_agent are match keys in their own right, so they always travel.
  // ⚠️ TikTok specifies E.164, so the phone is hashed WITH the leading `+` — a different digest from
  // Meta's. The field name `user.phone` (vs the Pixel SDK's `phone_number`) could not be confirmed
  // against an official page; verify it in Events Manager → Test Events at launch.
  const user: Record<string, string> = {};
  const em = hashEmail(event.identity?.email);
  const ph = hashPhone(event.identity?.phone, { e164: true });
  if (em) user.email = em;
  if (ph) user.phone = ph;
  if (event.client?.ip) user.ip = event.client.ip;
  if (event.client?.userAgent) user.user_agent = event.client.userAgent;
  const body: Record<string, unknown> = {
    event_source: "web",
    event_source_id: args.pixelId,
    ...(args.testEventCode ? { test_event_code: args.testEventCode } : {}),
    data: [
      {
        event: "CompletePayment", // TikTok's name for a purchase
        event_time: event.eventTime,
        event_id: event.eventId,
        user,
        ...(event.sourceUrl ? { page: { url: event.sourceUrl } } : {}),
        properties: {
          currency: event.currency,
          value: event.value,
          contents: event.contentIds.map((id) => ({ content_id: id, content_type: "product" })),
        },
      },
    ],
  };
  const res = await post("https://business-api.tiktok.com/open_api/v1.3/event/track/", body, {
    "Access-Token": args.accessToken,
  });
  if ("networkError" in res) return { ok: false, retryable: true, errorCode: "network", errorMessage: sanitize(res.networkError) };
  return tiktokVerdict(res.status, res.text);
}

/** Codes TikTok's own return-code appendix files under rate limiting / "retry may resolve this". */
const TIKTOK_RETRYABLE = new Set([40016, 40100, 40132, 40133, 40202]);

/**
 * TikTok's verdict lives in the BODY, on both 2xx and 4xx.
 *
 * ⚠️ This used to return the HTTP verdict whenever the status was not 2xx, so the body was parsed only
 * on a 200 — and `40132`, the PER-PIXEL QPS limit, arrives with a 4xx. A flash-sale burst therefore
 * dead-lettered every conversion in the window instead of backing off. The blanket
 * "40000–49999 = permanent" rule was wrong for the same reason: that range contains TikTok's rate
 * limits as well as its auth errors.
 */
export function tiktokVerdict(status: number, text: string): SendResult {
  let code: number | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(text) as { code?: number; message?: string };
    if (typeof parsed.code === "number") code = parsed.code;
    message = parsed.message;
  } catch {
    /* non-JSON body — fall back to the HTTP verdict below */
  }
  if (code === undefined) return classify(status, text);
  if (code === 0) return { ok: true, retryable: false };
  // `|| status === 429 || status >= 500` matters: this function REPLACES classify() whenever a body
  // code is present, and classify() is where 429 was handled. Without it a throttle carrying a code
  // outside the allow-list dead-letters — the exact loss this function exists to prevent, reached by a
  // different route.
  const retryable = TIKTOK_RETRYABLE.has(code) || status === 429 || status >= 500;
  return { ok: false, retryable, errorCode: `ttk_${code}`, errorMessage: sanitize(message ?? text) };
}
