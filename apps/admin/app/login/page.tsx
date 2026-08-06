import Link from "next/link";
import { googleEnabled } from "@/lib/google";
import { FrontDoorShell } from "@/components/admin/front-door/front-door-shell";
import { LoginForm } from "./login-form";

// Google OAuth error codes bounced back by /api/auth/google/callback.
const NOTICES: Record<string, string> = {
  google_belum_daftar: "Akun Google Anda belum terdaftar. Silakan daftar toko baru terlebih dahulu.",
  google_gagal: "Gagal masuk dengan Google. Coba lagi.",
  google_state: "Sesi login Google kedaluwarsa. Coba lagi.",
  google_batal: "Login dengan Google dibatalkan.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <FrontDoorShell
      eyebrow="Dashboard Seller"
      // Ditulis dari sisi orangnya, bukan sisi sistem. Yang lama berbunyi "Masuk ke Dashboard Seller
      // toko Anda" — menamai FITURNYA. Yang dituju orang bukan sebuah dashboard; yang dituju tokonya.
      title="Masuk ke tokomu"
      lead="Kelola pesanan, produk, dan pengiriman dari satu tempat."
      footer={
        <>
          Belum punya toko?{" "}
          <Link href="/daftar" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            Daftar gratis
          </Link>
        </>
      }
    >
      <LoginForm googleEnabled={googleEnabled()} notice={error ? (NOTICES[error] ?? "Gagal masuk.") : undefined} />
    </FrontDoorShell>
  );
}
