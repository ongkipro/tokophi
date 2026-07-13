import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { googleEnabled } from "@/lib/google";
import { DaftarForm } from "./daftar-form";

const NOTICES: Record<string, string> = {
  google_gagal: "Gagal mendaftar dengan Google. Coba lagi.",
  google_state: "Sesi pendaftaran Google kedaluwarsa. Coba lagi.",
  google_batal: "Pendaftaran dengan Google dibatalkan.",
};

// Public self-serve signup (outside the (admin) route group, like /login — middleware lets it
// through unauthenticated).
export default async function DaftarPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl tracking-tight">TokoΦ</CardTitle>
          <CardDescription>Buat toko online Anda — gratis 3 hari</CardDescription>
        </CardHeader>
        <CardContent>
          <DaftarForm googleEnabled={googleEnabled()} notice={error ? (NOTICES[error] ?? "Gagal mendaftar.") : undefined} />
        </CardContent>
      </Card>
    </div>
  );
}
