import "server-only";
import { db, schema } from "@tokophi/db";
import { or, ilike, eq, asc, sql } from "drizzle-orm";
import { kaAddressByName } from "@tokophi/lib/kiriminaja";
import { likeEscape } from "@tokophi/lib/like";

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
//
// ⚠️ THE ORDER IS THE FEATURE. This had NO `order by` at all — 7.030 districts, `limit 8`, and
// whatever Postgres felt like returning. Typing "Semarang" put **"Suti Semarang, Kabupaten
// Bengkayang, Kalimantan Barat"** first, above Semarang, Jawa Tengah. A shopper who takes the first
// row — which is what a shopper does — buys a dress with a 13–21 day cargo quote to the wrong island
// and no COD, and nothing on the page says anything is wrong: the quote is real, it is just for
// somewhere they have never been. `dest_id` is the ONE field the whole shipping chain hangs off.
//
// RANKED BY WHAT A PERSON MEANS WHEN THEY TYPE A PLACE NAME, which is usually a CITY.
//
// The obvious ranking — exact district name first — is wrong, and measuring it is the only reason we
// know: "Bandung" then puts *Bandung, Kabupaten Tulungagung* (a village in East Java) above every
// district of Kota Bandung, because that village is literally named "Bandung" while Kota Bandung's
// districts are "Bandung Kidul", "Bandung Kulon", … Same for "Malang" → "Malangbong, Garut".
// Nobody typing "Bandung" means the village.
//
// So an exact CITY match outranks an exact district match, and `Kota` outranks `Kabupaten` within it
// (723 kota vs 6.307 kabupaten — the kota are where the people and the parcels are). Ties break
// alphabetically so the list is stable between keystrokes instead of reshuffling under the finger.
export async function searchAreaLocal(q: string, limit = 8): Promise<Area[]> {
  const raw = q.trim();
  // `%` and `_` are LIKE wildcards. Unescaped, a lone "%" matched all 7.030 rows and returned the
  // first 8 arbitrarily — parameterised, so never injection, but a search that answers nonsense.
  const lit = likeEscape(raw);
  const term = `%${lit}%`;
  const prefix = `${lit}%`;
  const rows = await db
    .select()
    .from(schema.kiriminajaAreas)
    .where(or(ilike(schema.kiriminajaAreas.districtName, term), ilike(schema.kiriminajaAreas.cityName, term)))
    .orderBy(
      sql`case
        when lower(${schema.kiriminajaAreas.cityName}) = lower(${raw})
             and ${schema.kiriminajaAreas.cityType} = 'Kota' then 0
        when lower(${schema.kiriminajaAreas.cityName}) = lower(${raw}) then 1
        when lower(${schema.kiriminajaAreas.districtName}) = lower(${raw}) then 2
        when ${schema.kiriminajaAreas.districtName} ilike ${prefix} then 3
        when ${schema.kiriminajaAreas.cityName} ilike ${prefix} then 4
        when ${schema.kiriminajaAreas.districtName} ilike ${term} then 5
        else 6
      end`,
      asc(schema.kiriminajaAreas.districtName),
    )
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
