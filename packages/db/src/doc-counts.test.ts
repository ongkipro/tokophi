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
