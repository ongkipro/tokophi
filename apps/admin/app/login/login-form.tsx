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
    <div className="flex flex-col gap-6">
      {googleEnabled && (
        <>
          <div className="group relative">
            <GoogleButton mode="login" label="Masuk dengan Google" />
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">atau masuk dengan email</span>
            </div>
          </div>
        </>
      )}
      <form action={action} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="email" className="text-sm font-medium">Alamat Email</Label>
          <Input 
            id="email" 
            name="email" 
            type="email" 
            placeholder="nama@toko.id" 
            required 
            autoComplete="email" 
            className="h-11 text-base md:text-sm focus-visible:ring-primary/30 transition-shadow"
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium">Kata Sandi</Label>
          </div>
          <Input 
            id="password" 
            name="password" 
            type="password" 
            required 
            autoComplete="current-password"
            className="h-11 text-base md:text-sm focus-visible:ring-primary/30 transition-shadow" 
          />
        </div>
        {state?.need2fa && (
          <div className="flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <Label htmlFor="code" className="text-sm font-medium">Kode Autentikasi (2FA)</Label>
            <Input 
              id="code" 
              name="code" 
              inputMode="numeric" 
              maxLength={6} 
              placeholder="000 000" 
              autoFocus 
              autoComplete="one-time-code" 
              className="h-11 text-center font-mono tracking-[0.5em] text-lg focus-visible:ring-primary/30 transition-shadow" 
            />
            <p className="text-xs text-muted-foreground">
              Akun Anda dilindungi. Masukkan 6 digit kode dari aplikasi Authenticator.
            </p>
          </div>
        )}
        {(state?.error || notice) && (
          <p className="text-sm text-destructive font-medium bg-destructive/10 p-3 rounded-lg animate-in zoom-in-95">
            {state?.error ?? notice}
          </p>
        )}
        <Button 
          type="submit" 
          disabled={pending} 
          className="h-11 mt-2 rounded-xl shadow-lg shadow-primary/25 active:scale-[0.98] transition-all font-semibold"
        >
          {pending ? "Masuk…" : state?.need2fa ? "Verifikasi" : "Masuk ke Dashboard"}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Belum punya toko?{" "}
          <Link href="/daftar" className="font-semibold text-primary hover:underline underline-offset-4">
            Daftar gratis
          </Link>
        </p>
      </form>
    </div>
  );
}
