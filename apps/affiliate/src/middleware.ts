// Every request: cookie → sha256 → the `affiliate_sessions` ROW (ADR 0022). A cookie whose row is
// revoked, expired or gone is cleared here, so a stale tab signs out instead of half-working.
// While the area is CLOSED (`AFFILIATE_APP_URL` unset — `lib/availability.ts`) every path is rewritten to
// the one "belum dibuka" page BEFORE any cookie or database read.
import { defineMiddleware } from "astro:middleware";
import { db } from "@tokophi/db";
import { loadSession } from "./data/auth";
import { closedRewrite } from "./lib/availability";
import { AFFILIATE_COOKIE } from "./lib/session";

/** Personal pages: never cached, never indexed, never framed, never leaking a URL as Referer (an
 *  invitation link carries a token in its query string). */
function privateHeaders(res: Response): Response {
  try {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    // An immutable Response (e.g. Response.redirect) — nothing personal in it.
  }
  return res;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.account = null;
  ctx.locals.sessionId = null;
  const closed = closedRewrite(ctx.url.pathname);
  if (closed) return privateHeaders(await next(closed));
  const token = ctx.cookies.get(AFFILIATE_COOKIE)?.value;
  const s = token ? await loadSession(db, token) : null;
  if (token && !s) ctx.cookies.delete(AFFILIATE_COOKIE, { path: "/" });
  ctx.locals.account = s?.account ?? null;
  ctx.locals.sessionId = s?.sessionId ?? null;
  return privateHeaders(await next());
});
