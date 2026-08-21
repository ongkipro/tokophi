/**
 * THE IMPERSONATION EXCHANGE — the two halves of one handle, in ONE module.
 *
 * 🔴 WHAT THIS REPLACES. "Buka Dashboard Seller" used to mint a **session-shaped JWT** and put it in
 * the query string: `/impersonate?token=<jwt>&slug=<slug>`. Signed with `AUTH_SECRET`, audience
 * `tokophi:impersonate`, two minutes to live — and REUSABLE for every one of those 120 seconds, by
 * anybody holding the string. A URL is the worst possible carrier for a bearer credential: it lands
 * in browser history, in the `Referer` of the next request, in a reverse proxy's access log, in a
 * screen share, and in whatever a support operator pastes into a ticket. Nothing consumed it and
 * nothing could — a JWT is verified, never spent, so replay was not a bug in the route, it was the
 * design.
 *
 * The exchange is now an **opaque handle**: 256 bits of `randomBytes`, meaningless on its own,
 * carrying no claims at all. The FACTS live in a row (`impersonation_grants`) that only the two
 * server processes can read, and the row is spent by a single atomic UPDATE. So:
 *
 *   · **replay** — the second exchange matches zero rows, because `consumed_at` is no longer NULL;
 *   · **tamper** — a changed character is a different SHA-256, i.e. a row that has never existed;
 *   · **expiry** — `expires_at > now()` is inside the same UPDATE, evaluated by Postgres, not by us.
 *
 * All three fail the same way, which is the point: the exchange either matched exactly one live row
 * or it did not, and there is no third answer to get wrong.
 *
 * ⚠️ ONE MODULE BECAUSE TWO APPS SHARE IT. The mint runs in `apps/super-admin`, the spend in
 * `apps/admin`, and they must agree on the hash byte for byte or every exchange silently fails
 * closed — a "nothing happens when I click it" bug with no error anywhere. This repo has already
 * paid for the copy-drift pattern twice (`@tokophi/lib/password`: two mints, one of them 24 bits, on
 * the store-owner path; `session-revocation`: one rule, two revoking surfaces). Same rule here.
 *
 * ⚠️ ONLY THE HASH IS STORED. The plaintext handle exists in the redirect URL and nowhere else, so a
 * dump of `impersonation_grants` hands an attacker nothing to redeem — the same reason a password
 * table stores scrypt output rather than passwords. SHA-256 with no salt/stretching is correct HERE
 * and would not be for a password: the input is already 256 uniformly random bits, so there is no
 * dictionary to run and nothing for a work factor to buy.
 */
import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits. The handle is guessed or it is not — there is no rate limit on the exchange route worth
 * the name (`rateLimit()` is an in-process `Map` that resets on redeploy, AGENTS.md), so entropy is
 * the whole wall. base64url keeps it URL-safe with no escaping: 43 characters, no `=` padding.
 */
export const GRANT_TOKEN_BYTES = 32;

/**
 * How long a minted handle stays redeemable. Two minutes is the operator's click, not a session:
 * the super-admin action returns the URL and the browser opens it immediately. It matches the old
 * JWT's `2m` deliberately — the TTL was never the defect, reusability was.
 */
export const GRANT_TTL_SECONDS = 120;

/**
 * The impersonated merchant session is BOUNDED — 30 minutes, not the merchant's own 7 days.
 * An operator walking into somebody's shop is an intervention with a beginning and an end; a
 * week-long cookie is a standing key. `SESSION_MAX_AGE` (7d) stays what a real merchant login gets.
 *
 * ⚠️ ONE NUMBER, TWO CONSUMERS, AND THEY MUST NOT DRIFT: the cookie's `maxAge` (seconds) and the
 * JWT's own `exp`. A cookie that outlives its token leaves a browser holding a credential every
 * verifier rejects — `middleware.ts` bounces it to `/login`, which is at least honest, but the
 * reverse (token outliving the cookie) would let a copied token be replayed past the window the UI
 * believes it granted. `IMPERSONATION_SESSION_EXPIRY` is derived from the same constant so nobody
 * can edit one of them.
 */
export const IMPERSONATION_SESSION_MAX_AGE = 30 * 60;

/** The jose time-span form of `IMPERSONATION_SESSION_MAX_AGE`. Pinned by a test, not by faith. */
export const IMPERSONATION_SESSION_EXPIRY = `${IMPERSONATION_SESSION_MAX_AGE}s`;

/** A fresh opaque exchange handle. NEVER derived from the merchant, the operator, or the clock. */
export function mintGrantToken(): string {
  return randomBytes(GRANT_TOKEN_BYTES).toString("base64url");
}

/**
 * What the database stores. Both apps call THIS — see the module note on why a second copy of
 * `sha256(token)` would be a silent, total failure rather than a drift.
 */
export function grantTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** When a handle minted `now` stops being redeemable. */
export function grantExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + GRANT_TTL_SECONDS * 1000);
}
