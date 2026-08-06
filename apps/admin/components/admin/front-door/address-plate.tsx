"use client";
import * as React from "react";
import { slugify } from "@tokophi/lib/store-slug";

/** Nama event yang dipancarkan formulir daftar tiap kali nama toko berubah. */
export const STORE_NAME_EVENT = "tokophi:store-name";

/**
 * PLAT ALAMAT — satu-satunya hal yang dirancang untuk diingat dari halaman ini.
 *
 * Ia bukan hiasan: `<slug>.tokophi.id` adalah **alamat publik permanen** toko itu, dan slug-nya
 * dihitung oleh `@tokophi/lib/store-slug` — fungsi YANG SAMA yang dipakai server saat menulis
 * `stores.slug`. Jadi plat ini tidak bisa menjanjikan alamat yang nanti dieja berbeda oleh server:
 * "Café Senja" → `cafe-senja`, bukan `caf-senja`. Itu sebabnya ia layak jadi elemen utama — ia satu
 * -satunya bagian halaman yang mengajarkan sesuatu yang benar tentang apa yang sedang diklaim.
 *
 * ⚠️ Ia mendengar lewat EVENT, bukan lewat prop. Formulirnya ada di kolom kiri dan platnya di kolom
 * kanan, dua cabang React yang berbeda di bawah satu Server Component; mengangkat state ke atas
 * berarti mengubah seluruh kerangka jadi client component — seluruh pintu depan ikut terkirim
 * sebagai JavaScript demi satu baris teks. Satu `CustomEvent` lebih murah dan tidak menular.
 */
export function AddressPlate({ initialSlug, claimable = false }: { initialSlug?: string; claimable?: boolean }) {
  const [slug, setSlug] = React.useState(initialSlug ?? "");

  React.useEffect(() => {
    const onName = (e: Event) => setSlug(slugify((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener(STORE_NAME_EVENT, onName);
    return () => window.removeEventListener(STORE_NAME_EVENT, onName);
  }, []);

  const typed = slug.length > 0;

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">{claimable ? "Alamat tokomu" : "Alamat toko di TokoΦ"}</p>
      <div className="mt-3 flex items-baseline gap-px overflow-hidden rounded-lg border border-white/12 bg-white/[0.04] px-4 py-3.5 font-mono text-[clamp(0.95rem,1.5vw,1.15rem)]">
        {/* Bagian yang DIMILIKI merchant terang; domain induk redup — hierarki itu memberi tahu
            bagian mana yang sedang mereka pilih tanpa satu kata penjelasan pun. */}
        <span className={typed ? "truncate text-white" : "truncate text-white/35"}>{typed ? slug : "nama-toko"}</span>
        <span className="shrink-0 text-white/35">.tokophi.id</span>
        {/* Kursor hanya berkedip saat belum ada yang diketik: sesudah terisi ia jadi kebisingan,
            dan `motion-reduce` mematikannya sepenuhnya. */}
        {claimable && !typed && (
          <span aria-hidden className="ml-0.5 h-[1.1em] w-px shrink-0 bg-white/60 motion-safe:animate-pulse motion-reduce:hidden" />
        )}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-white/45">
        {claimable
          ? "Toko kamu tayang di alamat ini. Bisa dipakai domain sendiri belakangan."
          : "Setiap toko punya alamatnya sendiri, dan bisa dipindah ke domain sendiri."}
      </p>
    </div>
  );
}
