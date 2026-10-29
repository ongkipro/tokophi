// Every request: cookie → session id → the `buyer_sessions` ROW (spec §17.8 D-5). A cookie whose row
// is revoked, expired or gone is cleared here, so a stale tab signs out instead of half-working.
import { defineMiddleware } from "astro:middleware";
import { db } from "@tokophi/db";
import { loadSession } from "./data/account";
import { ACCOUNT_COOKIE, readAccountSession } from "./lib/session";

export const onRequest = defineMiddleware(async (ctx, next) => {
  const sid = await readAccountSession(ctx.cookies.get(ACCOUNT_COOKIE)?.value);
  const s = sid ? await loadSession(db, sid) : null;
  if (sid && !s) ctx.cookies.delete(ACCOUNT_COOKIE, { path: "/" });
  ctx.locals.account = s?.account ?? null;
  ctx.locals.sessionId = s?.sessionId ?? null;
  const res = await next();
  // Personal pages: never cached, never indexed, never framed, never leaking a URL as Referer.
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
});
