// Obrolan — the shopper side of shopper ⇄ merchant chat (specs/docs/CHAT_SPEC.md §3/§4/§6).
//
// WHY THIS LIVES IN THE STOREFRONT and not in the admin's /api/public/*: the visitor cookie must be
// FIRST-PARTY. `toko.tokophi.com → app.tokophi.com` is cross-site, and merchant custom domains make
// it worse — Safari ITP and Chrome drop that cookie. The existing /api/public/* endpoints get away
// with `Access-Control-Allow-Origin: *` precisely because they are stateless and carry no identity.
// Same reasoning as /api/track.ts.
//
// IDENTITY: an anonymous shopper has no session, so there is no `app.store_id` GUC to set and the
// routes run on the OWNER connection — the deliberate exception RLS allows (like /api/public/order).
// That makes the APPLICATION the isolation boundary here, so the rules are non-negotiable:
//   1. every query filters on BOTH store_id (from the Host-resolved tenant) AND visitor_id (from the
//      signed token),
//   2. a conversation id from the client is NEVER a lookup key — the server RESOLVES the conversation
//      from the token and ignores anything the client says about it,
//   3. the shopper only ever sees {id, sender, body, createdAt} — never sender_user_id, ip_hash,
//      assigned_user_id, or a staff name.
import { SignJWT, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import type { APIContext } from "astro";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");

export const CHAT_COOKIE = "tokophi_chat";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const AUD = "chat-visitor";

export const MAX_BODY = 2000;
export const MAX_NAME = 60;
/** A 4th open thread appends to the newest instead of creating a row (spec §3). */
export const MAX_OPEN_CONVERSATIONS = 3;

export type VisitorToken = { vid: string; sid: string };

/** Mint the visitor cookie. httpOnly ⇒ no localStorage mirror ⇒ no XSS token theft: the widget
 *  never needs to read the id, only the server does. */
export async function mintVisitorCookie(ctx: APIContext, vid: string, sid: string): Promise<void> {
  const token = await new SignJWT({ vid, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(secret);
  ctx.cookies.set(CHAT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Behind Cloudflare/Traefik the node adapter still sees http:// — trust the forwarded proto so
    // the cookie is Secure in prod but still settable over plain http in local dev.
    secure: (ctx.request.headers.get("x-forwarded-proto") ?? ctx.url.protocol.replace(":", "")) === "https",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/** The visitor this request belongs to, or null. `sid` is checked against the Host-resolved store:
 *  a cookie minted on store A is worthless on store B. */
export async function readVisitorToken(ctx: APIContext, storeId: string): Promise<VisitorToken | null> {
  const raw = ctx.cookies.get(CHAT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret, { audience: AUD });
    const { vid, sid } = payload as { vid?: string; sid?: string };
    if (!vid || !sid || sid !== storeId) return null;
    return { vid, sid };
  } catch {
    return null;
  }
}

// Cloudflare first, then the standard forwards, then the socket address (same order as /api/track).
export function clientIp(request: Request, clientAddress: string | undefined): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0] ||
    h.get("x-real-ip") ||
    clientAddress ||
    "unknown"
  ).trim();
}

/** Never the raw IP (PII minimization) — abuse tracking only. */
export function ipHash(ip: string): string {
  return createHash("sha256").update(ip + (process.env.AUTH_SECRET ?? "")).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Fixed-window rate limits. Deliberately NOT `rateLimit` from @tokophi/lib/cache: that module
// starts with `import "server-only"`, a Next-internal alias Rollup cannot resolve in the Astro SSR
// bundle (`astro build` dies) — src/data/cache.ts and src/pages/api/track.ts already re-implement
// for exactly this reason.
//
// PROD: in-memory does not span containers and resets on redeploy — this is a floor, not a wall.
// The wall is a Cloudflare Rate Limiting rule on /api/chat/* (spec §3).
// ---------------------------------------------------------------------------------------------
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return true;
  }
  e.count++;
  return e.count <= limit;
}

export const LIMITS = {
  newConvPerIp: { limit: 1, windowMs: 10 * 60_000 },
  msgPerVisitorMin: { limit: 5, windowMs: 60_000 },
  msgPerVisitorHour: { limit: 60, windowMs: 60 * 60_000 },
  msgPerIpMin: { limit: 20, windowMs: 60_000 },
  pollPerIpMin: { limit: 120, windowMs: 60_000 },
} as const;

// ---------------------------------------------------------------------------------------------
// The wire payload. Shaped as the future SSE `message` event ON PURPOSE (spec §4): upgrading to
// `GET /api/chat/stream` is then a transport swap with no schema, payload or UI change.
// ---------------------------------------------------------------------------------------------
export type WireMessage = { id: string; sender: "customer" | "merchant" | "system"; body: string; createdAt: string };
export type ChatDelta = {
  conversationId: string | null;
  status: "open" | "snoozed" | "closed" | null;
  messages: WireMessage[];
  /** `<iso>,<uuid>` — feed straight back as `?since=`. Null when the thread is empty. */
  cursor: string | null;
  unread: number;
};

/** `(created_at, id)` — `id` breaks the tie so a fast merchant reply inside the same millisecond
 *  can never be skipped. */
// `ts` is returned as an ISO STRING, not a Date: a bare Date bound into a raw `sql` fragment reaches
// postgres.js with no type info and dies in Buffer.byteLength. The ::timestamptz cast at the call
// site is what gives it a type.
export function parseCursor(since: string | null): { ts: string; id: string } | null {
  if (!since) return null;
  const [iso, id] = since.split(",");
  const ts = new Date(iso ?? "");
  if (!id || Number.isNaN(ts.getTime())) return null;
  return { ts: ts.toISOString(), id };
}

export function cursorOf(m: WireMessage[]): string | null {
  const last = m[m.length - 1];
  return last ? `${last.createdAt},${last.id}` : null;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
