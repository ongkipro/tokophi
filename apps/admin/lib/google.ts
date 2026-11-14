import "server-only";

// Google Sign-In for the Seller panel. The flow itself lives in `@tokophi/lib/google-oauth` since
// BUYER-ACCOUNT-P1, because apps/account (the TokoΦ Account, ADR 0016) signs buyers in with the SAME
// Google client and its own redirect URI. This file keeps the `server-only` marker the shared package
// cannot carry (it also serves Astro) — `googleConfig()` returns the client secret.
// Feature-flagged: with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI unset the
// button is hidden and the routes redirect to /login — nothing crashes.
export {
  OAUTH_STATE_COOKIE,
  authorizeUrl,
  exchangeCode,
  googleConfig,
  googleEnabled,
  type GoogleConfig,
  type GoogleProfile,
} from "@tokophi/lib/google-oauth";

/**
 * ADR 0019: the signup code (+ whether the Mengantar consent was on screen for it) between the Google start
 * and callback routes, as `<CODE>.<0|1>`. httpOnly, 10 min, set only on `mode=daftar`. Not a secret and not
 * an identity — `provisionStore` re-validates the code against `signup_codes` like the form path.
 */
export const OAUTH_SIGNUP_CODE_COOKIE = "g_oauth_signup";
