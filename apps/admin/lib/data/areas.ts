import "server-only";
import { db, schema } from "@tokophi/db";
import { or, ilike, eq } from "drizzle-orm";
import { kaAddressByName, kaKelurahan, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";

// The STRUCTURED parts, not just the display string: the storefront checkout uses them to auto-fill
// Kota and Provinsi from the chosen kecamatan, so the shopper types the district once instead of
// re-keying an address the aggregator already knows. There is deliberately no postal code — neither
// `kiriminaja_areas` nor KiriminAja's get_address_by_name carries one, so kodepos stays a manual
// field rather than a guess.
export type Area = {
  id: number;
  text: string;
  district?: string;
  city?: string; // includes the "Kabupaten"/"Kota" prefix, as the shopper would write it
  province?: string;
};

const fmt = (r: { districtName: string; cityType: string | null; cityName: string; provinceName: string }) =>
  `${r.districtName}, ${r.cityType ?? ""} ${r.cityName}, ${r.provinceName}`.replace(/\s+/g, " ").trim();

// Local KiriminAja area search (kecamatan/city name → id) from the imported reference table.
export async function searchAreaLocal(q: string, limit = 8): Promise<Area[]> {
  const term = `%${q.trim()}%`;
  const rows = await db
    .select()
    .from(schema.kiriminajaAreas)
    .where(or(ilike(schema.kiriminajaAreas.districtName, term), ilike(schema.kiriminajaAreas.cityName, term)))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    text: fmt(r),
    district: r.districtName,
    city: `${r.cityType ?? ""} ${r.cityName}`.replace(/\s+/g, " ").trim(),
    province: r.provinceName,
  }));
}

/**
 * Best-effort split of the LIVE API's display string, which has no structured fields — it returns
 * only `{ id, text }`, formatted the same way `fmt()` builds ours ("Kecamatan, Kota X, Provinsi").
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
export async function areaById(districtId: number): Promise<Area | null> {
  if (!Number.isFinite(districtId) || districtId <= 0) return null;
  const [r] = await db
    .select()
    .from(schema.kiriminajaAreas)
    .where(eq(schema.kiriminajaAreas.id, districtId))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    text: fmt(r),
    district: r.districtName,
    city: `${r.cityType ?? ""} ${r.cityName}`.replace(/\s+/g, " ").trim(),
    province: r.provinceName,
  };
}

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

/** A village the courier can actually be BOOKED against: `id` is KiriminAja's own kelurahan id. */
export type KelurahanOption = { id: number | null; name: string; postcode: string };

/**
 * The villages of a district, preferring the ones that carry a bookable id.
 *
 * Two sources, and they are NOT interchangeable:
 *   · KiriminAja `POST /api/mitra/kelurahan` — has the numeric `kelurahan_id` that `request_pickup`
 *     accepts. This is the only source that can produce a BOOKING.
 *   · the local `kelurahan` table (migration 0046, Kemendagri) — keyed by "11.01.01.2001". Fine for
 *     a name and a kodepos; useless to the courier.
 *
 * So KiriminAja wins when it answers, and the local table is the fallback for the ~4% of districts it
 * has no list for (and for when the courier API is down — a checkout must not lose its kodepos field
 * because an upstream is having a bad day). Fallback rows carry `id: null`, deliberately: a null id
 * books a parcel with no village, which is legal. A WRONG id books it to the wrong village, which is
 * not. Never invent one to fill the column.
 */
export async function kelurahanOptions(districtId: number): Promise<KelurahanOption[]> {
  if (!Number.isFinite(districtId) || districtId <= 0) return [];
  if (kiriminajaConfigured()) {
    const live = await kaKelurahan(districtId);
    if (live.length) return live.map((k) => ({ id: k.id, name: k.name, postcode: k.postalCode }));
  }
  const local = await kelurahanForDistrict(districtId);
  return local.map((k) => ({ id: null, name: k.name, postcode: k.postcode }));
}

/**
 * Resolve a CLIENT-SUPPLIED kelurahan id against the district the order is actually going to.
 *
 * The storefront posts a village id. That is a claim, and this is the boundary: an id that does not
 * belong to `districtId` is discarded, not stored. Same rule as the district itself (`areaById`) and
 * for the same reason — the checkout is a form, the API is the truth. A village id from the wrong
 * kecamatan would sail through `request_pickup` and put the parcel somewhere nobody chose.
 *
 * Returns null when it does not verify. Null is a fine outcome: the village is optional to the courier.
 */
export async function verifyKelurahan(
  districtId: number,
  kelurahanId: number | null | undefined,
): Promise<{ id: number; name: string } | null> {
  if (!kelurahanId || !Number.isFinite(kelurahanId) || kelurahanId <= 0) return null;
  if (!kiriminajaConfigured()) return null;
  const list = await kaKelurahan(districtId);
  const hit = list.find((k) => k.id === Number(kelurahanId));
  return hit ? { id: hit.id, name: hit.name } : null;
}
