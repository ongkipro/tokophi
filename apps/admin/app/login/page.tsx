import { googleEnabled } from "@/lib/google";
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
    <div className="flex min-h-[100dvh] bg-background">
      {/* Sisi Kiri: Branding (Hanya terlihat di Desktop) */}
      <div className="relative hidden w-0 flex-1 lg:flex flex-col justify-between bg-slate-900 px-12 py-16 overflow-hidden">
        {/* Dekorasi Abstract Mesh / Glow */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/40 to-slate-900 z-0"></div>
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-primary/20 blur-[120px] rounded-full pointer-events-none z-0"></div>
        
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">TokoΦ</h1>
        </div>
        
        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-semibold text-white tracking-tight leading-tight mb-6">
            Kelola toko jadi lebih elegan.
          </h2>
          <p className="text-slate-400 text-lg">
            "TokoΦ dirancang untuk brand lokal yang mengedepankan kualitas dan pengalaman pelanggan terbaik."
          </p>
        </div>
      </div>

      {/* Sisi Kanan: Form Login (Full Width di Mobile, Fixed Width di Desktop) */}
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:flex-none lg:w-[480px] xl:w-[560px] animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
        <div className="mx-auto w-full max-w-sm lg:max-w-md">
          <div className="mb-8">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              Selamat Datang Kembali.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Masuk ke TokoΦ untuk mulai mengelola pesanan dan mengembangkan bisnismu.
            </p>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sm:shadow-lg sm:shadow-primary/5 rounded-2xl sm:border border-border/50 sm:p-8 transition-all">
            <LoginForm googleEnabled={googleEnabled()} notice={error ? (NOTICES[error] ?? "Gagal masuk.") : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
