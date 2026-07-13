"use client";
import Link from "next/link";
import { useActionState } from "react";
import { registerStore } from "@/lib/actions/register";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "./google-button";

export function DaftarForm({ googleEnabled, notice }: { googleEnabled: boolean; notice?: string }) {
  const [state, action, pending] = useActionState(registerStore, {});
  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <>
          <GoogleButton mode="daftar" label="Daftar dengan Google" />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">atau</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="storeName">Nama toko</Label>
          <Input id="storeName" name="storeName" required minLength={3} placeholder="Batik Nusantara" autoComplete="organization" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ownerName">Nama pemilik</Label>
          <Input id="ownerName" name="ownerName" required placeholder="Nama lengkap Anda" autoComplete="name" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="nama@toko.id" autoComplete="email" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Kata sandi</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
        </div>
        {(state?.error || notice) && <p className="text-sm text-destructive">{state?.error ?? notice}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Membuat toko…" : "Daftar gratis"}</Button>
        <p className="text-center text-xs text-muted-foreground">
          Gratis 3 hari. Tanpa kartu kredit — bayar setelah masa coba berakhir.
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Sudah punya toko?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Masuk
          </Link>
        </p>
      </form>
    </div>
  );
}
