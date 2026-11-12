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
import { bridgeMengantarAreas, bridgeSummary } from "./mengantar-bridges";

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

  console.log(bridgeSummary(await bridgeMengantarAreas(client)));

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
