"use client";
import Link from "next/link";
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
          <Input id="email" name="email" type="email" placeholder="nama@toko.id" required autoComplete="email" defaultValue="ongki@batiknusantara.id" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Kata sandi</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {state?.need2fa && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Kode autentikasi (2FA)</Label>
            <Input id="code" name="code" inputMode="numeric" maxLength={6} placeholder="000000" autoFocus autoComplete="one-time-code" className="font-mono tracking-widest" />
            <p className="text-xs text-muted-foreground">Masukkan 6 digit dari aplikasi authenticator Anda.</p>
          </div>
        )}
        {(state?.error || notice) && <p className="text-sm text-destructive">{state?.error ?? notice}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Masuk…" : state?.need2fa ? "Verifikasi" : "Masuk"}</Button>
        <p className="text-center text-sm text-muted-foreground">
          Belum punya toko?{" "}
          <Link href="/daftar" className="font-medium text-primary hover:underline">
            Daftar gratis
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">Dev: ongki@batiknusantara.id / tokophi123</p>
      </form>
    </div>
  );
}
