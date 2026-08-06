import Link from "next/link";
import { FrontDoorShell, MARKETING_HOME } from "@/components/admin/front-door/front-door-shell";
import { googleEnabled } from "@/lib/google";
import { signupOpen } from "@/lib/provision";
import { DaftarForm } from "./daftar-form";

const NOTICES: Record<string, string> = {
  google_gagal: "Gagal mendaftar dengan Google. Coba lagi.",
  google_state: "Sesi pendaftaran Google kedaluwarsa. Coba lagi.",
  google_batal: "Pendaftaran dengan Google dibatalkan.",
  ditutup: "Pendaftaran toko baru sedang ditutup sementara.",
  // `provisionStore` enforces the name rules and reports a lost race for BOTH signup paths, so the
  // Google callback has answers to carry back. Before this it had none — the throw became a 500 on a
  // route whose whole job is to land the person somewhere they can read.
  nama_google: "Nama akun Google-mu tidak bisa dipakai sebagai nama toko. Daftar lewat formulir di bawah.",
  bentrok: "Email atau nama toko itu baru saja dipakai. Coba lagi.",
};

// Public self-serve signup (outside the (admin) route group, like /login — middleware lets it
// through unauthenticated).
//
// While signup is CLOSED (SIGNUP_ENABLED unset — see lib/provision) this page renders an explanation
// instead of the form. That is UX only: `provisionStore` is the boundary that actually refuses, so
// the form being hidden is not what keeps a store from being created.
export default async function DaftarPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  if (!signupOpen()) {
    // Keadaan tertutup memakai kerangka yang SAMA dengan formulirnya. Sebelumnya ia satu kartu
    // di tengah dengan `min-h-screen` dan sebuah `h1` berbunyi "TokoΦ" — yaitu merk dipakai sebagai
    // judul halaman, persis pola yang sudah dibuang dari pintu depan, dan `100vh` yang menggoyang
    // halaman di ponsel. `claimable` sengaja mati: plat alamat mengundang orang mengklaim sesuatu
    // yang justru sedang tidak bisa diklaim.
    return (
      <FrontDoorShell
        eyebrow="Pendaftaran ditutup"
        title="Belum bisa daftar hari ini"
        lead="Kami sedang menyiapkan platform dan belum membuka pendaftaran toko baru. Terima kasih atas minatmu."
        footer={
          <>
            Sudah punya toko?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Masuk di sini
            </Link>
            .
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Pendaftaran akan dibuka kembali segera. Sementara itu, kamu bisa melihat apa saja yang
          disiapkan di{" "}
          <a
            href={MARKETING_HOME}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {new URL(MARKETING_HOME).host}
          </a>
          .
        </p>
      </FrontDoorShell>
    );
  }

  return (
    <FrontDoorShell
      eyebrow="Buka toko online"
      claimable
      // Judulnya menamai HASILNYA, bukan formulirnya. "Buat toko online Anda" menyuruh; ini
      // menggambarkan apa yang orang itu dapatkan sesudah tiga langkah.
      title="Tokomu, tayang hari ini"
      lead="Tiga langkah. Langkah pertama sudah cukup untuk mulai — sisanya bisa dilengkapi nanti."
      footer={
        <>
          Sudah punya toko?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            Masuk
          </Link>
        </>
      }
    >
      <DaftarForm googleEnabled={googleEnabled()} notice={error ? (NOTICES[error] ?? "Gagal mendaftar.") : undefined} />
    </FrontDoorShell>
  );
}
