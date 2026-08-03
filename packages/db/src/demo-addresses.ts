// The PURE half of the demo delivery-data backfill: the destination pool and the generators for a
// recipient, a phone and a street address. No database import, deliberately — the writer
// (`backfill-ship-address.ts`) pulls `./client`, which connects at module scope, and a generator that
// cannot be imported is a generator that never gets tested. Same split as `cod-policy.ts` / `cod.ts`
// and `platform-rank.ts` / `platform-auth.ts`, for the same reason.
//
// What is asserted about this file lives in `demo-addresses.test.ts`: every name, phone and
// address it can emit must pass `@tokophi/lib/validate` — the rules `/api/public/order` would have
// applied if these rows had come from a real checkout instead of an UPDATE.
// ─────────────────────────────────────────────────────────────────────────────
// The destination pool. Four buckets, because the point of this data is to EXERCISE the COD chain,
// and COD needs all four combinations to be reachable:
//   cod-spx    → province on the allow-list AND SPX quotes the route  → COD can actually be offered
//   cod-nospx  → province on the allow-list, SPX does NOT quote it    → "SPX tidak melayani rute ini"
//   far-spx    → SPX serves it, province off the allow-list           → "provinsi di luar jangkauan"
//   far-nospx  → neither
// ⚠️ The SPX column is MEASURED, not assumed: every id below was quoted live against
// `shipping_price` (origin 6138 = Gubeng, Surabaya — this store's pickup district, sandbox,
// courier:["spx"], 1.000 g) on 2026-08-03. `nospx` = the call succeeded and returned ZERO services.
// Re-measure before trusting it from another origin: coverage is per route, not global.
export type Bucket = "cod-spx" | "cod-nospx" | "far-spx" | "far-nospx";
export type Dest = { id: number; label: string; bucket: Bucket };
export const BUCKETS: Bucket[] = ["cod-spx", "far-spx", "cod-nospx", "far-nospx"];

// `label` is `districtName, cityType cityName, provinceName` — exactly how areas.ts formats an area.
export const DESTINATIONS: Dest[] = [
  // ── COD-allowed provinces, SPX serves ──────────────────────────────────────
  { id: 2112, label: "Tebet, Kota Jakarta Selatan, DKI Jakarta", bucket: "cod-spx" },
  { id: 2105, label: "Kebayoran Baru, Kota Jakarta Selatan, DKI Jakarta", bucket: "cod-spx" },
  { id: 2099, label: "Menteng, Kota Jakarta Pusat, DKI Jakarta", bucket: "cod-spx" },
  { id: 2113, label: "Cakung, Kota Jakarta Timur, DKI Jakarta", bucket: "cod-spx" },
  { id: 2124, label: "Kelapa Gading, Kota Jakarta Utara, DKI Jakarta", bucket: "cod-spx" },
  { id: 2091, label: "Kembangan, Kota Jakarta Barat, DKI Jakarta", bucket: "cod-spx" },
  { id: 356, label: "Coblong, Kota Bandung, Jawa Barat", bucket: "cod-spx" },
  { id: 351, label: "Cibeunying Kidul, Kota Bandung, Jawa Barat", bucket: "cod-spx" },
  { id: 752, label: "Bekasi Timur, Kota Bekasi, Jawa Barat", bucket: "cod-spx" },
  { id: 735, label: "Cikarang Utara, Kabupaten Bekasi, Jawa Barat", bucket: "cod-spx" },
  { id: 1577, label: "Beji, Kota Depok, Jawa Barat", bucket: "cod-spx" },
  { id: 1028, label: "Cibinong, Kabupaten Bogor, Jawa Barat", bucket: "cod-spx" },
  { id: 1064, label: "Bogor Tengah - Kota, Kota Bogor, Jawa Barat", bucket: "cod-spx" },
  { id: 1513, label: "Kejaksan, Kota Cirebon, Jawa Barat", bucket: "cod-spx" },
  { id: 5929, label: "Ciemas, Kabupaten Sukabumi, Jawa Barat", bucket: "cod-spx" },
  { id: 5961, label: "Surade, Kabupaten Sukabumi, Jawa Barat", bucket: "cod-spx" },
  { id: 5509, label: "Semarang Tengah, Kota Semarang, Jawa Tengah", bucket: "cod-spx" },
  { id: 5498, label: "Banyumanik, Kota Semarang, Jawa Tengah", bucket: "cod-spx" },
  { id: 591, label: "Purwokerto Timur, Kabupaten Banyumas, Jawa Tengah", bucket: "cod-spx" },
  { id: 3533, label: "Magelang Tengah, Kota Magelang, Jawa Tengah", bucket: "cod-spx" },
  { id: 2927, label: "Kudus Kota, Kabupaten Kudus, Jawa Tengah", bucket: "cod-spx" },
  { id: 1456, label: "Nusawungu, Kabupaten Cilacap, Jawa Tengah", bucket: "cod-spx" },
  { id: 1445, label: "Dayeuhluhur, Kabupaten Cilacap, Jawa Tengah", bucket: "cod-spx" },
  { id: 6983, label: "Gondokusuman, Kota Yogyakarta, DI Yogyakarta", bucket: "cod-spx" },
  { id: 6993, label: "Umbulharjo, Kota Yogyakarta, DI Yogyakarta", bucket: "cod-spx" },
  { id: 5781, label: "Depok, Kabupaten Sleman, DI Yogyakarta", bucket: "cod-spx" },
  { id: 543, label: "Kasihan, Kabupaten Bantul, DI Yogyakarta", bucket: "cod-spx" },
  { id: 2941, label: "Wates, Kabupaten Kulon Progo, DI Yogyakarta", bucket: "cod-spx" },
  { id: 1882, label: "Wonosari, Kabupaten Gunung Kidul, DI Yogyakarta", bucket: "cod-spx" },
  { id: 6301, label: "Cipondoh, Kota Tangerang, Banten", bucket: "cod-spx" },
  { id: 6314, label: "Serpong, Kota Tangerang Selatan, Banten", bucket: "cod-spx" },
  { id: 6276, label: "Kelapa Dua, Kabupaten Tangerang, Banten", bucket: "cod-spx" },
  { id: 1462, label: "Cilegon, Kota Cilegon, Banten", bucket: "cod-spx" },
  { id: 5572, label: "Serang, Kota Serang, Banten", bucket: "cod-spx" },
  { id: 3299, label: "Bayah, Kabupaten Lebak, Banten", bucket: "cod-spx" },
  { id: 4689, label: "Sumur, Kabupaten Pandeglang, Banten", bucket: "cod-spx" },
  { id: 4665, label: "Cimanggu, Kabupaten Pandeglang, Banten", bucket: "cod-spx" },
  { id: 6161, label: "Wonokromo, Kota Surabaya, Jawa Timur", bucket: "cod-spx" },
  { id: 6157, label: "Tegalsari, Kota Surabaya, Jawa Timur", bucket: "cod-spx" },
  { id: 6153, label: "Sukolilo, Kota Surabaya, Jawa Timur", bucket: "cod-spx" },
  { id: 5647, label: "Waru, Kabupaten Sidoarjo, Jawa Timur", bucket: "cod-spx" },
  { id: 3636, label: "Klojen, Kota Malang, Jawa Timur", bucket: "cod-spx" },
  { id: 3637, label: "Lowokwaru, Kota Malang, Jawa Timur", bucket: "cod-spx" },
  { id: 2524, label: "Mojoroto, Kota Kediri, Jawa Timur", bucket: "cod-spx" },
  { id: 2211, label: "Kaliwates, Kabupaten Jember, Jawa Timur", bucket: "cod-spx" },
  { id: 601, label: "Banyuwangi, Kabupaten Banyuwangi, Jawa Timur", bucket: "cod-spx" },
  { id: 3628, label: "Tirtoyudo, Kabupaten Malang, Jawa Timur", bucket: "cod-spx" },
  { id: 3625, label: "Sumbermanjing Wetan, Kabupaten Malang, Jawa Timur", bucket: "cod-spx" },

  // ── COD-allowed provinces where SPX returns NO service (islands + the far south coast) ──────────
  // These are the rows that exercise "COD is on, the province is allowed, and it still cannot be
  // offered" — the branch nobody can test from a Jakarta address.
  { id: 1841, label: "Sangkapura, Kabupaten Gresik, Jawa Timur", bucket: "cod-nospx" },
  { id: 1843, label: "Tambak, Kabupaten Gresik, Jawa Timur", bucket: "cod-nospx" },
  { id: 2253, label: "Karimunjawa, Kabupaten Jepara, Jawa Tengah", bucket: "cod-nospx" },
  { id: 1866, label: "Girisubo, Kabupaten Gunung Kidul, DI Yogyakarta", bucket: "cod-nospx" },
  { id: 1875, label: "Purwosari, Kabupaten Gunung Kidul, DI Yogyakarta", bucket: "cod-nospx" },
  { id: 1876, label: "Rongkop, Kabupaten Gunung Kidul, DI Yogyakarta", bucket: "cod-nospx" },

  // ── Off the COD allow-list, SPX serves ─────────────────────────────────────
  { id: 3909, label: "Medan Baru, Kota Medan, Sumatera Utara", bucket: "far-spx" },
  { id: 3920, label: "Medan Petisah, Kota Medan, Sumatera Utara", bucket: "far-spx" },
  { id: 4540, label: "Padang Barat, Kota Padang, Sumatera Barat", bucket: "far-spx" },
  { id: 299, label: "Tanjung Karang Pusat, Kota Bandar Lampung, Lampung", bucket: "far-spx" },
  { id: 4923, label: "Sukajadi, Kota Pekanbaru, Riau", bucket: "far-spx" },
  { id: 673, label: "Batam Kota, Kota Batam, Kepulauan Riau", bucket: "far-spx" },
  { id: 281, label: "Kuta Alam, Kota Banda Aceh, Nanggroe Aceh Darussalam (NAD)", bucket: "far-spx" },
  { id: 2136, label: "Telanaipura, Kota Jambi, Jambi", bucket: "far-spx" },
  { id: 832, label: "Gading Cempaka, Kota Bengkulu, Bengkulu", bucket: "far-spx" },
  { id: 3593, label: "Panakkukang, Kota Makassar, Sulawesi Selatan", bucket: "far-spx" },
  { id: 3594, label: "Rappocini, Kota Makassar, Sulawesi Selatan", bucket: "far-spx" },
  { id: 4637, label: "Palu Timur, Kota Palu, Sulawesi Tengah", bucket: "far-spx" },
  { id: 2557, label: "Kendari, Kota Kendari, Sulawesi Tenggara", bucket: "far-spx" },
  { id: 3778, label: "Wenang, Kota Manado, Sulawesi Utara", bucket: "far-spx" },
  { id: 1795, label: "Kota Tengah, Kota Gorontalo, Gorontalo", bucket: "far-spx" },
  { id: 274, label: "Balikpapan Selatan, Kota Balikpapan, Kalimantan Timur", bucket: "far-spx" },
  { id: 5361, label: "Samarinda Ulu, Kota Samarinda, Kalimantan Timur", bucket: "far-spx" },
  { id: 506, label: "Banjarmasin Tengah, Kota Banjarmasin, Kalimantan Selatan", bucket: "far-spx" },
  { id: 5102, label: "Pontianak Kota, Kota Pontianak, Kalimantan Barat", bucket: "far-spx" },
  { id: 3878, label: "Mataram, Kota Mataram, Nusa Tenggara Barat (NTB)", bucket: "far-spx" },
  { id: 2999, label: "Kelapa Lima, Kota Kupang, Nusa Tenggara Timur (NTT)", bucket: "far-spx" },
  { id: 5335, label: "Lobalain, Kabupaten Rote Ndao, Nusa Tenggara Timur (NTT)", bucket: "far-spx" },
  { id: 212, label: "Sirimau, Kota Ambon, Maluku", bucket: "far-spx" },
  { id: 2641, label: "Sanana, Kabupaten Kepulauan Sula, Maluku Utara", bucket: "far-spx" },
  { id: 2159, label: "Jayapura Utara, Kota Jayapura, Papua", bucket: "far-spx" },
  { id: 5844, label: "Sorong, Kota Sorong, Papua Barat", bucket: "far-spx" },

  // ── Off the allow-list AND no SPX. ⚠️ Bali is in here: measured from Gubeng, SPX quotes NOTHING to
  // Denpasar or Kuta. Surprising, and exactly why the column is measured rather than guessed.
  { id: 259, label: "Kuta, Kabupaten Badung, Bali", bucket: "far-nospx" },
  { id: 1574, label: "Denpasar Selatan, Kota Denpasar, Bali", bucket: "far-nospx" },
  { id: 3686, label: "Teluk Elpaputih, Kabupaten Maluku Tengah, Maluku", bucket: "far-nospx" },
  { id: 3970, label: "Merauke, Kabupaten Merauke, Papua Selatan", bucket: "far-nospx" },
  { id: 4422, label: "Krayan, Kabupaten Nunukan, Kalimantan Utara", bucket: "far-nospx" },
];

// The four buckets INTERLEAVED, so that any prefix of this list already contains all four. Rows are
// assigned round-robin from it, and the SPX rows are a partition of ~67 against a pool of 85 — a
// plain concatenation would have given every one of them a `cod-spx` destination and tested nothing.
export function interleaved(dests = DESTINATIONS): Dest[] {
  const lanes: Dest[][] = BUCKETS.map((b) =>
    dests.filter((d) => d.bucket === b),
  );
  const out: Dest[] = [];
  for (let i = 0; out.length < dests.length; i++) for (const lane of lanes) if (lane[i]) out.push(lane[i]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipients. The first six are the shapes an over-eager validator has refused before (apostrophe,
// initial + dot, four words, hyphen, the curly `’`) — they are FIRST so that they are assigned to the
// lowest-indexed customers and are guaranteed to appear in the data, not merely in this list.
export const RECIPIENTS = [
  "Nur'aini", "M. Rizky", "I Gusti Ngurah Rai", "Abdul Ghofur Al-Rasyid", "Anne-Marie Tobing", "Aisyah Zahra’",
  "Siti Nurhaliza", "Budi Santoso", "Ni Kadek Ayu Lestari", "Rangga Prasetyo", "Dewi Anggraini",
  "Yohanes Sitanggang", "Tengku Ratna Sari", "Andi Baso Mappatunru", "Sri Wahyuni", "Bambang Irawan",
  "Fitriani Putri", "Made Wirawan", "Hendra Gunawan", "Nyoman Trisna Dewi", "Muhammad Fauzan",
  "Rahmawati Sholihah", "Cornelius Tampubolon", "Putri Maharani", "Agus Setiawan", "Lalu Ahmad Zaki",
  "Vera Simatupang", "Ratu Salsabila", "Ida Ayu Komang Sri", "Zulkifli Hasan", "Nadia Safitri",
  "Bagus Dwi Nugroho", "Aulia Rahman", "Tri Handayani", "Josua Panggabean", "Wayan Sudiarta",
];

// Carrier prefixes. 838 / 881 / 895 / 851 are FIRST for the same reason: a hard-coded operator list
// would have refused all four, and the demo has to contain the numbers that prove it doesn't.
export const PHONE_PREFIXES = [
  "838", "881", "895", "851",
  "812", "813", "821", "822", "852", "853", "857", "858", "877", "896", "899", "819", "831", "882",
];

const STREETS = [
  "Melati", "Kenanga", "Anggrek", "Cempaka", "Flamboyan", "Bougenville", "Mawar", "Nusa Indah",
  "Diponegoro", "Ahmad Yani", "Gatot Subroto", "Jenderal Sudirman", "Imam Bonjol", "Teuku Umar",
  "Pattimura", "Hasanuddin", "Kartini", "Cut Nyak Dien", "Wahid Hasyim", "Sisingamangaraja",
  "Pahlawan", "Veteran", "Merdeka", "Pemuda", "Rajawali", "Garuda", "Setia Budi", "Kalimantan",
];
const LANDMARKS = [
  "depan Masjid Al-Ikhlas", "sebelah Indomaret", "dekat SDN 02", "belakang Puskesmas",
  "samping warung Bu Sri", "patokan pos ronda", "depan lapangan bola", "dekat pasar pagi",
];
const CLUSTERS = ["Griya Asri", "Bumi Indah", "Puri Kencana", "Taman Harapan", "Villa Melati Mas"];

// ─────────────────────────────────────────────────────────────────────────────
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — a stable seed per order number, so a row's address never moves between runs. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * A street address a courier could act on: street + house number, RT/RW where natural, a block or a
 * landmark where natural, and the kelurahan the postcode came from. Always has a digit and is always
 * well past the 15-character floor — that is the whole point of the exercise.
 */
export function buildAddress(rnd: () => number, kelurahanName: string): string {
  const parts: string[] = [];
  const street = STREETS[Math.floor(rnd() * STREETS.length)];
  const no = 1 + Math.floor(rnd() * 148);
  const suffix = rnd() < 0.18 ? "ABCD"[Math.floor(rnd() * 4)] : "";
  if (rnd() < 0.15) {
    // Perumahan shape — "Blok C2/14" is one of the forms the checkout sweep pins.
    const cluster = CLUSTERS[Math.floor(rnd() * CLUSTERS.length)];
    parts.push(`Perum ${cluster} Blok ${"ABCDEF"[Math.floor(rnd() * 6)]}${1 + Math.floor(rnd() * 9)}/${no}`);
  } else {
    parts.push(`${rnd() < 0.25 ? "Jalan" : rnd() < 0.12 ? "Gg." : "Jl."} ${street} No. ${no}${suffix}`);
  }
  if (rnd() < 0.72) {
    const rt = 1 + Math.floor(rnd() * 15);
    const rw = 1 + Math.floor(rnd() * 12);
    parts.push(rnd() < 0.35 ? `RT.${pad(rt, 3)}/RW.${pad(rw, 3)}` : `RT ${pad(rt, 2)}/RW ${pad(rw, 2)}`);
  }
  // The landmark hangs off the kelurahan without a comma, the way people actually write a patokan.
  const landmark = rnd() < 0.3 ? ` (${LANDMARKS[Math.floor(rnd() * LANDMARKS.length)]})` : "";
  parts.push(kelurahanName + landmark);
  return parts.join(", ");
}

/**
 * `62` + a carrier prefix + 7 digits → 10 national digits, inside the 9–12 the validator allows.
 *
 * Keyed on the CUSTOMER index, not on the order: one buyer with one name and three different phone
 * numbers across three parcels reads like corrupt data on the customer screen. Same reason
 * `recipientFor` is keyed that way.
 */
export function buildPhone(customerIndex: number): string {
  const prefix = PHONE_PREFIXES[customerIndex % PHONE_PREFIXES.length];
  const rnd = mulberry32(hash32(`phone:${customerIndex}`));
  return `62${prefix}${pad(Math.floor(rnd() * 10_000_000), 7)}`;
}

export function recipientFor(customerIndex: number): string {
  return RECIPIENTS[customerIndex % RECIPIENTS.length];
}

