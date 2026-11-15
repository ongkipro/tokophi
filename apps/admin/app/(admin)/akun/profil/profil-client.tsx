"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { Separator } from "@tokophi/ui/separator";
import { User, Store, CalendarDays, ShieldCheck, ChevronRight } from "lucide-react";
import { updateProfile, type Profile } from "@/lib/actions/profile";
import { ROLE_LABEL, type Role } from "@/lib/rbac-policy";

export function ProfilClient({ profile }: { profile: Profile }) {
  const [pending, start] = React.useTransition();
  const [name, setName] = React.useState(profile.name);
  const [email, setEmail] = React.useState(profile.email);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const emailChanged = email.trim().toLowerCase() !== profile.email;
  const initials = (profile.name || profile.email).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const dirty = name.trim() !== profile.name || email.trim().toLowerCase() !== profile.email;
  const roleLabel = ROLE_LABEL[profile.role as Role] ?? profile.role;

  const save = () =>
    start(async () => {
      const r = await updateProfile({ name, email, currentPassword });
      if (r.ok) toast.success("Profil diperbarui.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* identity */}
      <Card className="lg:col-span-1">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <Avatar className="size-20"><AvatarFallback className="bg-primary/12 text-2xl font-semibold text-primary">{initials}</AvatarFallback></Avatar>
          <div>
            <div className="text-lg font-semibold">{profile.name || "—"}</div>
            <div className="text-sm text-muted-foreground">{profile.email}</div>
          </div>
          <Badge variant="secondary">{roleLabel}</Badge>
          <Separator className="my-2" />
          <div className="w-full space-y-2 text-left text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><Store className="size-4" /> {profile.storeName || "—"}</div>
            {profile.joinedDaysAgo !== null && (
              <div className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="size-4" /> Bergabung {profile.joinedDaysAgo} hari lalu</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* edit + shortcuts */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="size-4 text-muted-foreground" /> Informasi akun</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Nama</Label>
              <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama Anda" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-email">Email</Label>
              <Input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <p className="text-xs text-muted-foreground">Email dipakai untuk masuk ke Dashboard Seller.</p>
            </div>
            {emailChanged && (
              <div className="space-y-1.5">
                <Label htmlFor="pf-current-password">Kata sandi saat ini</Label>
                <Input
                  id="pf-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">Mengganti email login perlu konfirmasi kata sandi.</p>
              </div>
            )}
            <div className="flex justify-end border-t pt-4">
              <Button disabled={pending || !dirty} onClick={save}>{pending ? "Menyimpan…" : "Simpan perubahan"}</Button>
            </div>
          </CardContent>
        </Card>

        {/* quick link to security */}
        <Card>
          <Link href="/akun/keamanan" className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><ShieldCheck className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Keamanan</span>
              <span className="block text-xs text-muted-foreground">Kata sandi & autentikasi 2 langkah</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </Card>
      </div>
    </div>
  );
}
