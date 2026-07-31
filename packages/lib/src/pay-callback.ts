/**
 * The URL we hand the payment gateway to call us back on — WITH the shared secret on it.
 *
 * ⚠️ THIS EXISTS BECAUSE PRODUCTION WAS REJECTING EVERY REAL PAYMENT. `/api/public/pay/callback`
 * authenticates on `x-callback-token` or `?token=`, and it fails closed: with the secret set (which it
 * is on the live stack) a callback carrying neither is a 401. All five places that built this URL —
 * the order API, the merchant's manual bill, the subscription pay action, the billing cron and the
 * super-admin's invoice — built it bare. `alCreatePayment` sends `callback_url` as a plain string and
 * no headers, so there was no other way for the token to travel.
 *
 * The consequence was total and silent: a shopper pays their VA, AutoLaris POSTs, we answer 401, and
 * `payments.status` stays `menunggu` for ever. The order never becomes `dibayar`, no ledger row is
 * written, the held conversion is never released — and because platform invoices ride the same
 * callback, `stores.current_period_end` stops advancing and the platform eventually suspends its own
 * paying merchants. It could not be caught locally: with no secret set, dev returns `true` and the
 * auth path is never exercised.
 *
 * The query-string token is the endpoint's own documented interim scheme, not a new one. When
 * AutoLaris confirms its HMAC signing spec (PROD_PLAN §7) this becomes a signature check and this
 * helper goes away — but there must be exactly ONE builder either way, or the copies drift again.
 */
export function payCallbackUrl(): string {
  const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${base}/api/public/pay/callback`;
  const secret = process.env.AUTOLARIS_CALLBACK_SECRET;
  // No secret = local dev, where the endpoint deliberately accepts an unauthenticated callback so the
  // flow can be exercised offline. Appending an empty token would send `?token=` and fail the compare.
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}
