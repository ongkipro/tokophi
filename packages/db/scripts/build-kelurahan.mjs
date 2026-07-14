// Generates `packages/db/data/kelurahan.csv` — the kelurahan (village) reference the storefront
// checkout uses to auto-fill a POSTAL CODE.
//
// WHY a kelurahan level exists at all: in Indonesia the kodepos is assigned per kelurahan, not per
// kecamatan. 83% of kecamatan do happen to have a single kodepos — but the other 17% are the dense
// urban ones where the orders actually are (Kecamatan Semarang Tengah alone spans 11 kodepos). So a
// kodepos cannot be derived from the kecamatan the shopper picks for ongkir; it needs one more level.
//
// Sources (public, Kemendagri-derived — re-run this script to refresh):
//   · https://github.com/cahyadsn/wilayah          → db/wilayah.sql         (kode → nama, all levels)
//   · https://github.com/cahyadsn/wilayah_kodepos  → db/wilayah_kodepos.sql (kelurahan kode → kodepos)
//
// THE JOIN IS THE HARD PART. Ongkir is quoted against a KiriminAja district id; the dataset above is
// keyed by Kemendagri codes. The two share no key, so districts are matched BY NAME within the same
// city — exact first, then KiriminAja's parenthetical aliases ("Pante Ceureumen (Pantai Ceuremen)"),
// then a bigram-similarity fallback. Matching is confined to one city, so the search space is a dozen
// names, not seven thousand.
//
// ~96% of KiriminAja's 7030 districts resolve. The rest emit NO rows on purpose: the checkout then
// leaves kodepos as an ordinary typed field for those destinations. A wrong postcode goes on a real
// parcel — an unmatched district must degrade to "the shopper types it", never to a guess.
//
// Run: node packages/db/scripts/build-kelurahan.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = join(DIR, "../data");
const SRC = {
  wilayah: "https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql",
  kodepos: "https://raw.githubusercontent.com/cahyadsn/wilayah_kodepos/main/db/wilayah_kodepos.sql",
};

const ROW = /\('([\d.]+)',\s*'((?:[^']|'')*)'\)/g;

function parsePairs(sql) {
  const out = new Map();
  for (const m of sql.matchAll(ROW)) out.set(m[1], m[2].replaceAll("''", "'"));
  return out;
}

/** Lowercase, drop the Kabupaten/Kota prefix, strip everything that isn't a letter or digit. */
function norm(s) {
  return (s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(kabupaten|kab|kota adm|kota administrasi|kota)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** KiriminAja keeps alternate spellings in parentheses — try the whole name and both halves. */
function variants(name) {
  const out = [name];
  const m = /^(.*?)\s*\((.*?)\)\s*$/.exec(name);
  if (m) out.push(m[1], m[2]);
  return out.map(norm).filter(Boolean);
}

/** Dice coefficient over character bigrams — 1 = identical. Cheap, and good enough for spellings. */
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

console.log("Mengunduh dataset wilayah…");
const [wilayahSql, kodeposSql] = await Promise.all(
  [SRC.wilayah, SRC.kodepos].map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Gagal unduh ${u}: ${r.status}`);
    return r.text();
  }),
);

const wilayah = parsePairs(wilayahSql); // kode → nama (every level)
const kodepos = parsePairs(kodeposSql); // kode kelurahan → kodepos

// KiriminAja districts, from the CSV already committed for `kiriminaja_areas`.
const kaCsv = readFileSync(join(DATA, "kiriminaja-areas.csv"), "utf8").trim().split("\n").slice(1);
const kaByCity = new Map(); // normalised city → [{ id, names[] }]
for (const line of kaCsv) {
  const f = line.split(",");
  const id = Number(f[0]);
  if (!Number.isFinite(id)) continue;
  const city = norm(f[4]);
  if (!kaByCity.has(city)) kaByCity.set(city, []);
  kaByCity.get(city).push({ id, names: variants(f[1].trim()) });
}

// Kemendagri districts: 8-char code (xx.xx.xx) → { name, city }
const kemDistricts = [];
for (const [code, name] of wilayah) {
  if (code.split(".").length !== 3) continue;
  kemDistricts.push({ code, name, city: wilayah.get(code.slice(0, 5)) ?? "" });
}

// Kemendagri district → KiriminAja district id
const districtToKa = new Map();
let exact = 0;
let fuzzy = 0;

for (const d of kemDistricts) {
  const cands = kaByCity.get(norm(d.city));
  if (!cands) continue;
  const target = norm(d.name);

  const hit = cands.find((c) => c.names.includes(target));
  if (hit) {
    districtToKa.set(d.code, hit.id);
    exact++;
    continue;
  }
  // Best bigram match WITHIN THE SAME CITY. 0.82 is deliberately tight — a wrong district here would
  // attach the wrong kodepos list to a real address.
  let best = null;
  let bestScore = 0.82;
  for (const c of cands) {
    for (const n of c.names) {
      const s = similarity(target, n);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
  }
  if (best) {
    districtToKa.set(d.code, best.id);
    fuzzy++;
  }
}

const rows = [];
for (const [code, name] of wilayah) {
  if (code.split(".").length !== 4) continue; // kelurahan only
  const post = kodepos.get(code);
  if (!post) continue;
  const kaId = districtToKa.get(code.slice(0, 8));
  if (!kaId) continue; // district didn't resolve → this kelurahan is unusable for our ongkir flow
  rows.push(`${code},${kaId},"${name.replaceAll('"', '""')}",${post}`);
}

writeFileSync(join(DATA, "kelurahan.csv"), "code,ka_district_id,name,postcode\n" + rows.join("\n") + "\n");

const covered = new Set([...districtToKa.values()]).size;
const kaTotal = new Set(kaCsv.map((l) => Number(l.split(",")[0])).filter(Number.isFinite)).size;
console.log(`district cocok   : ${exact} persis + ${fuzzy} fuzzy`);
console.log(`cakupan KA       : ${covered}/${kaTotal} (${((covered / kaTotal) * 100).toFixed(1)}%)`);
console.log(`kelurahan ditulis: ${rows.length} → data/kelurahan.csv`);
