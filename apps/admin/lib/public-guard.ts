import { NextResponse } from "next/server";
import { rateLimit } from "@tokophi/lib/cache";

// client IP from common proxy headers (Cloudflare first, then standard forwards)
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
}

// Per-IP fixed-window rate limit for public (no-auth) endpoints. Returns a 429 response if the
// caller is over the limit, else null. PROD: front this with Cloudflare Rate Limiting at the edge.
export function rateLimited(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
  cors: Record<string, string>,
): NextResponse | null {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." },
    { status: 429, headers: { ...cors, "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
  );
}

// ── THE SIZE OF WHAT A STRANGER MAY POST ────────────────────────────────────────────────────────
//
// Every route under `app/api/public/` is unauthenticated by necessity — a shopper has no session.
// The rate limit above bounds HOW OFTEN one IP may call; nothing bounded HOW BIG each call is, and
// the two are not the same gate. Measured on this branch, 2026-08-05, against a local dev server:
//
//   · `/api/public/order` with **10.000 `items[]`** → **50.498 index scans, 63,8 s** of wall clock
//     in ONE request, from a 630 KB body — the per-item loop is 4 sequential DB round-trips and
//     nothing capped the array. It never reaches the courier API or a write; it just spends the
//     database. At the route's own 10/min/IP that is ~640 s of server time per minute, per IP.
//   · a **64 MB** JSON body was accepted, buffered and parsed in 0,8 s. `req.json()` has no size
//     limit in a Route Handler (the old `bodyParser` 1 MB default is Pages Router only), so the
//     ceiling was the container's heap.
//
// `checkout-session.ts` — which merely RECORDS a cart — has capped its array at 50 since it
// shipped. The endpoint that takes the MONEY had no cap at all.
//
// Both caps are deliberately generous, because in this repo a rule that refuses a real customer is
// a bug equal to the hole it closes: 100 cart lines is already an extreme wholesale order (400 DB
// round-trips, ~1,2 s), and a 100-line request weighs ~12 KB — 20× under the byte cap.

/** Largest JSON body a public endpoint will read. ~20× a 100-line cart; 250× an ordinary one. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Largest `items[]` a public endpoint will price. Per LINE, not per unit — qty is bounded by stock. */
export const MAX_CART_ITEMS = 100;

class BodyTooLarge extends Error {}

/**
 * Read a public request's body with a hard byte ceiling.
 *
 * Returns the raw TEXT, not the parsed object, so each route keeps its own Bahasa message for a
 * malformed body (they differ, and the shopper reads them).
 *
 * The `Content-Length` header is only the fast path — a chunked request can lie or omit it, so the
 * stream itself is counted and cancelled the moment it passes the cap. Buffering first and checking
 * the length afterwards is the bug being closed, not a fix for it.
 */
export async function readPublicBody(
  req: Request,
  cors: Record<string, string>,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ text: string; res?: undefined } | { text?: undefined; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { res: tooLarge(cors) };
  try {
    return { text: await readCapped(req, maxBytes) };
  } catch (err) {
    if (err instanceof BodyTooLarge) return { res: tooLarge(cors) };
    throw err;
  }
}

function tooLarge(cors: Record<string, string>): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Permintaan terlalu besar." },
    { status: 413, headers: cors },
  );
}

async function readCapped(req: Request, maxBytes: number): Promise<string> {
  const stream = req.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > maxBytes) throw new BodyTooLarge();
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    // Stop the sender rather than draining the rest of a 64 MB upload into a socket nobody reads.
    reader.cancel().catch(() => {});
  }
  return out + decoder.decode();
}

/**
 * The message a SHOPPER is given when the courier aggregator itself refuses the quote.
 *
 * ⚠️ ADR 0004: the provider's brand — and its voice — stay hidden from merchants and shoppers.
 * `kaShippingPrice` returns KiriminAja's `text` field verbatim, and it reached the checkout screen:
 * measured live on 2026-08-05, `/api/public/order` answered
 *   `{"ok":false,"error":"kurir nosuchcourier tidak terdaftar di sistem kami","field":"shipping"}`
 * — a third party speaking in the FIRST PERSON ("our system") on the merchant's own checkout — and
 * with a bad platform key the same field reads `"Unauthorized."`, an English internal auth failure
 * shown to an Indonesian shopper as the reason their order did not go through. Neither string
 * happens to spell "KiriminAja", but the text is unbounded and provider-controlled, so nothing
 * kept the next one from doing so.
 *
 * Nothing is lost by replacing it: a route the courier genuinely does not serve comes back as
 * `status:true` with an EMPTY rate list (measured — district 999999999 returned `rates: []`), so
 * the error path is exclusively OUR side failing, which no shopper can act on. The provider's own
 * words go to the server log, where the person who can act on them will read them.
 */
export const SHIPPING_QUOTE_UNAVAILABLE =
  "Ongkir untuk rute ini sedang tidak bisa dihitung. Coba lagi sebentar atau pilih alamat lain.";
