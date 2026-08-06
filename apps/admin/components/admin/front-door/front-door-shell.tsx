import Link from "next/link";
import { AddressPlate } from "./address-plate";

/**
 * PINTU DEPAN Seller — kerangka bersama `/login` dan `/daftar`.
 *
 * ── APA YANG DIUKUR SEBELUM MERANCANG (2026-08-06, di browser) ──────────────────────────────────
 *
 * Halaman lama: kartu 384px di tengah, `box-shadow: none`, di atas latar yang warnanya SAMA PERSIS
 * dengan kartunya (`lab(100 0 0)` keduanya) — jadi ia bukan permukaan, cuma persegi bergaris rambut.
 * Pada 1440×900, ±85% layar kosong. `h1` "TokoΦ" 24px/berat 500 — yaitu ukuran dan berat yang sama
 * dengan teks biasa: tak ada suara display sama sekali. Tombol utama halaman ini setinggi **32px**,
 * tinggi tombol baris tabel.
 *
 * ── TIGA KEPUTUSAN, DAN ALASANNYA ───────────────────────────────────────────────────────────────
 *
 * ① **Belah, bukan di tengah.** Layar login yang seluruh isinya satu kartu di tengah adalah bentuk
 *    yang muncul di mana saja; ia tidak mengatakan apa pun tentang produk ini. Kolomnya sengaja
 *    TIDAK 50/50 (46/54) — simetri sempurna terbaca seperti template.
 *
 * ② **Suara display dibuat dari SKALA + TRACKING, bukan dari font baru.** `--font-heading` di repo
 *    ini ternyata alias `--font-sans` (Geist), jadi judul memang tak pernah punya suara sendiri.
 *    Menambah font display berarti satu permintaan jaringan lagi di halaman pertama yang dilihat
 *    orang — repo ini bahkan men-self-host Inter di storefront demi LCP. Jadi: Geist, 600, tracking
 *    -0.03em, ukuran yang berani. Suara baru, nol byte tambahan.
 *
 * ③ **Geist Mono sudah dimuat dan tak dipakai di sini.** Artefak yang dituju halaman ini adalah
 *    sebuah HOSTNAME (`nama-toko.tokophi.id`) — benda yang memang hidup dalam huruf monospace.
 *    Itulah peran ketiga yang dipakai: alamat, bukan hiasan.
 *
 * ── YANG SENGAJA TIDAK DIPAKAI ──────────────────────────────────────────────────────────────────
 *
 * 🚫 Angka sosial ("1.200 toko aktif") — produksi memegang SATU toko. Aturan repo ini keras soal
 *    itu: angka tanpa sumber ditulis "—", tak pernah dikarang. Maka panel kanan memuat KEMAMPUAN
 *    yang bisa dicek di kode, bukan popularitas yang tak bisa.
 * 🚫 Glassmorphism dan glow ungu — dua kelisyean paling khas UI buatan AI, dan halaman login tak
 *    punya kedalaman untuk dikaburkan.
 * 🚫 Ilustrasi/maskot — aksesori yang dibuang supaya plat alamat tetap satu-satunya yang diingat.
 */
export function FrontDoorShell({
  eyebrow,
  title,
  lead,
  slug,
  claimable = false,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  /** Slug awal untuk plat alamat; `/daftar` menimpanya per ketikan lewat `AddressPlate`. */
  slug?: string;
  /**
   * `true` HANYA di `/daftar`. Di `/login` platnya adalah ILUSTRASI, bukan kolom yang sedang diisi —
   * kursor berkedip di sana berbohong tentang apa yang sedang terjadi: orang yang datang ke /login
   * sudah punya alamatnya, ia tidak sedang memilih satu.
   */
  claimable?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[46fr_54fr]">
      {/* ── kiri: formulir ─────────────────────────────────────────────────────────────────── */}
      <main className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-[26rem] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <Link
            href="/login"
            className="inline-flex items-baseline rounded-md text-lg font-semibold tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            Toko<span className="text-primary">Φ</span>
          </Link>

          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          {/* Satu-satunya `h1` halaman ini — lantai a11y yang dijaga `admin-h1-floor.test.ts`. */}
          <h1 className="mt-2 text-[clamp(1.75rem,3.4vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.035em]">{title}</h1>
          <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{lead}</p>

          <div className="mt-7">{children}</div>

          <div className="mt-7 border-t pt-5 text-sm text-muted-foreground">{footer}</div>
        </div>
      </main>

      {/* ── kanan: yang sedang diklaim ──────────────────────────────────────────────────────────
          Disembunyikan di bawah `lg` dan itu keputusan, bukan kemalasan: pasar ini mayoritas
          Android, dan pintu depan tidak boleh menyuruh orang menggulir melewati panel pemasaran
          untuk sampai ke kolom kata sandi. Di ponsel, formulir adalah halamannya. */}
      <aside className="relative hidden overflow-hidden bg-[oklch(0.21_0.035_265)] px-14 py-16 text-white lg:flex lg:flex-col lg:justify-center">
        {/* Kisi tipis — tekstur, bukan gambar: nol byte, dan ia menyiratkan bidang yang bisa diisi,
            yang persis pekerjaan sebuah toko. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative">
          <AddressPlate initialSlug={slug} claimable={claimable} />

          <ul className="mt-11 space-y-5 text-[0.9375rem] leading-relaxed text-white/70">
            {/* Setiap baris di bawah ini BISA DICEK di kode. Tak ada satu pun angka yang dikarang. */}
            <ProofLine k="Ongkir">
              Dihitung dari <span className="text-white">alamat penjemputanmu</span>, bukan tebakan nama kota.
            </ProofLine>
            <ProofLine k="COD">
              Bayar di tempat lewat SPX, dengan batas nilai dan wilayah yang diatur platform.
            </ProofLine>
            <ProofLine k="Pembeli">
              Pesanan dan pemulihan keranjang jalan lewat <span className="text-white">WhatsApp</span>.
            </ProofLine>
            <ProofLine k="Biaya">
              Gratis 3 hari. Tanpa kartu kredit — bayar setelah masa coba habis.
            </ProofLine>
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Label kiri dalam mono, isi di kanan: struktur yang mengaku bahwa ini daftar fakta, bukan slogan. */
function ProofLine({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-4">
      <span className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">{k}</span>
      <span>{children}</span>
    </li>
  );
}
