// Fills the `ka_kelurahan_id` column of `packages/db/data/kelurahan.csv` — KiriminAja's OWN
// subdistrict id, ALONGSIDE the Kemendagri code the file is keyed on (Task 8.17).
//
// WHY A SECOND ID EXISTS AT ALL. `build-kelurahan.mjs` builds this CSV from the public Kemendagri
// datasets, because the kodepos is published per Kemendagri village code and nowhere else. That
// code is text, dotted, 13 characters ("34.02.07.2001"). KiriminAja's `v6.2/request_pickup` marks
// `kelurahan_id` and `destination_kelurahan_id` REQUIRED and wants ITS OWN id — a small integer.
// Sending the Kemendagri code as one would be a WRONG id, which is worse than an absent one, so
// until this column is filled the two fields are omitted. Neither id may replace the other: the
// postcode join needs the Kemendagri key, the courier needs the vendor key.
//
// THE VENDOR ENDPOINT (verified live against the sandbox, 2026-09-10, district 548):
//   POST /api/mitra/kelurahan   { "kecamatan_id": 548 }
//   -> { status: true, text: "Courier Loaded", method: "get_kelurahan_from_kecamatan_id",
//        results: [ { id: 31483, kelurahan_name: "Bawuran", kecamatan_id: 548,
//                     postal_code: "55791" }, ... ] }
// ⚠️ It answers in `results`, NOT the `datas` every other hierarchy endpoint uses — the spec says
// so in as many words. `postal_code` is REAL but UNDOCUMENTED (absent from the OpenAPI schema), so
// it is never written here: the committed postcode stays the Kemendagri one, which is the dataset
// this file's whole reason for existing is built on.
//
// 🔴 `status:false` IS A VENDOR ERROR, NOT "NO DATA", AND CONFLATING THE TWO INVENTS A COVERAGE GAP.
// Measured 2026-09-10: at concurrency 4 the endpoint soft-throttles and answers **HTTP 200** with
//   {"status":false,"text":"Oops, terjadi kesalahan. Coba beberapa saat lagi.","endpoint":"kelurahan"}
// — no 429, no error status, the same shape as a real answer minus `results`. A first run read that
// as "the vendor has no subdistricts here" and reported 179 of 300 districts empty (59,7%). Sixty
// seconds later the SAME three district ids (548, 2788, 1) all returned full lists. The endpoint is
// slow and rate-sensitive, not sparse. So: only `status === true` with a `results` array is an
// answer; `status:false` is retried with backoff and, if it never clears, counted as OUR failure.
//
// THE JOIN IS BY NAME, exactly as `build-kelurahan.mjs` joins districts: same `norm`, same
// parenthetical `variants`, same bigram `similarity` with the same tight 0.82 floor, confined to
// ONE district so the search space is a dozen names. A wrong subdistrict id goes on a real parcel.
//
// 🔴 A SILENT PARTIAL MATCH MUST NEVER READ AS SUCCESS. The run prints matched / unmatched / total
// for both districts and kelurahan, and writes `data/ka-kelurahan-unmatched.csv` — every unmatched
// row with its province — plus a per-province summary. A number nobody can trace is what this repo
// keeps paying for. An unmatched row keeps `ka_kelurahan_id` EMPTY; the caller then omits the
// field, which is the behaviour we already have today.
//
// Run (needs a KiriminAja key and an allow-listed IP — in practice the production admin container):
//   KIRIMINAJA_API_KEY=… KIRIMINAJA_ENV=sandbox node packages/db/scripts/build-ka-kelurahan-ids.mjs
// Options: LIMIT_DISTRICTS=200 (a stride-sample across every province), ONLY_DISTRICTS=1029,103
//   (walk exactly these district ids — for repairing a subset), CONCURRENCY (default 2 —
// raising it is what triggers the soft throttle described below), PACE_MS (default 250), OUT=<path>.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = join(DIR, "../data");
const KEY = process.env.KIRIMINAJA_API_KEY ?? "";
const BASE =
  (process.env.KIRIMINAJA_ENV ?? "sandbox") === "production"
    ? "https://client.kiriminaja.com"
    : "https://tdev.kiriminaja.com";
// Deliberately LOW. Concurrency 4 produced a 59,7% false "no data" rate (see the note above); 2
// with a 250 ms pace produced none. Throughput is not what this script is for — an honest number is.
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
const PACE_MS = Number(process.env.PACE_MS ?? 250);
// ONLY_DISTRICTS=1029,103,1049 — walk exactly these KiriminAja district ids. See the note below.
const ONLY = (process.env.ONLY_DISTRICTS ?? "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x) && x > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT = Number(process.env.LIMIT_DISTRICTS ?? 0);
const OUT = process.env.OUT || join(DATA, "kelurahan.csv");

if (!KEY) throw new Error("KIRIMINAJA_API_KEY is required (never hard-code it, never print it).");

/** Lowercase, strip everything that isn't a letter or digit — same rule as build-kelurahan.mjs. */
function norm(s) {
  return (s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(kelurahan|kel|desa|nagari|kampung)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** Alternate spellings live in parentheses on both sides — try the whole name and both halves. */
function variants(name) {
  const out = [name];
  const m = /^(.*?)\s*\((.*?)\)\s*$/.exec(name);
  if (m) out.push(m[1], m[2]);
  return out.map(norm).filter(Boolean);
}

/** Dice coefficient over character bigrams — 1 = identical. Same helper, same 0.82 floor. */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/**
 * One district's subdistricts from the vendor.
 *
 * THREE OUTCOMES, and they must stay three. `null` = OUR run failed (transport, or the vendor kept
 * answering `status:false`); `[]` = the vendor answered honestly and has nothing; a list = data.
 * The first two look identical in a total and mean opposite things: one is a coverage gap we must
 * live with, the other is a measurement we have not actually taken.
 */
async function kelurahanOf(kecamatanId, attempt = 0) {
  const MAX_ATTEMPTS = 6;
  try {
    const res = await fetch(`${BASE}/api/mitra/kelurahan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kecamatan_id: kecamatanId }),
      signal: AbortSignal.timeout(20000),
    });
    // 429 is documented for the sandbox; the soft throttle above is an HTTP 200 `status:false`.
    // Both are "come back later", so both back off on the same ladder.
    const body = res.status === 429 ? null : await res.json().catch(() => null);
    if (body && body.status === true && Array.isArray(body.results)) return body.results;
    // An answer we cannot use. Back off — 1s, 2s, 4s, 8s, 16s — and try again.
    if (attempt < MAX_ATTEMPTS) {
      await sleep(1000 * 2 ** attempt);
      return kelurahanOf(kecamatanId, attempt + 1);
    }
    console.warn(
      `  ! kecamatan ${kecamatanId}: vendor menolak ${MAX_ATTEMPTS + 1}x (HTTP ${res.status}, ` +
        `status=${body ? JSON.stringify(body.status) : "?"}) — dihitung GAGAL, bukan "tanpa data"`,
    );
    return null;
  } catch (e) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(1000 * 2 ** attempt);
      return kelurahanOf(kecamatanId, attempt + 1);
    }
    console.warn(`  ! kecamatan ${kecamatanId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ── Our rows, exactly as the CSV holds them ───────────────────────────────────
const csv = readFileSync(join(DATA, "kelurahan.csv"), "utf8").trim().split("\n");
const header = csv[0].split(",");
const hasKaCol = header.includes("ka_kelurahan_id");
// `name` is quoted (it may contain a comma); the others never are. The 5th field is optional so a
// re-run over an already-filled file parses too.
const LINE = /^([^,]+),(\d+),"((?:[^"]|"")*)",(\d+)(?:,(\d*))?$/;
const rows = [];
for (const line of csv.slice(1)) {
  const m = LINE.exec(line);
  if (!m) continue;
  rows.push({
    code: m[1],
    districtId: Number(m[2]),
    name: m[3].replaceAll('""', '"'),
    postcode: m[4],
    kaId: hasKaCol && m[5] ? Number(m[5]) : null,
  });
}

// Province per district, for the unmatched report — the CSV of our rows carries no province.
const provinceOf = new Map();
for (const line of readFileSync(join(DATA, "kiriminaja-areas.csv"), "utf8").trim().split("\n").slice(1)) {
  const f = line.split(",");
  const id = Number(f[0]);
  if (Number.isFinite(id)) provinceOf.set(id, (f[6] ?? "").trim());
}

const byDistrict = new Map();
for (const r of rows) {
  if (!byDistrict.has(r.districtId)) byDistrict.set(r.districtId, []);
  byDistrict.get(r.districtId).push(r);
}
let districts = [...byDistrict.keys()].sort((a, b) => a - b);
// A NAMED SUBSET, for repairing specific districts without re-walking all 7 000+ (2,5 h). Like
// LIMIT_DISTRICTS it makes the run PARTIAL, so `data/kelurahan.csv` is never rewritten from it —
// point OUT at a scratch file and merge the districts you asked for.
if (ONLY.length) {
  const want = new Set(ONLY);
  districts = districts.filter((d) => want.has(d));
  const missing = ONLY.filter((d) => !byDistrict.has(d));
  if (missing.length) console.warn(`  ! ONLY_DISTRICTS: ${missing.length} id tidak ada di CSV: ${missing.slice(0, 10).join(",")}`);
}
if (LIMIT > 0) {
  // A STRIDE, not the first N: the CSV is ordered by province, so `slice(0, N)` would sample Aceh
  // and call it Indonesia. A stride spreads the sample across every province in the file.
  const stride = Math.max(1, Math.floor(districts.length / LIMIT));
  districts = districts.filter((_, i) => i % stride === 0).slice(0, LIMIT);
}

console.log(
  `Meminta kelurahan KiriminAja untuk ${districts.length} kecamatan (dari ${byDistrict.size}), concurrency ${CONCURRENCY}…`,
);

// ── Walk the districts ────────────────────────────────────────────────────────
const stat = {
  districtsQueried: 0,
  districtsWithData: 0,
  districtsEmpty: 0, // vendor answered, honestly, with nothing
  districtsFailed: 0, // our side failed — NOT the same thing
  exact: 0,
  fuzzy: 0,
  unmatched: 0,
  considered: 0,
};
const unmatched = [];
const emptyDistricts = [];

let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= districts.length) return;
    const districtId = districts[i];
    const mine = byDistrict.get(districtId);
    const theirs = await kelurahanOf(districtId);
    if (PACE_MS > 0) await sleep(PACE_MS);
    stat.districtsQueried++;
    if (theirs === null) {
      stat.districtsFailed++;
      continue;
    }
    if (theirs.length === 0) {
      stat.districtsEmpty++;
      emptyDistricts.push(districtId);
      for (const r of mine) {
        stat.considered++;
        stat.unmatched++;
        unmatched.push({ ...r, reason: "vendor-no-data" });
      }
      continue;
    }
    stat.districtsWithData++;

    const cands = theirs
      .map((t) => ({ id: Number(t.id), names: variants(String(t.kelurahan_name ?? "")) }))
      .filter((c) => Number.isFinite(c.id) && c.names.length);

    // 🔴 ONE KIRIMINAJA RECORD MAY BE CLAIMED BY AT MOST ONE OF OUR ROWS, AND A CONTESTED CLAIM IS
    // ABANDONED BY BOTH SIDES. The first version of this loop scored every row independently and
    // never marked a candidate taken, so sibling villages whose names differ only by a numeral —
    // "Cimanggu I" / "Cimanggu II", "Gunung Bunder I" / "Gunung Bunder II", "Biwage 1" / "Biwage 2"
    // — both landed on the SAME vendor id. Measured over the full 78 764-row walk of 2026-09-10:
    // 124 vendor ids claimed twice, 270 of our rows involved, and for each pair at MOST one id can
    // be right while nothing in the output says which. That is the exact shape this file's own
    // header calls worse than an absent id, because it reaches `sender_kelurahan_id` and dispatches
    // a pickup rider to a neighbouring village.
    //
    // Two passes, and the second one is global within the district rather than per row:
    //   1. An exact name match claims its candidate — UNLESS two of our rows match the same one,
    //      in which case neither may have it (`reason: "ambiguous-exact"`). Picking by file order
    //      would be picking at random and calling it a match.
    //   2. Every surviving (row, unclaimed candidate) pair above the floor is scored, sorted best
    //      first, and assigned greedily. The better name wins the record; the loser goes UNMATCHED
    //      rather than inheriting a neighbour's id.
    const claimed = new Set();
    const pending = [];
    const exactBy = new Map(); // candidate id -> our rows that match it exactly
    for (const r of mine) {
      stat.considered++;
      const target = norm(r.name);
      const hit = cands.find((c) => c.names.includes(target));
      if (hit) {
        if (!exactBy.has(hit.id)) exactBy.set(hit.id, []);
        exactBy.get(hit.id).push(r);
      } else {
        pending.push({ r, target });
      }
    }
    for (const [id, claimants] of exactBy) {
      if (claimants.length === 1) {
        claimants[0].kaId = id;
        claimed.add(id);
        stat.exact++;
      } else {
        for (const r of claimants) {
          stat.unmatched++;
          unmatched.push({ ...r, reason: "ambiguous-exact" });
        }
      }
    }
    // 0.82 is the same floor as the district join — a wrong id goes on a real parcel.
    const pairs = [];
    for (const { r, target } of pending) {
      for (const c of cands) {
        if (claimed.has(c.id)) continue;
        let s = 0;
        for (const n of c.names) s = Math.max(s, similarity(target, n));
        if (s > 0.82) pairs.push({ r, c, s });
      }
    }
    pairs.sort((a, b) => b.s - a.s);
    const won = new Set();
    for (const p of pairs) {
      if (claimed.has(p.c.id) || won.has(p.r)) continue;
      p.r.kaId = p.c.id;
      claimed.add(p.c.id);
      won.add(p.r);
      stat.fuzzy++;
    }
    for (const { r } of pending) {
      if (won.has(r)) continue;
      stat.unmatched++;
      unmatched.push({ ...r, reason: "name-no-match" });
    }
    if (stat.districtsQueried % 200 === 0) {
      console.log(`  …${stat.districtsQueried}/${districts.length} kecamatan`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

// ── Write ─────────────────────────────────────────────────────────────────────
// Only rewrite the full CSV on a FULL run. A sample would blank the column for every district it
// never asked about, which is data loss dressed as a successful run.
const partial = LIMIT > 0 || ONLY.length > 0 || stat.districtsFailed > 0;
if (partial && OUT === join(DATA, "kelurahan.csv")) {
  console.log(
    `\n⚠️  Sebagian (LIMIT_DISTRICTS=${LIMIT || 0}, gagal ${stat.districtsFailed}) — data/kelurahan.csv TIDAK ditulis.` +
      ` Jalankan penuh, atau set OUT=<path> untuk menyimpan hasil sampel.`,
  );
} else {
  const out = ["code,ka_district_id,name,postcode,ka_kelurahan_id"];
  for (const r of rows) {
    out.push(`${r.code},${r.districtId},"${r.name.replaceAll('"', '""')}",${r.postcode},${r.kaId ?? ""}`);
  }
  writeFileSync(OUT, out.join("\n") + "\n");
  console.log(`\nDitulis ${rows.length} baris → ${OUT}`);
}

// ── The report. This is the point of the script, not an afterthought. ─────────
const perProvince = new Map();
for (const u of unmatched) {
  const p = provinceOf.get(u.districtId) || "(provinsi tidak dikenal)";
  const e = perProvince.get(p) ?? { count: 0, districts: new Set() };
  e.count++;
  e.districts.add(u.districtId);
  perProvince.set(p, e);
}
const unmatchedPath = join(DATA, "ka-kelurahan-unmatched.csv");
writeFileSync(
  unmatchedPath,
  "code,ka_district_id,province,name,postcode,reason\n" +
    unmatched
      .map(
        (u) =>
          `${u.code},${u.districtId},"${(provinceOf.get(u.districtId) || "").replaceAll('"', '""')}",` +
          `"${u.name.replaceAll('"', '""')}",${u.postcode},${u.reason}`,
      )
      .join("\n") +
    (unmatched.length ? "\n" : ""),
);

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) : "0.00");
console.log(`
kecamatan diminta : ${stat.districtsQueried}
  ada datanya     : ${stat.districtsWithData}
  kosong (vendor) : ${stat.districtsEmpty}   ← vendor menjawab, tanpa kelurahan
  gagal (kita)    : ${stat.districtsFailed}   ← kegagalan transport, BUKAN "tidak ada data"
kelurahan dinilai : ${stat.considered}
  cocok persis    : ${stat.exact} (${pct(stat.exact, stat.considered)}%)
  cocok fuzzy     : ${stat.fuzzy} (${pct(stat.fuzzy, stat.considered)}%)
  TIDAK COCOK     : ${stat.unmatched} (${pct(stat.unmatched, stat.considered)}%)  → ${unmatchedPath}`);

if (perProvince.size) {
  console.log(`\ntidak cocok per provinsi:`);
  for (const [p, e] of [...perProvince].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(e.count).padStart(6)}  ${p} (${e.districts.size} kecamatan)`);
  }
}
if (stat.districtsFailed) {
  console.log(`\n⚠️  ${stat.districtsFailed} kecamatan GAGAL diminta — angka di atas bukan pengukuran penuh.`);
}
