import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMillisecondStamp, MS_CEIL, MS_FLOOR } from "./migration-stamp";

// Penjaga ini lahir dari kegagalan penjaga lain. `verify-migrations` memeriksa bahwa stempel NAIK,
// dan itu meloloskan `0096` dengan `when = 1787135109197478972` (nanodetik, 19 digit) tanpa sepatah
// kata pun — stempel yang, begitu tercatat di sebuah database, membuat SETIAP migrasi berikutnya
// dilewati diam-diam. Yang menangkapnya waktu itu adalah mata manusia yang kebetulan membaca
// angkanya sebelum commit. Itu bukan penjaga; ini penjaganya.

const journalPath = new URL("../drizzle/meta/_journal.json", import.meta.url).pathname;
const entries: Array<{ tag: string; when: number }> = JSON.parse(readFileSync(journalPath, "utf8")).entries;

describe("stempel journal adalah milidetik", () => {
  it("membaca journal yang sebenarnya (penjaga yang memindai nol entri hijau selamanya)", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it("SETIAP entri di journal hari ini berskala milidetik", () => {
    const salah = entries
      .filter((e) => !isMillisecondStamp(e.when))
      .map((e) => `${e.tag}=${e.when} (${String(e.when).length} digit)`);
    expect(
      salah,
      "stempel berskala salah akan membuat migrasi SESUDAHNYA dilewati diam-diam oleh drizzle",
    ).toEqual([]);
  });

  // 🔴 Mutasi yang benar-benar terjadi, bukan yang dibayangkan.
  it("menolak stempel nanodetik yang pernah ditulis untuk 0096", () => {
    expect(isMillisecondStamp(1787135109197478972)).toBe(false);
  });

  it("menolak stempel DETIK — arah kesalahan yang sebaliknya", () => {
    expect(isMillisecondStamp(1787135123)).toBe(false);
  });

  it("menerima Date.now() dan stempel nyata terakhir", () => {
    expect(isMillisecondStamp(Date.now())).toBe(true);
    expect(isMillisecondStamp(entries.at(-1)!.when)).toBe(true);
  });

  it("batasnya inklusif di bawah, eksklusif di atas", () => {
    expect(isMillisecondStamp(MS_FLOOR)).toBe(true);
    expect(isMillisecondStamp(MS_FLOOR - 1)).toBe(false);
    expect(isMillisecondStamp(MS_CEIL - 1)).toBe(true);
    expect(isMillisecondStamp(MS_CEIL)).toBe(false);
  });

  it("menolak yang bukan bilangan bulat: pecahan, NaN, string, null", () => {
    for (const buruk of [1787135123807.5, NaN, Infinity, "1787135123807", null, undefined]) {
      expect(isMillisecondStamp(buruk), String(buruk)).toBe(false);
    }
  });
});
