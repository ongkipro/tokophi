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
  const lines = text.split("\n").slice(1); // drop header

  const rows: (typeof schema.kiriminajaAreas.$inferInsert)[] = [];
  for (const line of lines) {
    const f = line.split(",");
    if (f.length < 7) continue; // guard against a stray comma in a name
    const id = Number(f[0]);
    if (!Number.isFinite(id)) continue;
    rows.push({
      id,
      districtName: f[1].trim(),
      cityId: Number(f[2]) || null,
      cityType: f[3]?.trim() || null,
      cityName: f[4].trim(),
      provinceId: Number(f[5]) || null,
      provinceName: f.slice(6).join(",").trim(),
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
    // name is quoted (it may in principle contain a comma); the other three fields never are.
    const m = /^([^,]+),(\d+),"((?:[^"]|"")*)",(\d+)$/.exec(line);
    if (!m) continue;
    rows.push({
      id: m[1],
      districtId: Number(m[2]),
      name: m[3].replaceAll('""', '"'),
      postcode: m[4],
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
