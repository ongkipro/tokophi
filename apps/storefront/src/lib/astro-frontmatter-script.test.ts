import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ── TAG SKRIP LITERAL DI FRONTMATTER `.astro` MERUSAK PEMINDAI DEPENDENSI VITE ───────────────────
//
// Vite mengambil wilayah skrip dari sebuah `.astro` dengan pencocokan naif yang TIDAK menghormati
// komentar `//`. Sebuah tag pembuka literal di frontmatter karena itu membuka wilayah yang baru
// ditutup oleh `</script>` sungguhan berikutnya — seluruh template di antaranya diserahkan ke esbuild
// sebagai TypeScript. Yang keluar adalah galat yang tak menyebut sebabnya sama sekali:
// `Failed to scan for dependencies` + `Expected ";" but found "onerror"`.
//
// ⚠️ INI SUDAH TERJADI DUA KALI, DAN KEDUA KALINYA LEWAT KOMENTAR YANG MEMPERINGATKANNYA.
// `lp/[slug].astro` sudah memuat catatan panjang "jangan tulis tag pembuka literal di komentar
// frontmatter ini" — yang ditulis MEMAKAI tag literal itu, dua kali. Ditambah satu lagi di
// `produk/[handle].astro`, jadinya tiga, dan setiap `astro dev` dingin mencetak galat esbuild yang
// tak berhubungan dengan apa pun yang sedang dikerjakan orang. Sebuah aturan yang hanya hidup sebagai
// prosa akan dilanggar oleh prosa berikutnya; ini menjadikannya bisa dijalankan.
//
// ⚠️ SENGAJA MEMBACA TEKS MENTAH, BUKAN `codeOnly()`. Aturan repo ini biasanya "sebuah penjaga membaca
// KODE, tak pernah TEKS" — di sini justru kebalikannya yang benar: yang keliru adalah PEMINDAI yang
// membaca berkas ini secara harfiah, komentar dan semuanya. Meng-inert-kan komentar akan membuat
// penjaga ini buta terhadap satu-satunya bentuk cacat yang pernah terjadi.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

/** Frontmatter hanya ada bila baris PERTAMA persis `---`; berkas tanpa itu seluruhnya template. */
function frontmatterOf(src: string): string {
  const lines = src.split("\n");
  if (lines[0].trim() !== "---") return "";
  const end = lines.indexOf("---", 1);
  return end === -1 ? "" : lines.slice(1, end).join("\n");
}

describe("frontmatter .astro tidak memuat tag skrip literal", () => {
  const files = execFileSync("git", ["ls-files", "-z", "*.astro"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

  it("menemukan berkas .astro untuk diperiksa", () => {
    // Tanpa ini, sebuah glob yang salah membuat suite lolos karena tak memeriksa apa pun.
    expect(files.length).toBeGreaterThan(20);
  });

  // ⚠️ Batas waktu eksplisit. Penjaga yang menyapu seluruh repo memanggil `git ls-files` lalu membaca
  // ratusan berkas; di bawah `npm test` penuh (delapan worker paralel, page cache dingin) itu bisa
  // melewati batas bawaan vitest 5 detik dan MERAH tanpa ada yang rusak. Dua saudaranya sudah pernah:
  // `packages/lib/src/store-slug.test.ts` dan `packages/lib/src/session-cookie.test.ts`, keduanya lolos
  // ~1 detik saat dijalankan sendirian. Penjaga yang kadang merah tanpa sebab adalah penjaga yang orang
  // belajar abaikan — persis bagaimana `verify-rls` merah berminggu-minggu dan dua kebocoran lintas
  // tenant lolos di belakangnya.
  it("tak satu pun frontmatter memuat `<script`", { timeout: 30_000 }, () => {
    const offenders = files.filter((f) => /<\/?script/i.test(frontmatterOf(readFileSync(path.join(REPO_ROOT, f), "utf8"))));
    expect(offenders, `Tulis kata "script" tanpa kurung sudut di komentar frontmatter: ${offenders.join(", ")}`).toEqual([]);
  });

  it("memang merah pada bentuk yang dulu dikirim", () => {
    // Diuji pada SALINAN, bukan sumber produk: sebuah penjaga yang tak pernah dibuktikan merah bisa
    // hijau karena tak mencocokkan apa pun — kesalahan yang sudah pernah terjadi di repo ini.
    const mutated = ['---', '// The switcher <script> is a no-op in grid mode', 'const a = 1;', '---', '<div>{a}</div>'].join("\n");
    expect(/<\/?script/i.test(frontmatterOf(mutated))).toBe(true);
    const clean = ['---', '// The switcher script is a no-op in grid mode', 'const a = 1;', '---', '<script>console.log(1)</script>'].join("\n");
    expect(/<\/?script/i.test(frontmatterOf(clean))).toBe(false);
  });
});
