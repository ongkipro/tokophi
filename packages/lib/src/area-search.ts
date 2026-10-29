// KiriminAja district (kecamatan) lookup over the local `kiriminaja_areas` reference table — ONE
// implementation for every surface that lets a person pick a district: the Seller/checkout path
// (`apps/admin/lib/data/areas.ts`, which adds the live-API fallback) and TokoΦ Account's saved
// addresses (Task 10.8). Reference data, not store-scoped: any connection may read it.
import type { db as DbClient } from "@tokophi/db";
import * as schema from "@tokophi/db/schema";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { likeEscape } from "./like";

type Db = typeof DbClient;

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
export async function searchAreas(db: Db, q: string, limit = 8): Promise<Area[]> {
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


/** The district behind an id, or null — the only validation a picked kecamatan can have. */
export async function areaById(db: Db, districtId: number): Promise<Area | null> {
  if (!Number.isInteger(districtId) || districtId <= 0) return null;
  const [r] = await db.select().from(schema.kiriminajaAreas).where(eq(schema.kiriminajaAreas.id, districtId)).limit(1);
  if (!r) return null;
  return {
    id: r.id,
    text: fmt(r),
    district: r.districtName,
    city: `${r.cityType ?? ""} ${r.cityName}`.replace(/\s+/g, " ").trim(),
    province: r.provinceName,
  };
}
