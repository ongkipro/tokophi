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

  await client.unsafe(`truncate "kiriminaja_areas"`);
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(schema.kiriminajaAreas).values(rows.slice(i, i + BATCH));
  }
  console.log(`Seeded ${rows.length} KiriminAja areas (${new Set(rows.map((r) => r.provinceName)).size} provinces).`);
  await client.end();
}
main();
