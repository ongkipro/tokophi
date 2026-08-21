import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The URL we hand the payment gateway to call us back on.
 *
 * ⚠️ IT MUST CARRY A CREDENTIAL, BECAUSE PRODUCTION WAS ONCE REJECTING EVERY REAL PAYMENT.
 * `/api/public/pay/callback` fails closed, and `alCreatePayment` sends `callback_url` as a plain
 * string and no headers — so whatever authenticates a genuine AutoLaris callback has to travel in
 * this URL or not at all. All five places that build it (the order API, the merchant's manual bill,
 * the subscription pay action, the billing cron, the super-admin's invoice) go through here, because
 * five copies is how the bare URL shipped in the first place: a shopper pays their VA, AutoLaris
 * POSTs, we answer 401, `payments.status` stays `menunggu` for ever, no ledger row is written, the
 * held conversion is never released, and platform invoices ride the same callback so
 * `stores.current_period_end` stops advancing until the platform suspends its own paying merchants.
 *
 * 🔴 WHAT IS IN THE URL IS NO LONGER THE SHARED SECRET (Task 4.13 / SEC-16, 2026-08-21).
 * It used to be `?token=<AUTOLARIS_CALLBACK_SECRET>` — the whole reusable credential, verbatim, in a
 * query string, minted fresh into every bill. A URL is the worst carrier there is: gateway dashboards,
 * provider-side logs, reverse-proxy access logs, a support screenshot. And the secret is not scoped to
 * one payment: whoever reads one of those URLs can mark ANY payment or ANY subscription invoice on the
 * platform `berhasil`, for ever, until somebody rotates the env var.
 *
 * What goes in now is a **per-payment signature** over the `reff_id` we are about to bill:
 * `?cb=<reff>.<hmac>`. The secret never leaves the container. A leaked URL authorises callbacks for
 * the ONE payment it names and nothing else — the route binds the signed `reff` to the row it
 * resolved, so it cannot be replayed onto a different order. It is deliberately ONE query parameter
 * of a similar length to the token it replaces: the shape AutoLaris is already known to echo back
 * unchanged is the shape we keep.
 *
 * ⚠️ `?token=` is still ACCEPTED by the route, and removing that acceptance is BLOCKED ON THE VENDOR
 * — see the long note at the top of `apps/admin/app/api/public/pay/callback/route.ts`. Nothing here
 * mints one any more, which is the half that is ours to fix.
 */

/** The query parameter carrying `<reff>.<signature>`. One parameter, like the `?token=` it replaces. */
export const PAY_CALLBACK_PARAM = "cb";

/**
 * HMAC-SHA256 over the reference, truncated to 128 bits (32 hex chars).
 *
 * Truncated on purpose: the whole point is a URL AutoLaris echoes back intact, and the credential it
 * replaces was ~40 characters. 128 bits is far past forgeable and keeps the parameter the same order
 * of length. The `pay-callback:v1:` domain tag means this signature can never be confused with any
 * other use of the same secret if one is ever added.
 */
export function signPayCallbackRef(ref: string, secret: string): string {
  return createHmac("sha256", secret).update(`pay-callback:v1:${ref}`).digest("hex").slice(0, 32);
}

export function payCallbackUrl(reffId: string): string {
  const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${base}/api/public/pay/callback`;
  const secret = process.env.AUTOLARIS_CALLBACK_SECRET;
  // No secret = local dev, where the endpoint deliberately accepts an unauthenticated callback so the
  // flow can be exercised offline. A signature over nothing is not a credential, it is a decoration.
  if (!secret) return url;
  if (!reffId) {
    // Every caller has a reference — it is the id they are about to bill under. Reaching here means a
    // new call site forgot it, and the symptom would be a 401 on a real payment, which is exactly the
    // outage this file exists to record. Say so; a bare URL is still better than a signed empty ref.
    console.error("[pay-callback] payCallbackUrl() called with no reffId — the callback will be unauthenticated.");
    return url;
  }
  return `${url}?${PAY_CALLBACK_PARAM}=${encodeURIComponent(`${reffId}.${signPayCallbackRef(reffId, secret)}`)}`;
}

/**
 * Verify `<reff>.<signature>` and return the reference it authorises — never a boolean.
 *
 * The caller MUST bind that reference to the row it resolved. A signature that merely proves "this
 * request came from some URL we minted" is a reusable bearer credential wearing a signature's
 * clothes; the binding is what makes it worth one payment.
 *
 * Split on the LAST dot: a reference is free to contain dots (`requestKey` allows them), a hex
 * signature is not.
 */
export function verifyPayCallbackRef(value: string | null, secret: string | undefined): string | null {
  if (!value || !secret) return null;
  const cut = value.lastIndexOf(".");
  if (cut <= 0 || cut === value.length - 1) return null;
  const ref = value.slice(0, cut);
  const supplied = Buffer.from(value.slice(cut + 1));
  const expected = Buffer.from(signPayCallbackRef(ref, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return ref;
}

/**
 * Compare the credential supplied by AutoLaris with the configured callback secret.
 *
 * Missing configuration fails closed unless a caller explicitly opts into local development mode.
 * The explicit flag keeps the production decision visible at the route boundary and makes the
 * security rule independently testable.
 */
export function verifyPayCallbackSecret(
  provided: string | null,
  expected: string | undefined,
  allowMissing = false,
): boolean {
  if (!expected) return allowMissing;
  if (!provided) return false;

  const supplied = Buffer.from(provided);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

/**
 * AutoLaris reports the principal amount as either a JSON number or a decimal digit string.
 * Reject every other representation and compare as a safe integer so coercion cannot turn an absent,
 * fractional, exponential or otherwise malformed value into a successful payment.
 */
export function payCallbackAmountMatches(provided: unknown, expectedAmountIdr: number): boolean {
  if (!Number.isSafeInteger(expectedAmountIdr) || expectedAmountIdr < 0) return false;

  if (typeof provided === "number") {
    return Number.isSafeInteger(provided) && provided >= 0 && provided === expectedAmountIdr;
  }

  if (typeof provided !== "string" || !/^\d+$/.test(provided)) return false;
  const amount = Number(provided);
  return Number.isSafeInteger(amount) && amount === expectedAmountIdr;
}
