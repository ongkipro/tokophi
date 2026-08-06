import { cn } from "../../lib/utils";

/**
 * TANDA MERKNYA ADALAH KATANYA — dan Φ-nya sudah jadi ikon.
 *
 * ── KENAPA UBINNYA DIBUANG ──────────────────────────────────────────────────────────────────────
 *
 * Ada tiga tanda merk di repo ini dan dua di antaranya mengatakan hal yang sama dua kali:
 *
 *  · `apps/landing` menggambar **Φ sebagai SVG** di dalam ubin, lalu menulis "TokoΦ" tepat di
 *    sebelahnya. Huruf yang sama, dua kali, berdampingan.
 *  · `apps/admin` memakai ikon **`Store` dari lucide** — bentuk paling template yang bisa dipilih,
 *    dan ia tak berhubungan sama sekali dengan Φ yang jadi nama produknya.
 *
 * Sebuah wordmark yang sudah memuat karakter tak biasa tidak perlu ikon di sebelahnya untuk
 * dikenali; ikon itu justru melemahkannya, karena mata berhenti di kotak berwarna dan bukan di
 * namanya. Yang dibuang: ubin, bayangannya, dan dua bentuk yang berbeda-beda per permukaan. Yang
 * tersisa: satu kata, dengan **Φ** memakai warna merk.
 *
 * ⚠️ `leading-tight`, JANGAN `leading-none`. Φ (U+03A6) naik melewati tinggi kapital Latin, dan
 * line-height tepat 1 memotong ujung atasnya — pelajaran yang sudah dibayar di `brand.tsx` dan
 * dibawa ke sini supaya tidak dibayar lagi.
 *
 * SATU implementasi untuk kedua panel React. `apps/landing` adalah Astro dan tak bisa meng-import
 * komponen React, jadi ia menyalin markup-nya dengan komentar yang menunjuk ke berkas ini — satu-
 * satunya salinan yang disengaja, dan alasannya tertulis di sana.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold leading-tight tracking-[-0.02em]", className)}>
      Toko<span className="text-primary">Φ</span>
    </span>
  );
}
