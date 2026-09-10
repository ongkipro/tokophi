// The DECISION half of "which subdistrict did the shopper pick?" — PURE, no database import, so it
// can be driven by a test (the same split as `platform-rank.ts` and `platform-session.ts`, and for
// the same reason: `lib/data/areas.ts` pulls `@tokophi/db` at module scope).
//
// Task 8.17, destination half. The checkout posts a subdistrict NAME chosen from a picker over our
// own list; the order stores KiriminAja's own id for it. Everything about that conversion that can
// be wrong is in here.

/** One row of a district's subdistrict list, as `kelurahanWithKaIdForDistrict` returns it. */
export type KelurahanRow = { name: string; kaKelurahanId: number | null };

/** Case- and space-insensitive. Both sides go through it, so neither side can be the odd one out. */
function key(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The village the shopper named, or `null` when there is no honest answer.
 *
 * 🔴 EXACT, NEVER FUZZY. The populator that filled `ka_kelurahan_id` uses a 0.82 bigram floor
 * because it joins two datasets written by different people. Here both sides are the SAME table —
 * the picker was rendered from it — so a near-miss does not mean "a typo we can recover", it means
 * the value did not come from our list. Guessing which village was meant puts a stranger's
 * subdistrict on a real parcel, which is the whole defect this task exists to prevent.
 *
 * 🔴 BOTH OR NEITHER. A row whose `kaKelurahanId` is null is NOT a match: the pair is the point, and
 * a name stored without an id reads as "the subdistrict is known" on every screen while the booking
 * still omits the field. 6,0% of the table has no vendor id (4 747 of 78 764, measured).
 *
 * `null` is the ordinary outcome, not a failure: the checkout only shows this picker where the
 * district's postcode is ambiguous, so most orders name no village at all.
 */
export function pickKelurahan(
  rows: readonly KelurahanRow[],
  name: string | null | undefined,
): { name: string; kaKelurahanId: number } | null {
  const wanted = key(name ?? "");
  if (!wanted) return null;
  const hit = rows.find((r) => key(r.name) === wanted);
  if (!hit || hit.kaKelurahanId === null) return null;
  return { name: hit.name, kaKelurahanId: hit.kaKelurahanId };
}
