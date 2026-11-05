// SHIP-MENGANTAR (0116): import Mengantar's area catalogue and fill the bridge columns.
//
//   MENGANTAR_AREAS_FILE=~/Projects/99ribu/data/shipping/mengantar-areas.json.gz \
//     npm run load:mengantar-areas -w @tokophi/db
//
// Source: 99ribu's harvest of GET /address/search (`{ harvested_at, count, areas:[{id, province, city,
// district, subdistrict, postal_code}] }`). 99ribu OWNS that dataset; TokoΦ never harvests, it imports
// one pinned artefact (analysis §3.4). The file is NOT committed here — its redistribution terms are an
// open owner question (R14) — so the path is an explicit input.
//
// Rules (analysis §3.3–3.5):
//   · upsert, never delete — an old order may still name an id a newer harvest dropped;
//   · a bridge is written ONLY on a UNIQUE match; ambiguous and unmatched rows are COUNTED, never guessed;
//   · re-runnable: a second run with the same file changes nothing;
//   · ⚠️ THE SEED IS NOT A MIGRATION — on production this is an explicit, owner-approved step.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { client } from "./client";

type Area = { id: string; province: string; city: string; district: string; subdistrict: string; postal_code?: string };

const file = (process.env.MENGANTAR_AREAS_FILE || process.argv[2] || "").replace(/^~(?=\/)/, homedir());
if (!file) {
  console.error("load-mengantar-areas: set MENGANTAR_AREAS_FILE (or pass the path) to the 99ribu mengantar-areas.json.gz");
  process.exit(2);
}

const raw = readFileSync(file);
const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as {
  harvested_at?: string;
  count?: number;
  areas: Area[];
};
const version = json.harvested_at || "unknown";
const ID = /^[0-9a-f]{24}$/;
const PC = /^[0-9]{5}$/;
const rows = json.areas.filter((a) => ID.test(a.id) && a.province && a.city && a.district && a.subdistrict);
const rejected = json.areas.length - rows.length;

async function main() {
  console.log(`load-mengantar-areas: ${rows.length} valid rows (${rejected} rejected) from ${file} (harvested ${version})`);

  // 1. Upsert in batches of 2 000 — one multi-row statement per batch, no per-row round trip.
  for (let i = 0; i < rows.length; i += 2000) {
    const b = rows.slice(i, i + 2000).map((a) => ({
      id: a.id,
      province: a.province.trim(),
      city: a.city.trim(),
      district: a.district.trim(),
      subdistrict: a.subdistrict.trim(),
      postal_code: PC.test(a.postal_code ?? "") ? a.postal_code! : "",
      dataset_version: version,
    }));
    await client`
      insert into mengantar_areas ${client(b, "id", "province", "city", "district", "subdistrict", "postal_code", "dataset_version")}
      on conflict (id) do update set
        province = excluded.province, city = excluded.city, district = excluded.district,
        subdistrict = excluded.subdistrict, postal_code = excluded.postal_code, dataset_version = excluded.dataset_version
      where (mengantar_areas.province, mengantar_areas.city, mengantar_areas.district, mengantar_areas.subdistrict,
             mengantar_areas.postal_code, mengantar_areas.dataset_version)
        is distinct from (excluded.province, excluded.city, excluded.district, excluded.subdistrict,
             excluded.postal_code, excluded.dataset_version)`;
  }

  // The SAME naive normaliser the offline feasibility measurement used (analysis §3.3): upper-case,
  // drop bracketed parts and the words KOTA / KABUPATEN / KAB, keep letters and digits only.
  await client.begin(async (tx) => {
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

    console.log(
      `bridges: kelurahan +${byPostcode.count} by (name, postcode), +${byDistrict.count} by (name, district); ` +
        `kecamatan +${repFromKel.count} from kelurahan, +${repFromDistrict.count} by (district, city); ` +
        `seller origins +${senders.count}`,
    );
  });

  const [t] = await client`
    select
      (select count(*)::int from mengantar_areas) areas,
      (select count(*)::int from kelurahan) kel,
      (select count(*)::int from kelurahan where mengantar_area_id is not null) kel_matched,
      (select count(*)::int from kiriminaja_areas) kec,
      (select count(*)::int from kiriminaja_areas where mengantar_area_id is not null) kec_matched,
      (select count(*)::int from store_settings where sender_kecamatan_id is not null) senders,
      (select count(*)::int from store_settings where sender_mengantar_area_id is not null) senders_matched`;
  console.log(
    `totals: ${t.areas} Mengantar areas · kelurahan ${t.kel_matched}/${t.kel} bridged (${t.kel - t.kel_matched} unmatched → resolved live at checkout) · ` +
      `kecamatan ${t.kec_matched}/${t.kec} · seller origins ${t.senders_matched}/${t.senders}`,
  );
  await client.end();
}

main().catch(async (e) => {
  console.error("load-mengantar-areas failed:", e instanceof Error ? e.message : e);
  await client.end().catch(() => {});
  process.exit(1);
});
