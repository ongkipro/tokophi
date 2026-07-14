import "server-only";

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
// ⚠️ THE ANSWER IS "UNKNOWN" TODAY — AND THAT IS DELIBERATE.
// The real answer needs a server-side probe: price one representative route FROM the store's pickup
// district and report which couriers came back with a rate, cached (a live KiriminAja call per page
// render is not a page render). That probe is being built in `@tokophi/lib` and does not exist on
// this branch yet. Until it lands we return `null` = "we do not know", and the UI renders NO badge
// at all rather than a guess. A coverage claim we cannot substantiate is worse than none: the whole
// point of this screen is to stop it lying about what the shopper will see.
//
// TODO(coverage-probe): when `@tokophi/lib/coverage` lands, this becomes:
//     import { probeCourierCoverage } from "@tokophi/lib/coverage";
//     const origin = await senderKecamatanId();           // store_settings.sender_kecamatan_id
//     if (!origin) return null;                            // no pickup address → nothing to probe
//     const quoted = await probeCourierCoverage(origin);   // cached Set<string> of courier codes
//     return Object.fromEntries(SELLER_COURIER_CODES.map((c) => [c, quoted.has(c)]));
// Nothing else in apps/admin needs to change: the card already renders the three states.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * code → true (collects from this store's pickup address) | false (does not).
 * `null` = coverage is UNKNOWN — the caller must render no coverage state at all.
 */
export type CourierCoverage = Record<string, boolean> | null;

export async function courierCoverage(): Promise<CourierCoverage> {
  return null; // unknown — see TODO(coverage-probe) above.
}
