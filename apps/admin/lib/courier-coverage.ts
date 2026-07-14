import "server-only";
import { schema } from "@tokophi/db";
import { kaCoverage } from "@tokophi/lib/kiriminaja";
import { SELLER_COURIER_CODES } from "@tokophi/lib/couriers";
import { withCurrentTenant } from "@/lib/tenant";

// ─────────────────────────────────────────────────────────────────────────────
// "Enabled" ≠ "the shopper will see it".
//
// A courier decides availability PER PICKUP ORIGIN, not globally. Measured against the sandbox on
// 2026-07-14: J&T quotes from Jakarta and Yogyakarta origins but NEVER from Gubeng (Surabaya) — to
// ANY destination. So a Surabaya seller can switch J&T on, see a green toggle, and never once have
// it appear at a shopper's checkout. The toggle is not wrong; it is answering a different question
// than the seller is asking.
//
// The fix is to SAY so. This module is the seller surface's single entry point for "does this
// courier actually collect from MY pickup address?" — one thin wrapper the Jasa Kirim card is built
// against, so the screen does not have to care where the answer comes from.
//
// The answer comes from `kaCoverage(originId)` (@tokophi/lib/kiriminaja): it prices ONE representative
// route from the store's pickup district and reports which couriers came back with a rate, cached for
// a day (a live courier call per page render is not a page render). An API outage returns ok:false and
// is NOT cached — because "the API was down" must never be remembered for a day as "this courier does
// not collect from you".
//
// UNKNOWN stays a first-class answer: no pickup address set, or the probe failed → `null`, and the UI
// renders NO coverage state at all rather than a guess. A coverage claim we cannot substantiate is
// worse than none — the entire point of this screen is to stop it lying about what the shopper sees.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * code → true (collects from this store's pickup address) | false (does not).
 * `null` = coverage is UNKNOWN — the caller must render no coverage state at all.
 */
export type CourierCoverage = Record<string, boolean> | null;

export async function courierCoverage(): Promise<CourierCoverage> {
  const origin = await withCurrentTenant(async (db) => {
    const [s] = await db
      .select({ kecamatanId: schema.storeSettings.senderKecamatanId })
      .from(schema.storeSettings)
      .limit(1);
    return s?.kecamatanId ?? null;
  });
  if (!origin) return null; // no pickup address → nothing to probe, and nothing to claim

  const r = await kaCoverage(origin);
  if (!r.ok) return null; // probe failed → unknown, never "not covered"

  const quoted = new Set(r.couriers.map((c) => c.toLowerCase()));
  return Object.fromEntries(SELLER_COURIER_CODES.map((c) => [c, quoted.has(c)]));
}
