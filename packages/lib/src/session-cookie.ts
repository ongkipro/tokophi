/**
 * THE OPTIONS EVERY SESSION-BEARING COOKIE IN THIS PRODUCT IS SET WITH — one implementation.
 *
 * Seven call sites wrote this object by hand and **not one of them set `secure`**: the merchant's
 * login, signup, Google callback, password re-mint and impersonation exchange, plus BOTH of the
 * super-admin's (operator login and operator password re-mint). Measured 2026-08-05: no host in this
 * product sends `Strict-Transport-Security` either, so `http://app.tokophi.com/` is a plain
 * Cloudflare 301 — and the browser has already attached the 7-day token to that cleartext request
 * before the redirect can help. An on-path observer reads a live session.
 *
 * ⚠️ THE RULE WAS ALREADY KNOWN HERE, TWICE, AND THE SESSION COOKIE WAS THE ONE THAT MISSED IT.
 * `app/api/auth/google/start/route.ts` has always set `secure` on the OAuth **state** cookie (a
 * 10-minute CSRF nonce), and `apps/storefront/src/lib/chat.ts` sets it on the visitor cookie with a
 * comment explaining the proxy. So the flimsy cookie in the OAuth handshake was protected while the
 * credential it is exchanged for was not. That is exactly the shape this repo keeps paying for — a
 * rule re-obeyed by hand at every call site is a rule that will be missed at one of them — so it is
 * a module now, not a convention.
 *
 * `NODE_ENV === "production"` is the same expression `google/start` already uses, and it is correct
 * here rather than merely convenient: every `tokophi.com` record must stay Cloudflare-proxied
 * (DEPLOY.md — the wildcard runs a Cloudflare Origin CA cert), so production is HTTPS-only by
 * construction. Verified on the running containers 2026-08-05: admin, super-admin and storefront all
 * report `NODE_ENV=production`.
 *
 * ⚠️ Known papercut, deliberate: a PRODUCTION BUILD run locally over `http://localhost` also scores
 * `true`. Chrome and Firefox treat `http://localhost` as a trustworthy origin and store the cookie
 * anyway, so the repo's own verification loop (Playwright, `{ channel: "chrome" }`) is unaffected;
 * Safari historically does not. If that ever bites, `chat.ts` has the stricter variant — decide from
 * `x-forwarded-proto` — and it needs a request object, which is why it is not the default here.
 */
export const SECURE_COOKIES = process.env.NODE_ENV === "production";

/**
 * `maxAge` stays a parameter: the merchant's `SESSION_MAX_AGE` and the operator's are separate
 * 7-day constants in separate apps, and collapsing them here would quietly couple two lifetimes
 * that are allowed to diverge. Everything that is a SECURITY flag is fixed.
 */
export const sessionCookieOptions = (maxAge: number) =>
  ({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: SECURE_COOKIES,
  }) as const;
