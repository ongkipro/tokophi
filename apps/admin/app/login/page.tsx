import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
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
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {/* `level={1}`: `CardTitle` defaults to `h2` because a card normally sits under a page
              `PageHeader`. This page has no PageHeader — measured in a browser, its only heading
              was this one — so the default would leave the screen with no `h1`. The class still
              sets the size; the prop changes the tag only. */}
          <CardTitle level={1} className="text-2xl tracking-tight">TokoΦ</CardTitle>
          <CardDescription>Masuk ke Dashboard Seller toko Anda</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm googleEnabled={googleEnabled()} notice={error ? (NOTICES[error] ?? "Gagal masuk.") : undefined} />
        </CardContent>
      </Card>
    </div>
  );
}
