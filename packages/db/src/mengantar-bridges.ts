// SHIP-MENGANTAR — the bridge from TokoΦ's KiriminAja area tables to Mengantar's area ids, computed from
// `mengantar_areas` alone (no file). ONE definition, used by:
//   · `load-mengantar-areas.ts` after it upserts a dataset, and
//   · `seed-areas.ts`, which TRUNCATES and reloads `kiriminaja_areas` + `kelurahan` on EVERY deploy
//     (docker-compose.coolify.yml) — wiping the bridge columns. Found 2026-11-12: the first production
//     deploy after the area import left 0 of 7 030 kecamatan bridged, and every Mengantar quote fell back.
// Rules (analysis §3.3–3.5): a bridge is written only on a UNIQUE match; ambiguous rows stay NULL
// (resolved live at checkout); a seller's own origin is never overwritten. Idempotent.
import type { Sql } from "postgres";

export type MgBridgeCounts = { kelByPostcode: number; kelByDistrict: number; kecFromKel: number; kecFromDistrict: number; senders: number };

export async function bridgeMengantarAreas(client: Sql): Promise<MgBridgeCounts> {
  // The SAME naive normaliser the offline feasibility measurement used (analysis §3.3): upper-case,
  // drop bracketed parts and the words KOTA / KABUPATEN / KAB, keep letters and digits only.
  return client.begin(async (tx) => {
    await tx`
      create or replace function pg_temp.mg_norm(t text) returns text language sql immutable as $$
        select regexp_replace(
                 regexp_replace(regexp_replace(upper(coalesce(t, '')), '\\([^)]*\\)', '', 'g'),
                                '\\m(KOTA|KABUPATEN|KAB)\\M', '', 'g'),
                 '[^A-Z0-9]', '', 'g')
      $$`;

    // 2a. kelurahan ← unique (name, postcode).
    const byPostcode = await tx`
      with m as (
        select pg_temp.mg_norm(subdistrict) n, postal_code pc, min(id) id, count(*) c
        from mengantar_areas where postal_code <> '' group by 1, 2
      )
      update kelurahan k set mengantar_area_id = m.id
      from m
      where m.c = 1 and m.n = pg_temp.mg_norm(k.name) and m.pc = k.postcode
        and k.mengantar_area_id is distinct from m.id`;

    // 2b. still-unmatched kelurahan ← unique (name, district, city).
    const byDistrict = await tx`
      with m as (
        select pg_temp.mg_norm(subdistrict) n, pg_temp.mg_norm(district) d, pg_temp.mg_norm(city) cty,
               min(id) id, count(*) c
        from mengantar_areas group by 1, 2, 3
      )
      update kelurahan k set mengantar_area_id = m.id
      from kiriminaja_areas a, m
      where k.district_id = a.id and k.mengantar_area_id is null and m.c = 1
        and m.n = pg_temp.mg_norm(k.name) and m.d = pg_temp.mg_norm(a.district_name)
        and m.cty = pg_temp.mg_norm(a.city_name)`;

    // 3a. kecamatan representative = its first BRIDGED kelurahan (by postcode, then name) — deterministic.
    const repFromKel = await tx`
      update kiriminaja_areas a set mengantar_area_id = r.id
      from (
        select distinct on (k.district_id) k.district_id, k.mengantar_area_id id
        from kelurahan k where k.mengantar_area_id is not null
        order by k.district_id, k.postcode, k.name
      ) r
      where r.district_id = a.id and a.mengantar_area_id is distinct from r.id`;

    // 3b. no bridged kelurahan → the first Mengantar row of the same (district, city), by postcode then name.
    const repFromDistrict = await tx`
      update kiriminaja_areas a set mengantar_area_id = r.id
      from (
        select distinct on (pg_temp.mg_norm(district), pg_temp.mg_norm(city))
               pg_temp.mg_norm(district) d, pg_temp.mg_norm(city) cty, id
        from mengantar_areas
        order by pg_temp.mg_norm(district), pg_temp.mg_norm(city), postal_code, subdistrict
      ) r
      where a.mengantar_area_id is null and r.d = pg_temp.mg_norm(a.district_name) and r.cty = pg_temp.mg_norm(a.city_name)`;

    // 4. Seller origins — only where still empty (a merchant's later choice is never overwritten):
    //    their kelurahan's bridge when known, else their kecamatan's representative.
    const senders = await tx`
      update store_settings s set sender_mengantar_area_id = coalesce(
        (select k.mengantar_area_id from kelurahan k where k.ka_kelurahan_id = s.sender_kelurahan_id and k.mengantar_area_id is not null limit 1),
        (select a.mengantar_area_id from kiriminaja_areas a where a.id = s.sender_kecamatan_id))
      where s.sender_mengantar_area_id is null and s.sender_kecamatan_id is not null`;

    return { kelByPostcode: byPostcode.count, kelByDistrict: byDistrict.count, kecFromKel: repFromKel.count, kecFromDistrict: repFromDistrict.count, senders: senders.count };
  });
}

export const bridgeSummary = (c: MgBridgeCounts) =>
  `bridges: kelurahan +${c.kelByPostcode} by (name, postcode), +${c.kelByDistrict} by (name, district); ` +
  `kecamatan +${c.kecFromKel} from kelurahan, +${c.kecFromDistrict} by (district, city); seller origins +${c.senders}`;
