// Adds a CENTROID (lat, lng) to `packages/db/data/kelurahan.csv` and `packages/db/data/kiriminaja-areas.csv`.
//
// WHY. `POST /api/mitra/v6.2/request_pickup` marks `latitude`/`longitude` (sender) and
// `destination_latitude`/`destination_longitude` (every package) REQUIRED, and KiriminAja's UAT
// review of 2026-09-14 rejected a payload without them as "still v6.1". Nothing in this product
// geocodes anything: a shopper types a street, a WhatsApp number, a kecamatan and (where the kodepos
// is ambiguous) a kelurahan. That is enough for a REGULAR courier — the pricing response itself says
// `use_geolocation: false` for SPX/JNE/… — so the honest coordinate for an address is the centroid
// of the smallest administrative area we know it is in: the kelurahan when the checkout asked for
// one, else the kecamatan. NEVER `0,0` (a point in the Gulf of Guinea a dispatcher would route on)
// and never a street-level geocode we do not have.
//
// Source (public, MIT, Kemendagri-derived — re-run this script to refresh):
//   · https://github.com/cahyadsn/wilayah_boundaries → db/kec/*.sql, db/kel/<prov>/*.sql
//     rows: ('<kode>','<nama>',<lat>,<lng>,'<polygon path>',<status>)
// The polygon is discarded; only the centroid the dataset already computed is kept. The dataset is
// keyed by the SAME Kemendagri codes `kelurahan.id` carries (that join is why the kelurahan table
// exists at all — see build-kelurahan.mjs), so a kelurahan centroid is an exact key match.
// A KiriminAja DISTRICT has no Kemendagri code of its own; its centroid is the kecamatan the
// majority of its kelurahan rows belong to (their codes' first 8 characters). A district with no
// kelurahan rows (~4%, unmatched in build-kelurahan.mjs) gets no centroid and the booking then
// omits the fields — "the shopper's district is unknown to the dataset" degrades to the exact
// pre-coordinate payload, never to a guess.
//
// Run: node packages/db/scripts/build-area-coords.mjs        (≈ 12 MB kec + ≈ 300 MB kel download)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = join(DIR, "../data");
const RAW = "https://raw.githubusercontent.com/cahyadsn/wilayah_boundaries/main/db";

// ('34.02.07','Pajangan',-7.8706,110.2875,'[[[ …   — the path is longtext; stop before it.
const ROW = /\('([\d.]+)',\s*'(?:[^']|'')*',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/g;

// Indonesia's bounding box, generously. Anything outside is a dataset defect, not a place a parcel
// goes; it is dropped here so the sink guard in @tokophi/lib/kiriminaja never sees it.
const inIndonesia = (lat, lng) => lat >= -11.5 && lat <= 6.5 && lng >= 94.5 && lng <= 141.5;

async function fetchText(url) {
  const res = await fetch(url);
  if (res.status === 404) return null; // a kabupaten with no boundaries file — leave its rows NULL
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** kode → [lat, lng] from one dataset file (or nothing for a missing file). */
async function centroids(url) {
  const sql = await fetchText(url);
  const out = new Map();
  if (!sql) return out;
  for (const m of sql.matchAll(ROW)) {
    const lat = Number(m[2]);
    const lng = Number(m[3]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && inIndonesia(lat, lng)) out.set(m[1], [lat, lng]);
  }
  return out;
}

/** Bounded concurrency — GitHub's raw host is fine with a handful in flight, not five hundred. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

const fmt = (n) => (n === undefined ? "" : String(Math.round(n * 1e6) / 1e6)); // 6 dp ≈ 0,1 m

// ── kelurahan.csv ────────────────────────────────────────────────────────────────────────────────
const kelLines = readFileSync(join(DATA, "kelurahan.csv"), "utf8").trim().split("\n");
const kelHeader = kelLines[0].split(",");
const hasCoords = kelHeader.includes("lat");
const KEL = /^([^,]+),(\d+),"((?:[^"]|"")*)",(\d+)(?:,(\d*))?(?:,(-?[\d.]*),(-?[\d.]*))?$/;
const kel = [];
for (const line of kelLines.slice(1)) {
  const m = KEL.exec(line);
  if (!m) continue;
  kel.push({ code: m[1], districtId: Number(m[2]), nameQuoted: m[3], postcode: m[4], kaId: m[5] ?? "" });
}
console.log(`kelurahan.csv: ${kel.length} baris${hasCoords ? " (sudah punya kolom lat/lng — ditimpa)" : ""}`);

const kabupaten = [...new Set(kel.map((r) => r.code.slice(0, 5)))].sort();
console.log(`Mengunduh centroid ${kabupaten.length} kabupaten/kota + kecamatan per provinsi…`);
const kelMaps = await mapLimit(kabupaten, 6, async (kab, i) => {
  const m = await centroids(`${RAW}/kel/${kab.slice(0, 2)}/wilayah_boundaries_kel_${kab}.sql`);
  if ((i + 1) % 50 === 0) console.log(`  kelurahan ${i + 1}/${kabupaten.length}`);
  return m;
});
const kelCoord = new Map();
for (const m of kelMaps) for (const [k, v] of m) kelCoord.set(k, v);

const provinces = [...new Set(kabupaten.map((k) => k.slice(0, 2)))];
const kecMaps = await mapLimit(provinces, 6, (p) => centroids(`${RAW}/kec/wilayah_boundaries_kec_${p}.sql`));
const kecCoord = new Map();
for (const m of kecMaps) for (const [k, v] of m) kecCoord.set(k, v);

let kelHit = 0;
const kelOut = ["code,ka_district_id,name,postcode,ka_kelurahan_id,lat,lng"];
for (const r of kel) {
  const c = kelCoord.get(r.code);
  if (c) kelHit++;
  kelOut.push(`${r.code},${r.districtId},"${r.nameQuoted}",${r.postcode},${r.kaId},${fmt(c?.[0])},${fmt(c?.[1])}`);
}
writeFileSync(join(DATA, "kelurahan.csv"), kelOut.join("\n") + "\n");
console.log(`kelurahan: ${kelHit}/${kel.length} punya centroid (${((100 * kelHit) / kel.length).toFixed(1)}%)`);

// ── kiriminaja-areas.csv ─────────────────────────────────────────────────────────────────────────
// District → the kecamatan code most of its kelurahan rows carry. Districts were matched to
// Kemendagri BY NAME within a city (build-kelurahan.mjs), so one district maps to one kecamatan in
// practice; the majority vote only guards against a stray row.
const kecOfDistrict = new Map();
for (const r of kel) {
  const kec = r.code.slice(0, 8);
  const votes = kecOfDistrict.get(r.districtId) ?? new Map();
  votes.set(kec, (votes.get(kec) ?? 0) + 1);
  kecOfDistrict.set(r.districtId, votes);
}
const districtCoord = new Map();
for (const [districtId, votes] of kecOfDistrict) {
  const kec = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const c = kecCoord.get(kec);
  if (c) districtCoord.set(districtId, c);
}

const areaLines = readFileSync(join(DATA, "kiriminaja-areas.csv"), "utf8").trim().split("\n");
const areaHeader = areaLines[0].split(",");
const areaHasCoords = areaHeader.includes("lat");
const areaOut = ["id,district_name,city_id,city_type,city_name,province_id,province_name,lat,lng"];
let areaHit = 0;
let areaTotal = 0;
for (const line of areaLines.slice(1)) {
  const f = line.split(",");
  if (f.length < 7) continue;
  // The province name is everything after the 6th comma — minus the two coordinate columns when a
  // previous run already appended them. seed-areas.ts parses the same way.
  const base = areaHasCoords ? f.slice(0, -2) : f;
  const id = Number(base[0]);
  if (!Number.isFinite(id)) continue;
  areaTotal++;
  const c = districtCoord.get(id);
  if (c) areaHit++;
  areaOut.push(`${base.join(",")},${fmt(c?.[0])},${fmt(c?.[1])}`);
}
writeFileSync(join(DATA, "kiriminaja-areas.csv"), areaOut.join("\n") + "\n");
console.log(`kiriminaja_areas: ${areaHit}/${areaTotal} punya centroid (${((100 * areaHit) / areaTotal).toFixed(1)}%)`);

// The two UAT fixtures (ops/kiriminaja-uat-sim.ts), printed so the script's output is the evidence.
for (const code of ["35.78.08.1001", "31.74.03.1001"]) console.log(`  kelurahan ${code} → ${kelCoord.get(code)?.join(", ") ?? "—"}`);
for (const id of [6138, 2107]) console.log(`  district ${id} → ${districtCoord.get(id)?.join(", ") ?? "—"}`);
