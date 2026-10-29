import "server-only";
import { pickKelurahan } from "@/lib/kelurahan-pick";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { kaAddressByName } from "@tokophi/lib/kiriminaja";
import { areaById as areaByIdIn, searchAreas, type Area } from "@tokophi/lib/area-search";

// The local search and the id lookup live in `@tokophi/lib/area-search` (one implementation, shared
// with TokoΦ Account's saved addresses); this module adds the live-API fallback and the province gate.
export type { Area };
export const searchAreaLocal = (q: string, limit = 8): Promise<Area[]> => searchAreas(db, q, limit);

/**
 * Best-effort split of the LIVE API's display string, which has no structured fields — it returns
 * only `{ id, text }`, formatted the same way `@tokophi/lib/area-search` builds ours ("Kecamatan, Kota X, Provinsi").
 * Anything that doesn't parse cleanly is left undefined, and the checkout simply doesn't auto-fill
 * for it: a half-parsed address silently written into the form is worse than one the shopper types.
 */
function splitAreaText(a: Area): Area {
  const parts = a.text.split(",").map((s) => s.trim());
  if (parts.length < 3) return a;
  return { ...a, district: parts[0], city: parts[1], province: parts.slice(2).join(", ") };
}

// Resolve an area by name — local table first (instant, no rate limit), live API as fallback.
export async function resolveArea(q: string, limit = 8): Promise<Area[]> {
  if (!q.trim()) return [];
  const local = await searchAreaLocal(q, limit);
  if (local.length) return local;
  return (await kaAddressByName(q)).map((a) => splitAreaText(a));
}

/**
 * The province of a KiriminAja district id — the ONLY province we are willing to trust.
 *
 * The buyer types their province into a free-text field, so `address.provinsi` is a claim, not a
 * fact: a hostile client can send "DKI Jakarta" and have the parcel delivered to Papua, walking
 * straight through platform_cod.allowed_provinces. The district id, by contrast, is the one the
 * ongkir quote was actually issued for and the one the parcel will be booked against — it cannot
 * disagree with where the package goes.
 *
 * Returns null when the id is unknown. Callers gating money (COD) must treat null as "cannot
 * verify" and refuse, never as "probably fine".
 */
/**
 * The kecamatan behind a `dest_id` — the ONLY validation a kecamatan can meaningfully have.
 *
 * The district is PICKED FROM A LIST, so a character rule on the text the shopper sees proves
 * nothing: what matters is that the id resolves to a real KiriminAja district, because that id is
 * what the ongkir was priced against and what the parcel will be booked to. Null = it does not
 * exist → the order API refuses the order rather than write an address nothing can ship to.
 */
export const areaById = (districtId: number): Promise<Area | null> => areaByIdIn(db, districtId);

export async function provinceForDistrict(districtId: number): Promise<string | null> {
  if (!Number.isFinite(districtId) || districtId <= 0) return null;
  const [row] = await db
    .select({ province: schema.kiriminajaAreas.provinceName })
    .from(schema.kiriminajaAreas)
    .where(eq(schema.kiriminajaAreas.id, districtId))
    .limit(1);
  return row?.province ?? null;
}

export type Kelurahan = { name: string; postcode: string };

/**
 * The kelurahan of a KiriminAja district, for the checkout's kodepos auto-fill.
 *
 * Empty list = we have no kelurahan for that district (the Kemendagri dataset could not be matched
 * to it; ~4% of KiriminAja's districts). Callers must treat that as "let the shopper type the
 * kodepos", NOT as "this district has no kelurahan" — the distinction matters because the wrong
 * postal code ends up printed on a real parcel.
 */
export async function kelurahanForDistrict(districtId: number): Promise<Kelurahan[]> {
  if (!Number.isFinite(districtId) || districtId <= 0) return [];
  return db
    .select({ name: schema.kelurahan.name, postcode: schema.kelurahan.postcode })
    .from(schema.kelurahan)
    .where(eq(schema.kelurahan.districtId, districtId))
    .orderBy(schema.kelurahan.name);
}

/** As above, plus KiriminAja's OWN subdistrict id — `null` where we could not match one. */
export type KelurahanWithKaId = Kelurahan & { kaKelurahanId: number | null };

/**
 * The same list, carrying `kelurahan.ka_kelurahan_id` (Task 8.17).
 *
 * ⚠️ A SEPARATE FUNCTION ON PURPOSE — `kelurahanForDistrict` is served to the SHOPPER's browser by
 * `/api/public/ongkir`, and the checkout needs exactly one thing from a kelurahan: its postcode.
 * Publishing the courier id there would put a value into the client that only the server may
 * decide, and the next change to make is always "echo it back in the order body". The vendor id is
 * read on the SELLER's path only, where the id is chosen and stored server-side.
 *
 * `kaKelurahanId === null` is the normal state for part of the table: the name match against
 * `POST /api/mitra/kelurahan` fails for 6,0% of rows — 4 747 of 78 764, measured (see
 * `packages/db/scripts/build-ka-kelurahan-ids.mjs`). NULL means the booking omits the field, which
 * is what it already does today.
 */
/**
 * Resolve the DESTINATION subdistrict a shopper picked at checkout into the pair the order stores
 * (Task 8.17, destination half): the canonical name and KiriminAja's own id.
 *
 * 🔴 THE NAME IS A CLAIM AND THE ID IS NEVER TAKEN FROM THE REQUEST. The checkout's kelurahan
 * control is a picker over OUR OWN list, so the honest check is "does this name exist in the
 * district the ongkir was priced against?" — the same shape as `saveSenderAddress` re-deriving the
 * seller's id, and the same reason: a courier id a client can choose is a courier id a client will
 * eventually choose. Nothing is published to the browser either; `/api/public/ongkir` still serves
 * `kelurahanForDistrict`, which has no id column.
 *
 * MATCHING IS EXACT (case- and space-insensitive), NEVER FUZZY. The populator's 0.82 bigram floor
 * exists to join two datasets that were written by different people; here both sides are this same
 * table, so a near-miss means the value did not come from our list and guessing which village was
 * meant would put a stranger's subdistrict on a real parcel.
 *
 * Returns `null` for "no honest answer" — no name given (the common case: the picker is only shown
 * for the 18% of districts where the postcode is ambiguous), a name that does not resolve, or a row
 * whose `ka_kelurahan_id` we never matched (6,0% of the table). The caller stores NULL for both
 * columns and the booking omits the field, exactly as it always has.
 */
export async function resolveDestinationKelurahan(
  districtId: number,
  name: string | null | undefined,
): Promise<{ name: string; kaKelurahanId: number } | null> {
  // The DECISION is `pickKelurahan` — pure, and therefore tested. This function is the read.
  if (!(name ?? "").trim()) return null; // the common case: skip the query entirely
  if (!Number.isFinite(districtId) || districtId <= 0) return null;
  return pickKelurahan(await kelurahanWithKaIdForDistrict(districtId), name);
}

export async function kelurahanWithKaIdForDistrict(districtId: number): Promise<KelurahanWithKaId[]> {
  if (!Number.isFinite(districtId) || districtId <= 0) return [];
  return db
    .select({
      name: schema.kelurahan.name,
      postcode: schema.kelurahan.postcode,
      kaKelurahanId: schema.kelurahan.kaKelurahanId,
    })
    .from(schema.kelurahan)
    .where(eq(schema.kelurahan.districtId, districtId))
    .orderBy(schema.kelurahan.name);
}
