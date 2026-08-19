import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── ANGKA YANG DITERBITKAN DOKUMEN HARUS SAMA DENGAN YANG DIHITUNG DARI KODE ─────────────────────
//
// Empat dokumen menerbitkan jumlah tabel, dan pada 2026-08-07 ketiganya salah DAN saling bertentangan:
// `AGENTS.md` 54 · `STATUS.md` 72 · `CODE_MAP.md` 68 · `SCHEMA.md` 68 — sementara kodenya 78. Jumlah
// migrasinya bertiga pun berbeda (64 · 84 · 46) padahal jurnalnya 92. Cakupan RLS terbit sebagai
// "45 dari 46" dan "36/39" di SATU berkas yang sama, sepuluh baris berjauhan, sementara `SECURITY.md`
// sudah menulis angka yang benar.
//
// Yang membuatnya layak dijadikan penjaga, bukan sekadar disapu sekali: `SCHEMA.md` MEMBUKA dirinya
// dengan pengakuan "prior versions claimed 57 tables and RLS on 32. Both were wrong" — lalu tetap
// menerbitkan angka yang salah sampai hari ini. Sebuah dokumen yang tahu dirinya membusuk tetap
// membusuk. Satu-satunya yang tidak membusuk adalah yang dijalankan.
//
// ⚠️ INI MEMBACA TEKS MENTAH, DAN MEMANG SEHARUSNYA. Klaimnya adalah tentang apa yang DIBACA MANUSIA
// di dokumen itu — bukan tentang kode yang dieksekusi — jadi `codeOnly()` justru akan menghapus
// satu-satunya hal yang sedang diperiksa.
//
// ⚠️ Sengaja TIDAK memeriksa cakupan RLS. Angka itu hanya bisa diturunkan dengan menanyai Postgres,
// dan penjaga yang butuh database akan MELEWAT (skip) di mesin tanpa Docker — yaitu diam persis saat
// ia paling dibutuhkan. Dokumen-dokumen itu kini menyuruh pembacanya menjalankan `verify-rls` dan
// mempercayai keluarannya; ITU jaringan pengamannya, dan ia sudah berjalan di CI.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const TABLES = (read("packages/db/src/schema.ts").match(/pgTable\(/g) ?? []).length;
const ENUMS = (read("packages/db/src/schema.ts").match(/pgEnum\(/g) ?? []).length;
const MIGRATIONS = (JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: unknown[] }).entries.length;

/** Berkas → angka yang WAJIB muncul di dalamnya. Menambah dokumen baru = menambah satu baris di sini. */
const PUBLISHED: Array<{ file: string; must: Array<[label: string, value: number]> }> = [
  { file: "AGENTS.md", must: [["jumlah tabel", TABLES], ["jumlah migrasi", MIGRATIONS]] },
  { file: "specs/docs/STATUS.md", must: [["jumlah tabel", TABLES], ["jumlah migrasi", MIGRATIONS]] },
  { file: "specs/docs/CODE_MAP.md", must: [["jumlah tabel", TABLES], ["jumlah migrasi", MIGRATIONS]] },
  { file: "specs/docs/SCHEMA.md", must: [["jumlah tabel", TABLES], ["jumlah migrasi", MIGRATIONS], ["jumlah enum", ENUMS]] },
];

// ⚠️ "ANGKANYA MUNCUL DI SUATU TEMPAT" TIDAK CUKUP — DIUKUR 2026-08-19.
// Ketika `0095` mendarat, EMPAT dokumen masih menerbitkan "95 migrasi / head 0094". Yang merah hanya
// `CODE_MAP.md`; `AGENTS.md` dan `SCHEMA.md` LOLOS karena kebetulan memuat angka 96 di kalimat lain
// (tabel riwayat, catatan lama), sementara kalimat headline-nya tetap berbohong. Penjaga yang hijau
// di atas kalimat basi persis kelas kegagalan yang berkas ini ada untuk menutupnya.
//
// Maka klaimnya diikat ke KALIMATNYA, bukan ke keberadaan angka: setiap entri di bawah menamai
// kalimat headline yang dokumen itu pakai untuk menerbitkan hitungan. Kalau kalimatnya ditulis
// ulang, pola ini berhenti cocok dan penjaganya merah — itu DISENGAJA: yang perlu diperbarui adalah
// jangkarnya, di sini, sadar, bukan angkanya diam-diam menua di sana.
const ANCHORS: Array<{ file: string; what: string; pattern: (n: { tables: number; migrations: number; head: string }) => RegExp }> = [
  {
    file: "AGENTS.md",
    what: "kalimat headline SCHEMA di paragraf Database",
    pattern: (n) => new RegExp(`\\*\\*${n.tables} tables · ${n.migrations} migrations \`0000\`–\`${n.head}\`\\*\\*`),
  },
  {
    file: "specs/docs/SCHEMA.md",
    what: "baris Migrasi di tabel Headline numbers",
    pattern: (n) => new RegExp(`\\| Migrasi \\| \\*\\*${n.migrations}\\*\\* \\(\`0000\` … \`${n.head}\`\\)`),
  },
  {
    file: "specs/docs/CODE_MAP.md",
    what: "sel paket `db` + baris head migrasi",
    pattern: (n) => new RegExp(`migrations/\` \\(\\*\\*0000–${n.head}\\*\\*, ${n.migrations} files\\)`),
  },
  {
    file: "specs/docs/CODE_MAP.md",
    what: "baris head migrasi",
    pattern: (n) => new RegExp(`current head \\*\\*${n.head}\\*\\*`),
  },
  {
    file: "specs/docs/STATUS.md",
    what: "kalimat Data/security status",
    pattern: (n) => new RegExp(`${n.migrations}-entry migration journal`),
  },
];

/** Tag migrasi terakhir → "0095". Diturunkan, tidak pernah ditulis tangan. */
const HEAD = (JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: Array<{ tag: string }> })
  .entries.at(-1)!.tag.slice(0, 4);

describe("kalimat headline-nya sendiri yang membawa angka itu", () => {
  const numbers = { tables: TABLES, migrations: MIGRATIONS, head: HEAD };

  it("menurunkan head migrasi dari jurnal", () => {
    expect(HEAD).toMatch(/^\d{4}$/);
    expect(Number(HEAD)).toBe(MIGRATIONS - 1); // 0-indexed: 96 entri ⇒ head 0095
  });

  for (const { file, what, pattern } of ANCHORS) {
    it(`${file} — ${what}`, () => {
      expect(
        pattern(numbers).test(read(file)),
        `${file}: ${what} tidak menerbitkan angka yang benar (${MIGRATIONS} migrasi, head ${HEAD}). ` +
          `Perbaiki kalimatnya — atau, kalau kalimatnya memang berubah bentuk, perbarui jangkarnya di ANCHORS. ` +
          `Jangan melonggarkan polanya supaya hijau.`,
      ).toBe(true);
    });
  }

  it("merah bila HANYA kalimat headline yang basi meski angka benarnya ada di tempat lain", () => {
    // Mutasi yang dulu LOLOS: kalimat headline mundur satu versi sementara angka yang benar tetap
    // ada di paragraf lain pada berkas yang sama. Pemeriksaan lama hijau; yang ini harus merah.
    const stale = read("AGENTS.md")
      .replace(`${TABLES} tables · ${MIGRATIONS} migrations`, `${TABLES} tables · ${MIGRATIONS - 1} migrations`)
      .concat(`\n\nCatatan lain yang kebetulan menyebut ${MIGRATIONS}.\n`);
    expect(ANCHORS[0].pattern(numbers).test(stale)).toBe(false);
  });
});

describe("angka yang diterbitkan dokumen cocok dengan kode", () => {
  it("berhasil menurunkan angkanya dari kode", () => {
    // Tanpa ini, sebuah regex yang meleset membuat SELURUH suite lolos dengan membandingkan 0 dengan 0.
    expect(TABLES).toBeGreaterThan(50);
    expect(MIGRATIONS).toBeGreaterThan(50);
    expect(ENUMS).toBeGreaterThan(20);
  });

  for (const { file, must } of PUBLISHED) {
    for (const [label, value] of must) {
      it(`${file} menyebut ${label} = ${value}`, () => {
        const src = read(file);
        // Angka utuh: "78" cocok, "780" dan "178" tidak.
        const found = new RegExp(`(?<![\\d.])${value}(?![\\d.])`).test(src);
        expect(
          found,
          `${file} tidak memuat ${value} untuk ${label}. Entah dokumennya basi — perbaiki angkanya — ` +
            `atau kalimatnya ditulis ulang sehingga angkanya hilang, dan penjaga ini yang perlu jangkar baru. ` +
            `Jangan lemahkan pemeriksaannya untuk menghijaukannya.`,
        ).toBe(true);
      });
    }
  }

  it("merah bila dokumennya basi", () => {
    // Dibuktikan pada string, bukan pada berkas produk: sebuah penjaga yang tak pernah dibuktikan merah
    // bisa hijau karena tak mencocokkan apa pun — kesalahan yang sudah pernah terjadi di repo ini.
    const stale = "Local dev uses Drizzle (schema mirrors SCHEMA.md: **54 tables**).";
    expect(new RegExp(`(?<![\\d.])${TABLES}(?![\\d.])`).test(stale)).toBe(false);
    expect(new RegExp(`(?<![\\d.])54(?![\\d.])`).test(stale)).toBe(true);
  });
});
