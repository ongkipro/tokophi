"use client";
import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { GoogleButton } from "@/app/daftar/google-button";

export function LoginForm({ googleEnabled, notice }: { googleEnabled: boolean; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <>
          <GoogleButton mode="login" label="Masuk dengan Google" />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">atau</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          {/* ⚠️ NO `defaultValue`. It pre-filled the seeded owner's address, so this page published
              half a working credential — and the seed genuinely creates that row on deploy, so it was
              not a placeholder. The `placeholder` is the right affordance: it shows the SHAPE without
              naming an account. Do not add it back "for dev convenience"; that is exactly the reason
              it was there. */}
          <Input id="email" name="email" type="email" placeholder="nama@toko.id" required autoComplete="email" className="h-11" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Kata sandi</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" className="h-11" />
        </div>
        {state?.need2fa && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Kode autentikasi (2FA)</Label>
            <Input id="code" name="code" inputMode="numeric" maxLength={6} placeholder="000000" autoFocus autoComplete="one-time-code" className="font-mono tracking-widest" />
            <p className="text-xs text-muted-foreground">Masukkan 6 digit dari aplikasi authenticator Anda.</p>
          </div>
        )}
        {/* Galat diberi permukaannya sendiri, bukan sebaris teks merah yang mengambang: pada layar
            yang isinya cuma dua kolom, teks merah telanjang terbaca seperti label, bukan masalah.
            `role="alert"` supaya pembaca layar mendapatkannya tanpa harus menyusuri ulang. */}
        {(state?.error || notice) && (
          <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive">
            {state?.error ?? notice}
          </p>
        )}
        {/* h-11, bukan h-8 default. Ini aksi utama SATU halaman penuh; tinggi tombol baris tabel
            membuatnya terbaca sebagai kontrol sekunder. `active:scale` memberi umpan balik tekan yang
            memang diharapkan di ponsel, dan `motion-reduce` mematikannya. */}
        <Button
          type="submit"
          disabled={pending}
          className="h-11 w-full text-[0.9375rem] transition-transform motion-safe:active:scale-[0.985]"
        >
          {pending ? "Masuk…" : state?.need2fa ? "Verifikasi" : "Masuk"}
        </Button>
      </form>
    </div>
  );
}
