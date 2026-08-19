/**
 * Apakah sebuah `when` di journal drizzle benar-benar stempel MILIDETIK?
 *
 * Modul terpisah dan MURNI dengan sengaja: `verify-migrations.ts` mengerjakan I/O di level atas
 * (membaca journal, menyentuh database), jadi sebuah test yang meng-import-nya akan ikut
 * menjalankannya. Pemisahan yang sama dengan `platform-rank.ts` dan `store-servable.ts`, dan untuk
 * alasan yang sama: aturan yang menjaga sesuatu harus bisa dipanggil tanpa efek samping.
 *
 * 🔴 KENAPA INI ADA. Diukur 2026-08-19: `0096` sempat ditulis dengan stempel
 * **1787135109197478972** — `date +%s%3N` mengembalikan NANOdetik. Pemeriksaan "stempel harus naik"
 * meloloskannya tanpa ragu, karena 1,79e18 memang naik. Biayanya persis bahaya yang `AGENTS.md`
 * sudah namai: drizzle hanya menerapkan entri yang `when`-nya melebihi stempel terbaru di database
 * tujuan — jadi begitu satu stempel nanodetik mendarat, SETIAP migrasi berikutnya yang ditulis
 * dengan milidetik biasa akan dilewati DIAM-DIAM, sambil mencetak "migrations applied successfully".
 *
 * Skala yang salah tidak mungkin terlihat oleh pemeriksaan monotonisitas — ia butuh klaimnya sendiri.
 */

/** 13 digit. Apa pun yang lebih pendek adalah DETIK, bukan milidetik. (2001-09-09 UTC) */
export const MS_FLOOR = 1_000_000_000_000;

/** 15 digit. Apa pun sepanjang ini atau lebih adalah mikro/nanodetik. (tahun ~5138) */
export const MS_CEIL = 100_000_000_000_000;

/**
 * Jendelanya sengaja longgar, bukan pintar: setiap milidetik dari 2001 sampai abad ke-51 lolos,
 * sehingga tidak ada yang perlu menyentuh berkas ini saat jam terus berjalan. Yang ditolak adalah
 * SKALA yang keliru — detik (10 digit) dan nanodetik (19 digit) — bukan tanggal yang tidak disukai.
 */
export function isMillisecondStamp(when: unknown): when is number {
  return typeof when === "number" && Number.isInteger(when) && when >= MS_FLOOR && when < MS_CEIL;
}
