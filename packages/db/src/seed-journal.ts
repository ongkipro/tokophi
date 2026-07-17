// Seed the DEMO STORE's Jurnal — 15 articles, each with a real featured image that lands in the
// merchant's Files library.
//
// WHY THIS FILE EXISTS. `seed.ts` shipped 6 articles pointing at `/products/*.webp` — the storefront's
// STATIC product photos. That was fine while nothing else used the column, but it meant the demo's
// journal was illustrated by files no merchant could ever have picked: `media` had **zero rows**, so
// Files was empty, and the Blog editor's image control was a dead button. Fixing the editor (it now
// uploads through `uploadMedia` like everything else) made the demo the odd one out — its articles
// had images that were not in the library the feature writes to.
//
// So this script does what the merchant now does: it puts each image THROUGH the upload pipeline —
// crop to the card's 3:2, encode WebP, write to `apps/admin/public/uploads/`, register a `media` row —
// and points the article at the resulting `/api/uploads/<name>` path. The demo is then reachable by
// hand: a merchant can reproduce every row here with the editor.
//
// The source photos are the store's own AI-generated catalogue shots (`apps/admin/public/products/`).
// A journal about batik illustrated with the batik it sells is honest; stock photos of someone else's
// clothes would not be.
//
// ⚠️ UPSERT-BY-REPLACE, same as seed-templates.ts and for the same reason: hardcoded to
// `batik-nusantara`, cannot reach a merchant, and an insert-if-absent guard would pin the demo to
// whatever shape shipped first. **It DELETES the demo's articles and re-inserts them.** Safe here;
// wrong for a real store. If you ever point this at one, restore the guard first.
//   npm run seed:journal -w @tokophi/db
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, client, schema } from "./client";
import { and, eq } from "drizzle-orm";

const DEMO_SLUG = "batik-nusantara";
const TODAY = new Date("2026-06-30T00:00:00Z");

// Mirrors apps/admin/lib/image-store.ts. NOT imported from there: that module is `server-only` (it
// would refuse to load outside Next) and lives in another workspace. The rules that matter are
// duplicated deliberately and narrowly — 3:2 for the card, WebP q82, the same output directory — and
// the encoder settings are the ones a real upload would apply to the same file.
const PRODUCTS_DIR = path.join(process.cwd(), "..", "..", "apps", "admin", "public", "products");
const UPLOAD_DIR = path.join(process.cwd(), "..", "..", "apps", "admin", "public", "uploads");
const CARD_W = 900;
const CARD_H = 600; // 3:2 — the lock ArticleCard.astro renders at

type Draft = {
  title: string;
  handle: string;
  blog: "Berita Toko" | "Tips & Panduan";
  author: string;
  daysAgo: number;
  published: boolean;
  excerpt: string;
  /** file in apps/admin/public/products/ */
  src: string;
  body: string;
};

// 15 articles. Written to be publishable: no discount rate, deadline or stock claim that is not
// backed by a row somewhere — a journal is the loudest place to promise something checkout then
// refuses. Where an offer is mentioned it is the demo store's own, in its own voice.
const DRAFTS: Draft[] = [
  {
    title: "Kenapa Batik Tulis Lebih Mahal dari Batik Cap?",
    handle: "batik-tulis-vs-cap",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 1,
    published: true,
    excerpt: "Bukan soal gengsi — perbedaannya ada di waktu, tangan, dan malam yang dipakai.",
    src: "dress-batik.webp",
    body: `Pertanyaan ini hampir selalu muncul: kenapa dua kain yang motifnya mirip bisa beda harga sampai lima kali lipat?

Jawabannya bukan merek. Jawabannya waktu.

Batik tulis dikerjakan dengan canting, satu titik demi satu titik. Selembar kain dengan motif rapat bisa memakan dua sampai delapan minggu, dikerjakan satu orang. Tidak ada dua helai yang identik, karena tangan manusia tidak pernah mengulang garis dengan persis sama.

Batik cap memakai stempel tembaga. Satu motif bisa dicetak berulang dalam hitungan jam. Rapi, konsisten, dan jauh lebih cepat — karena itu lebih terjangkau.

- Batik tulis: 2-8 minggu, satu pengrajin, tidak ada duplikat
- Batik cap: hitungan jam, motif berulang presisi
- Batik kombinasi: cap untuk pola dasar, tulis untuk detail

Mana yang lebih baik? Tidak ada. Keduanya batik. Yang berbeda adalah apa yang Anda bayar: pada tulis, Anda membayar waktu seseorang.`,
  },
  {
    title: "Cara Mencuci Batik Agar Warnanya Tidak Luntur",
    handle: "cara-mencuci-batik",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 3,
    published: true,
    excerpt: "Lerak, air dingin, dan satu kebiasaan yang harus dihentikan: memeras.",
    src: "gamis-syari.webp",
    body: `Batik luntur sembilan dari sepuluh kali bukan karena pewarnanya murah. Penyebabnya cara cuci.

Yang perlu dihentikan:
- Merendam lama. Lima menit cukup. Semakin lama terendam, semakin banyak warna yang lepas.
- Memeras. Serat kain rusak dan warna ikut keluar bersama air.
- Deterjen biasa. Enzimnya dirancang mengangkat noda — dan warna alami dianggap noda.
- Menjemur di bawah matahari langsung. Sinar UV memudarkan warna lebih cepat dari cucian mana pun.

Yang sebaiknya dilakukan:
- Pakai lerak, atau sampo bayi kalau lerak sulit dicari.
- Air dingin, kucek lembut dengan telapak, jangan disikat.
- Angkat, biarkan air menetes sendiri. Jangan diperas.
- Jemur terbalik di tempat teduh yang berangin.

Setrika dari sisi dalam, suhu sedang, beri alas kain katun tipis. Malam pada batik tulis bisa meleleh kalau kena setrika panas langsung.`,
  },
  {
    title: "Padu Padan Batik untuk ke Kantor Tanpa Terlihat Formal",
    handle: "padu-padan-batik-kantor",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 5,
    published: true,
    excerpt: "Batik tidak harus berpasangan dengan rok span dan blazer hitam.",
    src: "blouse-katun.webp",
    body: `Batik ke kantor sering berhenti di satu formula: atasan batik, bawahan gelap, selesai. Aman, tapi juga kaku.

Beberapa cara membuatnya lebih hidup tanpa kehilangan kesan rapi:

- Batik dengan denim gelap. Potongan denim yang lurus membuat motif ramai jadi lebih tenang.
- Outer polos di atas batik. Motif hanya muncul di bagian dada dan lengan — cukup untuk terlihat, tidak sampai mendominasi.
- Kulot dengan atasan batik pendek. Proporsi tinggi-rendahnya seimbang, dan nyaman untuk duduk seharian.
- Satu warna dari motif diambil jadi warna sepatu atau tas. Ini trik paling murah yang membuat satu set terlihat sengaja.

Aturan yang benar-benar berguna cuma satu: kalau motifnya ramai, sisanya polos.`,
  },
  {
    title: "Ukuran Baju Online: Ukur Badan Dulu, Baru Lihat Size Chart",
    handle: "ukur-badan-sebelum-belanja",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 7,
    published: true,
    excerpt: "Size chart tidak berguna kalau Anda tidak tahu angka badan sendiri.",
    src: "dress-midi-bunga.webp",
    body: `"Biasanya saya M" adalah alasan nomor satu baju online tidak muat. M di satu toko bukan M di toko lain — tidak ada standar nasional untuk itu.

Yang bisa diandalkan cuma angka badan Anda sendiri. Butuh meteran kain dan lima menit:

- Lingkar dada: ukur di bagian paling penuh, meteran datar, jangan ditarik kencang.
- Lingkar pinggang: di bagian paling ramping, biasanya sejengkal di atas pusar.
- Lingkar pinggul: di bagian paling lebar.
- Panjang badan: dari titik bahu tertinggi sampai batas yang Anda mau.

Catat sekali di ponsel, pakai selamanya. Lalu cocokkan ke size chart tiap toko — bukan ke huruf.

Kalau angka Anda jatuh di antara dua ukuran, naik satu. Baju kebesaran bisa dipermak; kekecilan tidak bisa apa-apa.`,
  },
  {
    title: "Merawat Kain Rayon: Adem, Jatuh, dan Gampang Kusut",
    handle: "merawat-kain-rayon",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 10,
    published: true,
    excerpt: "Rayon nyaman dipakai di cuaca Indonesia — asal tahu cara menyimpannya.",
    src: "tunik-rayon.webp",
    body: `Rayon disukai karena adem dan jatuhnya bagus di badan. Kelemahannya dua: gampang kusut, dan melemah saat basah.

Karena melemah saat basah, jangan pernah menggantung rayon yang masih berat oleh air — seratnya akan memanjang dan bahu bajunya melar permanen.

Cara yang aman:
- Cuci tangan dengan air dingin, atau mesin dengan mode paling halus di dalam kantong cucian.
- Jangan diperas. Tekan dengan handuk untuk menyerap air.
- Jemur mendatar sampai setengah kering, baru digantung.
- Setrika saat masih sedikit lembap, suhu rendah. Rayon kering butuh suhu tinggi, dan suhu tinggi membuatnya mengkilap.

Simpan dengan digantung, bukan dilipat, kalau ada ruang. Lipatan yang lama pada rayon meninggalkan garis yang sulit hilang.`,
  },
  {
    title: "Hijab Voal: Kenapa Bisa Licin dan Bagaimana Mengakalinya",
    handle: "hijab-voal-tidak-licin",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 12,
    published: true,
    excerpt: "Bukan hijabnya yang salah — permukaannya memang dirancang halus.",
    src: "hijab-voal.webp",
    body: `Voal disukai karena ringan, adem, dan tidak menerawang. Tapi permukaannya halus, jadi mudah bergeser.

Yang membantu:
- Inner ciput berbahan katun, bukan satin. Katun memberi gesekan yang menahan hijab di tempatnya.
- Jarum pentul di titik yang menahan beban, bukan di titik yang terlihat.
- Setrika dulu. Voal yang kusut lebih licin daripada voal yang rata.

Untuk mencuci, perlakukan seperti kain halus lain: air dingin, tanpa pemutih, jangan diperas. Voal kering dalam hitungan menit, jadi tidak perlu dijemur seharian di bawah matahari yang justru memudarkan warnanya.`,
  },
  {
    title: "Bahan Katun, Rayon, atau Satin? Pilih Sesuai Cuaca",
    handle: "memilih-bahan-sesuai-cuaca",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 15,
    published: true,
    excerpt: "Di negara yang panas dan lembap, bahan menentukan nyaman atau tidaknya seharian.",
    src: "piyama-satin.webp",
    body: `Indonesia panas dan lembap. Bahan yang salah membuat baju bagus jadi tidak terpakai.

- Katun: menyerap keringat, kuat, gampang dirawat. Kusut, dan agak kaku sebelum beberapa kali cuci.
- Rayon: paling adem dan jatuhnya cantik. Gampang kusut, melemah saat basah.
- Satin: dingin saat menyentuh kulit, tapi tidak menyerap keringat. Bagus untuk piyama ber-AC, kurang cocok untuk aktivitas di luar.
- Linen: paling sejuk untuk siang hari. Kusutnya sudah jadi ciri khasnya — terima saja.

Untuk dipakai seharian di luar ruangan, katun atau linen. Untuk acara yang dingin dan butuh jatuh yang bagus, rayon atau satin.`,
  },
  {
    title: "Kulot: Kenapa Nyaman dan Cocok untuk Siapa",
    handle: "kulot-nyaman-untuk-siapa",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 18,
    published: true,
    excerpt: "Potongan lebar yang membuat duduk lama tidak terasa menyiksa.",
    src: "celana-kulot.webp",
    body: `Kulot bertahan bukan karena tren. Potongannya lebar dari pinggul ke bawah, jadi tidak menekan di posisi duduk — hal yang langsung terasa kalau Anda bekerja delapan jam di kursi.

Beberapa hal yang membuat kulot terlihat rapi, bukan longgar:
- Pinggang tepat di pinggang, bukan di pinggul. Ini yang membentuk garis tubuh.
- Panjang berhenti di bagian paling ramping betis. Panjang yang salah membuat kaki terlihat pendek.
- Atasan yang dimasukkan, atau yang berhenti di garis pinggang. Atasan panjang di atas kulot lebar menghilangkan pinggang sama sekali.

Bahan yang jatuh — rayon, tencel — bergerak mengikuti langkah. Bahan kaku membuat kulot terlihat seperti rok yang salah jahit.`,
  },
  {
    title: "Rok Plisket Tidak Perlu Disetrika — Kalau Menyimpannya Benar",
    handle: "menyimpan-rok-plisket",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 21,
    published: true,
    excerpt: "Menyetrika plisket justru menghilangkan lipatannya. Ada cara lain.",
    src: "rok-plisket.webp",
    body: `Lipatan pada rok plisket dibuat dengan panas di pabrik. Menyetrikanya di rumah, apalagi dengan suhu tinggi, justru meratakan lipatan yang jadi ciri khasnya.

Cara menyimpan yang mempertahankan lipatan:
- Gantung, jangan lipat. Lipatan silang membuat garis baru yang bukan bagian dari desain.
- Kalau harus dilipat, ikuti arah lipatan aslinya — gulung memanjang, jangan dilipat melintang.
- Setelah dicuci, gantung selagi lembap. Berat airnya sendiri akan menarik lipatannya kembali lurus.

Kalau sudah terlanjur kusut, gantung di kamar mandi saat mandi air panas. Uapnya melemaskan serat tanpa menyentuh lipatan.`,
  },
  {
    title: "Blazer Wanita: Satu Potong yang Membuat Semua Terlihat Rapi",
    handle: "blazer-membuat-rapi",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 24,
    published: true,
    excerpt: "Bahu yang pas lebih menentukan daripada ukuran badannya.",
    src: "blazer-wanita.webp",
    body: `Blazer yang pas mengubah kaus dan jeans jadi terlihat disiapkan. Blazer yang tidak pas terlihat seperti pinjaman.

Yang menentukan pas atau tidak, urut dari yang paling penting:
- Jahitan bahu berhenti tepat di ujung bahu Anda. Ini satu-satunya bagian yang mahal untuk dipermak — kalau salah, lewati.
- Lengan berhenti di pergelangan, memperlihatkan sedikit manset kalau pakai kemeja.
- Kancing bisa ditutup tanpa membentuk kerutan X di perut.

Panjang badan dan lebar pinggang bisa dipermak dengan murah. Bahu tidak. Beli yang bahunya benar, sisanya urusan penjahit.`,
  },
  {
    title: "Kemeja Oversized: Longgar yang Disengaja vs Kebesaran",
    handle: "kemeja-oversized-vs-kebesaran",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 28,
    published: true,
    excerpt: "Bedanya tipis, dan hampir semuanya ada di garis bahu.",
    src: "kemeja-oversized.webp",
    body: `Oversized adalah potongan yang dirancang longgar. Kebesaran adalah ukuran yang salah. Dari jauh mirip; dari dekat sangat berbeda.

Yang membedakan:
- Pada oversized, garis bahu memang diturunkan dengan sengaja, dan turunnya rata. Pada baju kebesaran, bahunya melorot tidak beraturan.
- Oversized tetap punya panjang lengan yang benar. Kebesaran, lengannya menelan tangan.
- Oversized dijahit dengan bahan yang cukup jatuh untuk menggantung rapi. Bahan kaku yang kebesaran menggembung.

Cara memakainya: kalau atasannya lebar, bawahannya ramping. Atau masukkan bagian depannya saja, supaya garis pinggang tetap kelihatan.`,
  },
  {
    title: "Baju Rajut Melar? Hampir Selalu karena Digantung",
    handle: "rajut-melar-karena-digantung",
    blog: "Tips & Panduan",
    author: "Sari Melati",
    daysAgo: 32,
    published: true,
    excerpt: "Gravitasi bekerja 24 jam pada serat yang bisa memanjang.",
    src: "cardigan-rajut.webp",
    body: `Rajut melar bukan karena bahannya jelek. Sembilan dari sepuluh kali, penyebabnya cara menyimpan.

Serat rajut saling mengait, bukan ditenun rapat. Digantung, berat bajunya sendiri menarik kaitan itu ke bawah — sepanjang hari, setiap hari. Setelah beberapa bulan, bahunya menjulur dan tidak bisa kembali.

Yang benar:
- Lipat, jangan gantung. Simpan di rak.
- Cuci dengan air dingin, jangan diperas.
- Keringkan mendatar di atas handuk, bentuk kembali selagi lembap.
- Kalau harus digantung sementara, lipat di bagian pinggang menyilang di hanger — bukan dimasukkan lewat leher.

Untuk bulu-bulu kecil yang muncul, pakai sisir khusus rajut. Jangan dicabut: itu menarik benang yang masih menyatu.`,
  },
  {
    title: "Jumpsuit: Nyaman Dipakai, Ribet di Satu Hal",
    handle: "jumpsuit-nyaman-tapi",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 36,
    published: true,
    excerpt: "Satu potong, selesai — sampai Anda perlu ke kamar kecil.",
    src: "jumpsuit-kulot.webp",
    body: `Jumpsuit menyelesaikan pertanyaan "atasan apa, bawahan apa" dalam satu potong. Itu daya tariknya, dan alasan ia bertahan.

Kelemahannya jujur saja: ke kamar kecil merepotkan. Karena itu, dua hal layak dicek sebelum membeli.

- Panjang torso. Ini yang paling sering salah dan tidak terlihat di foto. Kalau torso jumpsuit lebih pendek dari torso Anda, selangkangannya akan menarik ke atas sepanjang hari.
- Bukaan. Resleting belakang penuh jauh lebih praktis daripada kancing kecil di leher.

Untuk acara panjang di luar rumah, pilih yang bukaannya di depan atau yang berpinggang karet. Untuk duduk di kantor seharian, bahan yang jatuh dan tidak mudah kusut.`,
  },
  {
    title: "Khimar Instan: Praktis, dan Apa yang Dikorbankan",
    handle: "khimar-instan-praktis",
    blog: "Tips & Panduan",
    author: "Dewi Anggraini",
    daysAgo: 40,
    published: true,
    excerpt: "Cepat dipakai, tapi ukurannya tidak bisa disesuaikan.",
    src: "khimar-instan.webp",
    body: `Khimar instan dijahit jadi, tinggal dipakai. Tidak perlu jarum, tidak perlu waktu di depan cermin.

Yang dikorbankan adalah penyesuaian. Khimar segi empat bisa dilipat sesuai bentuk wajah dan tinggi badan; yang instan sudah punya ukuran tetap.

Karena itu, dua ukuran perlu dicek sebelum beli:
- Lingkar wajah. Terlalu sempit menekan pipi; terlalu longgar membuka bagian samping.
- Panjang jatuh. Ukur dari puncak kepala ke titik yang Anda mau di badan. Angka ini yang menentukan, bukan huruf S/M/L.

Untuk perawatan, cuci tangan dan jemur di tempat teduh. Bagian kerut atau pet biasanya bagian pertama yang rusak kalau diperas.`,
  },
  {
    // The DRAFT. Kept deliberately: `getArticles`/`getArticle` hard-filter `status='terbit'` because
    // publishing is a SECURITY boundary — an unpublished draft is unreleased merchant work and must
    // 404, not merely be missing from a list. Without one draft in the demo, nothing exercises that,
    // and a regression would be invisible. It also has no image, which is the other case worth
    // rendering: ArticleCard must show the brand tint, not a broken frame.
    title: "Koleksi Lebaran 2027 — Draf, Belum Tayang",
    handle: "koleksi-lebaran-draf",
    blog: "Berita Toko",
    author: "Ongki Pratama",
    daysAgo: 1,
    published: false,
    excerpt: "Catatan internal. Menunggu foto koleksi selesai sebelum diterbitkan.",
    src: "",
    body: `Draf. Belum tayang — menunggu sesi foto koleksi Lebaran selesai.

Kalau artikel ini terlihat oleh pembeli, ada yang salah dengan filter status di storefront.`,
  },
  {
    title: "Ongkir dan Estimasi Kirim Kini Tampil Langsung di Checkout",
    handle: "ongkir-tampil-di-checkout",
    blog: "Berita Toko",
    author: "Ongki Pratama",
    daysAgo: 45,
    published: true,
    excerpt: "Pilih kecamatan, lihat semua ekspedisi beserta ongkir dan perkiraan harinya.",
    src: "blazer-wanita-2.webp",
    body: `Sekarang ongkir muncul langsung di halaman checkout, dihitung dari alamat gudang kami ke kecamatan tujuan Anda.

Yang berubah:
- Pilih kecamatan, ongkir langsung muncul — tidak perlu tanya dulu lewat chat.
- Setiap layanan menampilkan perkiraan hari sampainya.
- Kalau ada ekspedisi yang lebih murah dari pilihan bawaan, kami tampilkan dan tandai.
- Buka "Pilih ekspedisi lain" untuk membandingkan semua kurir yang melayani rute Anda.

Ekspedisi yang tersedia berbeda-beda per daerah, karena tidak semua kurir menjangkau semua kecamatan. Yang muncul di layar Anda adalah yang benar-benar bisa mengantar ke sana.`,
  },
];

async function makeImage(d: Draft, storeId: string): Promise<string> {
  const src = path.join(PRODUCTS_DIR, d.src);
  const input = await fs.readFile(src);
  // Crop to the card's 3:2 rather than letterboxing: ArticleCard locks aspect-[3/2] and
  // object-cover, so anything else would be cropped by CSS anyway — better to do it once, here,
  // and ship fewer bytes than the browser throws away.
  const out = await sharp(input)
    .resize({ width: CARD_W, height: CARD_H, fit: "cover", position: "attention", withoutEnlargement: false })
    .webp({ quality: 82 })
    .toBuffer();
  const name = `jurnal-${d.handle}.webp`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), out);
  const meta = await sharp(out).metadata();
  const url = `/api/uploads/${name}`;

  // Register in the media library — this is the whole point: the demo's images must be things the
  // merchant could have uploaded, and Files is where uploads live.
  await db.delete(schema.media).where(and(eq(schema.media.storeId, storeId), eq(schema.media.url, url)));
  await db.insert(schema.media).values({
    storeId,
    url,
    filename: name,
    mime: "image/webp",
    sizeBytes: out.length,
    width: meta.width ?? null,
    height: meta.height ?? null,
  });
  return url;
}

async function main() {
  const [store] = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.slug, DEMO_SLUG)).limit(1);
  if (!store) {
    console.log(`seed-journal: no store "${DEMO_SLUG}" — nothing to do.`);
    await client.end();
    return;
  }

  const blogs = await db.select({ id: schema.blogs.id, title: schema.blogs.title }).from(schema.blogs).where(eq(schema.blogs.storeId, store.id));
  const blogId = (t: string) => blogs.find((b) => b.title === t)?.id;
  const missing = [...new Set(DRAFTS.map((d) => d.blog))].filter((t) => !blogId(t));
  if (missing.length) {
    // Fail loudly rather than silently dropping articles: a journal that seeds 11 of 15 and says
    // "done" is exactly the kind of success message this repo has been burned by.
    console.error(`seed-journal: blog kategori tidak ada di DB: ${missing.join(", ")}. Jalankan seed.ts dulu.`);
    await client.end();
    process.exitCode = 1;
    return;
  }

  // Delete ALL of the demo's articles, not just the handles below.
  //
  // Deleting only our own handles left seed.ts's 6 originals alongside these 15 — 21 articles, of
  // which 6 still pointed at `/products/*.webp` and were absent from the media library. Two seeds
  // owning one table is how the journal ends up half-migrated and nobody notices which half they are
  // looking at. **This file owns the demo's journal.** seed.ts still writes its 6 on a fresh seed;
  // this runs after and replaces them (the compose chain orders it that way), exactly like
  // seed-templates.ts owns the homepage.
  await db.delete(schema.articles).where(eq(schema.articles.storeId, store.id));

  let bytes = 0;
  let images = 0;
  for (const d of DRAFTS) {
    // `src: ""` = no featured image, which is a real state the storefront must render (brand tint,
    // not a broken frame). Do not "fix" this by giving every article a picture.
    const url = d.src ? await makeImage(d, store.id) : null;
    if (url) {
      images++;
      bytes += (await fs.stat(path.join(UPLOAD_DIR, `jurnal-${d.handle}.webp`))).size;
    }
    await db.insert(schema.articles).values({
      storeId: store.id,
      blogId: blogId(d.blog)!,
      title: d.title,
      handle: d.handle,
      body: d.body,
      excerpt: d.excerpt,
      author: d.author,
      imageUrl: url,
      status: d.published ? "terbit" : "draft",
      publishedAt: d.published ? new Date(TODAY.getTime() - d.daysAgo * 86_400_000) : null,
      comments: 0,
    });
  }

  console.log(
    `seed-journal: ${store.name} → ${DRAFTS.length} artikel (${DRAFTS.filter((d) => d.published).length} terbit, ` +
      `${DRAFTS.filter((d) => !d.published).length} draf), ${images} gambar WebP ${CARD_W}x${CARD_H} → media library ` +
      `(${(bytes / 1024).toFixed(0)} KB total, rata-rata ${(bytes / images / 1024).toFixed(0)} KB).`,
  );
  await client.end();
}

main();
