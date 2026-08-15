// First-party analytics ingest — the ONLY writer of `analytics_events` besides the seed.
//
// Why it lives in the STOREFRONT (and not in the admin's /api/public/*): the request must be
// same-origin with the page that fires it. Merchants get their own subdomain today and custom
// domains later, so a cross-origin call would need CORS + would be eaten by tracking blockers and
// third-party-cookie/`keepalive` restrictions. Same reasoning as the planned chat API
// (specs/docs/CHAT_SPEC.md).
//
// The store is resolved from the `Host` header by src/middleware.ts (Astro.locals.store) — a
// store_id sent by the client is NEVER trusted, so one merchant's page cannot write events into
// another merchant's funnel.
//
// Reads land in apps/admin/lib/data/funnel.ts (getFunnelDaily / getDeviceDaily → /analitik).
//
// ABUSE: this endpoint is unauthenticated by necessity (a shopper has no session), and everything
// it writes is a business metric — funnel, conversion rate, device split. Left open, a `for` loop
// of curls can make any store's dashboard say whatever it likes. Two gates below: a per-IP rate
// limit and an obvious-bot filter. Both fail QUIET (204): a rejected event must never surface as
// an error in the shop (see components/Analytics.astro — the client ignores the response anyway,
// but checkout must not even see a failed request).
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";

// The exact contract — anything else is rejected (funnel.ts FUNNEL_STEPS depends on these strings).
const TYPES = new Set(["visit", "product_view", "add_to_cart", "checkout_start", "purchase"]);
const DEVICES = new Set(["ponsel", "desktop", "tablet"]);

// ---------------------------------------------------------------------------------------------
// Per-IP fixed-window rate limit.
//
// Deliberately NOT `rateLimit` from @tokophi/lib/cache, even though the algorithm is identical:
// that module starts with `import "server-only"`, which is a Next-internal alias with no package
// behind it, so Rollup cannot resolve it in the Astro SSR bundle ("[vite]: Rollup failed to
// resolve import 'server-only'" — `astro build` dies). src/data/cache.ts already re-implements
// `cached` for exactly this reason; same trade-off, same contract.
//
// PROD SWAP: Cloudflare Rate Limiting at the edge (PROD_PLAN §3) — in-memory does not share across
// storefront instances, so this is a floor, not a wall.
// ---------------------------------------------------------------------------------------------
const LIMIT = 30; // events per IP per window — a real session fires a handful (visit + a few views)
const WINDOW_MS = 60_000;

const hits = new Map<string, { count: number; reset: number }>();

function rateLimit(key: string, limit = LIMIT, windowMs = WINDOW_MS): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    // opportunistic sweep so the Map can't grow unbounded in a long-lived SSR process
    if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return true;
  }
  e.count++;
  return e.count <= limit;
}

// Cloudflare first, then the standard forwards, then the socket address the node adapter gives us.
function clientIp(request: Request, clientAddress: string | undefined): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0] ||
    h.get("x-real-ip") ||
    clientAddress ||
    "unknown"
  ).trim();
}

// Obvious bots. Not a security control (a UA is trivially forged — the rate limit is what costs an
// attacker something); this keeps HONEST crawlers, previewers and uptime pingers out of the funnel,
// where they would otherwise show up as shoppers who never buy and quietly depress conversion.
const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|whatsapp|telegram|discord|skype|vkshare|w3c_validator|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|semrush|ahrefs|mj12|dotbot|petal|yandex|baidu|sogou|headless|phantomjs|puppeteer|playwright|selenium|scrapy|python-requests|python-urllib|curl\/|wget|libwww|okhttp|go-http-client|java\/|apache-httpclient|axios\/|node-fetch|got\/|postman|insomnia/i;

function isBot(ua: string): boolean {
  // Empty UA = not a browser. Every real browser sends one, including sendBeacon.
  if (!ua.trim()) return true;
  return BOT_UA.test(ua);
}

// Dropped events are QUIET (204, empty): the shop must not see an error it could surface. The
// `x-track` header is for us (curl -D-) and for ops, not for the page — the client never reads it.
const noContent = (reason: "ok" | "bot" | "rate-limited" = "ok") =>
  new Response(null, { status: 204, headers: { "x-track": reason } });
// A malformed body is a BUG in our own client, not abuse — keep it loud (unchanged contract).
const bad = (error: string) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const store = locals.store;
  if (!store) return bad("unknown store");

  // 1) Bots never become shoppers. Cheapest check → runs first, before we read the body.
  if (isBot(request.headers.get("user-agent") ?? "")) return noContent("bot");

  // 2) Per-IP budget. A hammering script burns its window and stops counting.
  if (!rateLimit(`track:${clientIp(request, clientAddress)}`)) return noContent("rate-limited");

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 65_536) return bad("payload too large");

  // sendBeacon posts a Blob — parse the body by hand rather than trusting the content-type.
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return bad("payload too large");
    body = JSON.parse(raw);
  } catch {
    return bad("invalid json");
  }
  if (!body || typeof body !== "object") return bad("invalid body");

  const { type, sessionId, device } = body as Record<string, unknown>;
  if (typeof type !== "string" || !TYPES.has(type)) return bad("unknown event type");

  const session = typeof sessionId === "string" ? sessionId.slice(0, 64) : null;
  const dev = typeof device === "string" && DEVICES.has(device) ? device : null;

  // Fire-and-forget from the client's point of view: a DB hiccup must never surface in the shop
  // (checkout in particular), so failures are swallowed into a 204.
  try {
    await db.insert(schema.analyticsEvents).values({
      storeId: store.id,
      type,
      sessionId: session,
      device: dev,
    });
  } catch (err) {
    console.error("[track] insert failed", err);
  }
  return noContent("ok");
};

// A GET here is always a mistake (or a crawler) — never log an event for it.
export const GET: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
