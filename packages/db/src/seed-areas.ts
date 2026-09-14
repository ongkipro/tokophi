// One-time import of the KiriminAja district (kecamatan) map into `kiriminaja_areas`.
// Static reference data (~7k rows) — NOT wiped by the demo reseed. Run:
//   npm run seed:areas -w @tokophi/db
import { db, client, schema } from "./client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

async function main() {
  const csvPath = join(dirname(fileURLToPath(import.meta.url)), "../data/kiriminaja-areas.csv");
  const text = readFileSync(csvPath, "utf8").trim();
  const [header, ...lines] = text.split("\n");
  // `lat,lng` are the LAST two columns when present (0109, scripts/build-area-coords.mjs); the
  // province name is everything between the 6th comma and them. Header-driven so a CSV predating
  // the columns still loads.
  const coords = header.split(",").includes("lat");

  const rows: (typeof schema.kiriminajaAreas.$inferInsert)[] = [];
  for (const line of lines) {
    const f = line.split(",");
    if (f.length < 7) continue; // guard against a stray comma in a name
    const id = Number(f[0]);
    if (!Number.isFinite(id)) continue;
    const base = coords ? f.slice(0, -2) : f;
    rows.push({
      id,
      districtName: base[1].trim(),
      cityId: Number(base[2]) || null,
      cityType: base[3]?.trim() || null,
      cityName: base[4].trim(),
      provinceId: Number(base[5]) || null,
      provinceName: base.slice(6).join(",").trim(),
      // Empty ⇒ NULL, never 0: 0,0 is a real point (Gulf of Guinea), NULL means "unknown, omit".
      lat: coords && f[f.length - 2] ? Number(f[f.length - 2]) : null,
      lng: coords && f[f.length - 1] ? Number(f[f.length - 1]) : null,
    });
  }

  // `kelurahan` FKs into this table, so it has to go first — and both are truncated together, or a
  // reload would leave kelurahan rows pointing at district ids that no longer exist.
  await client.unsafe(`truncate "kiriminaja_areas", "kelurahan"`);
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(schema.kiriminajaAreas).values(rows.slice(i, i + BATCH));
  }
  console.log(`Seeded ${rows.length} KiriminAja areas (${new Set(rows.map((r) => r.provinceName)).size} provinces).`);

  await seedKelurahan();
  await client.end();
}

// Kelurahan → kodepos (see scripts/build-kelurahan.mjs for where the CSV comes from and why this
// level exists at all: a kodepos cannot be derived from a kecamatan).
async function seedKelurahan() {
  const csvPath = join(dirname(fileURLToPath(import.meta.url)), "../data/kelurahan.csv");
  const lines = readFileSync(csvPath, "utf8").trim().split("\n").slice(1);

  const rows: (typeof schema.kelurahan.$inferInsert)[] = [];
  for (const line of lines) {
    // name is quoted (it may in principle contain a comma); the other fields never are. The 5th
    // field — KiriminAja's own subdistrict id (Task 8.17) — is OPTIONAL in the pattern and may be
    // empty: it is filled by scripts/build-ka-kelurahan-ids.mjs and 6,0% of rows (4 747 of
    // 78 764) never match a vendor name. Optional rather than required so a CSV predating that
    // column still loads.
    // The 6th/7th — the village centroid (0109) — are optional the same way and for the same
    // reason; empty ⇒ NULL, and the booking then falls back to the district centroid or omits.
    const m = /^([^,]+),(\d+),"((?:[^"]|"")*)",(\d+)(?:,(\d*))?(?:,(-?[\d.]*),(-?[\d.]*))?$/.exec(line);
    if (!m) continue;
    rows.push({
      id: m[1],
      districtId: Number(m[2]),
      name: m[3].replaceAll('""', '"'),
      postcode: m[4],
      // Empty column ⇒ NULL, never 0. Zero is a subdistrict id to a courier; NULL is "we do not
      // know", and the booking then omits the field.
      kaKelurahanId: m[5] ? Number(m[5]) : null,
      lat: m[6] ? Number(m[6]) : null,
      lng: m[7] ? Number(m[7]) : null,
    });
  }

  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(schema.kelurahan).values(rows.slice(i, i + BATCH));
  }
  const districts = new Set(rows.map((r) => r.districtId)).size;
  console.log(`Seeded ${rows.length} kelurahan across ${districts} districts.`);
}

main();
