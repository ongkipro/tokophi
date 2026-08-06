import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { FrontDoorShell } from "@/components/admin/front-door/front-door-shell";
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            {/* `level={1}` — same reason as /login: this card IS the page, and without it the screen
                would have no `h1` at all. See the note on `CardTitle` in packages/ui. */}
            <CardTitle level={1} className="text-2xl tracking-tight">TokoΦ</CardTitle>
            <CardDescription>Pendaftaran ditutup sementara</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Kami sedang menyiapkan platform dan belum membuka pendaftaran toko baru. Terima kasih
              atas minatmu — kami akan membukanya kembali segera.
            </p>
            <p className="text-sm text-muted-foreground">
              Sudah punya toko?{" "}
              <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                Masuk di sini
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
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
