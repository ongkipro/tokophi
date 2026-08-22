import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * The ONE gate on every first-party maintenance route: five cron sweeps plus `/api/health/env`.
 *
 * 🔴 THE CREDENTIAL TRAVELS IN A HEADER. `?secret=` IS GONE (Task 4.13 / SEC-16, 2026-08-21).
 * Every one of these routes used to read `x-cron-secret` **or** `searchParams.get("secret")`, and all
 * five compose sidecars used the query form — so `CRON_SECRET`, the credential that authorises a
 * state-mutating sweep across EVERY tenant, was written into a URL on every tick. A URL is not a
 * private place: it is in the container's `command`, in `docker inspect`, in `docker top`, in the
 * process table of the host, and in the access log of anything that ever proxies the request. It also
 * reached `recordCronRun` through the same `nextUrl` the route reads `?every=` from.
 *
 * Unlike the payment callback beside it, there is no vendor here. We write the caller AND the
 * endpoint, so the query transport was ours to close, and closing it is the whole point: a fallback
 * that "still works" is the transport everything keeps using. The route no longer looks at the query
 * string for a credential at all — a request that puts one there is refused AND logged, so a caller
 * left behind on the old shape fails loudly instead of authenticating anyway.
 *
 * ⚠️ `?every=` STAYS. It is the sidecar's own cadence, not a credential — `cronIntervalSec` derives
 * the staleness threshold on the Sistem panel from it, which is what stops that panel promising 15
 * minutes about a loop somebody changed to 5. See `app/api/cron/record-run.ts`.
 *
 * ⚠️ FAIL CLOSED IN PRODUCTION. These routes are excluded from the auth middleware and they suspend
 * stores, raise invoices, cancel orders and restore stock. A missing secret must mean NO ENTRY, never
 * NO GATE — the shape `if (secret && provided !== secret)` reads as if it works and was found
 * fail-open here once already. Dev/local still runs without one so the jobs can be exercised offline.
 *
 * One implementation, not six: this check was copy-pasted into six route files, and a copy is exactly
 * how the weaker half of a pair survives a fix (the 24-bit password mint is this repo's own example).
 */
export function cronAuthorized(req: NextRequest, label: string): boolean {
  // Refused, and said out loud. A caller still on `?secret=` would otherwise look like an ordinary
  // 401 — indistinguishable from a wrong secret, on a job whose only symptom is silence.
  if (req.nextUrl.searchParams.has("secret")) {
    console.error(
      `[${label}] a cron credential arrived as a QUERY PARAMETER — refused. Send it as the x-cron-secret header.`,
    );
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[${label}] CRON_SECRET unset in production — REJECTING.`);
      return false;
    }
    return true;
  }

  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;
  const supplied = Buffer.from(provided);
  const configured = Buffer.from(secret);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
