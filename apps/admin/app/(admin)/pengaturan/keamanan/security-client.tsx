"use client";
import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, KeyRound, Smartphone } from "lucide-react";
import { changePassword, setup2FA, enable2FA, disable2FA } from "@/lib/actions/security";

export function SecurityClient({ email, twoFactor }: { email: string; twoFactor: boolean }) {
  const [pending, start] = React.useTransition();

  // change password
  const [cur, setCur] = React.useState("");
  const [nw, setNw] = React.useState("");
  const [conf, setConf] = React.useState("");
  const submitPw = () => {
    if (nw !== conf) return toast.error("Konfirmasi kata sandi tidak cocok.");
    start(async () => {
      const r = await changePassword(cur, nw);
      if (r.ok) {
        toast.success("Kata sandi diperbarui.");
        setCur(""); setNw(""); setConf("");
      } else toast.error(r.error ?? "Gagal.");
    });
  };

  // 2FA
  const [enabled, setEnabled] = React.useState(twoFactor);
  const [setup, setSetup] = React.useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  const beginSetup = () =>
    start(async () => {
      const r = await setup2FA();
      if (r.ok && r.qr && r.secret) setSetup({ qr: r.qr, secret: r.secret });
      else toast.error(r.error ?? "Gagal memulai 2FA.");
    });
  const confirmEnable = () =>
    start(async () => {
      const r = await enable2FA(code);
      if (r.ok) { setEnabled(true); setSetup(null); setCode(""); toast.success("Autentikasi 2 langkah aktif."); }
      else toast.error(r.error ?? "Kode salah.");
    });
  const doDisable = () =>
    start(async () => {
      const r = await disable2FA(code);
      if (r.ok) { setEnabled(false); setCode(""); toast.success("2FA dinonaktifkan."); }
      else toast.error(r.error ?? "Kode salah.");
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* change password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /> Ubah Kata Sandi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Kata sandi saat ini</Label>
            <Input id="cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nw">Kata sandi baru</Label>
            <Input id="nw" type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="Minimal 8 karakter" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf">Ulangi kata sandi baru</Label>
            <Input id="conf" type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex justify-end pt-1">
            <Button disabled={pending || !cur || !nw} onClick={submitPw}>Simpan</Button>
          </div>
        </CardContent>
      </Card>

      {/* 2FA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" /> Autentikasi 2 Langkah
            {enabled && <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tambahkan lapisan keamanan dengan aplikasi authenticator (Google Authenticator, Authy) untuk <span className="font-medium text-foreground">{email}</span>.
          </p>

          {!enabled && !setup && (
            <Button variant="outline" className="gap-1.5" disabled={pending} onClick={beginSetup}>
              <Smartphone className="size-4" /> Aktifkan 2FA
            </Button>
          )}

          {!enabled && setup && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">1. Scan QR ini di aplikasi authenticator:</p>
              <Image src={setup.qr} alt="QR 2FA" width={180} height={180} className="rounded-md border" unoptimized />
              <p className="text-xs text-muted-foreground">Atau masukkan kunci manual: <span className="font-mono font-medium text-foreground">{setup.secret}</span></p>
              <div className="space-y-1.5">
                <Label htmlFor="code">2. Masukkan 6 digit kode</Label>
                <Input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" className="font-mono tracking-widest" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={pending} onClick={() => { setSetup(null); setCode(""); }}>Batal</Button>
                <Button disabled={pending || code.length !== 6} onClick={confirmEnable}>Verifikasi &amp; Aktifkan</Button>
              </div>
            </div>
          )}

          {enabled && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Masukkan kode dari authenticator untuk menonaktifkan.</p>
              <div className="flex gap-2">
                <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" className="font-mono tracking-widest" />
                <Button variant="outline" className="shrink-0 text-destructive hover:text-destructive" disabled={pending || code.length !== 6} onClick={doDisable}>Nonaktifkan</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
