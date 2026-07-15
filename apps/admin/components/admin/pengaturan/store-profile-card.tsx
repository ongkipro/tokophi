"use client";
import * as React from "react";
import { toast } from "sonner";
import { Store, Loader2, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import { getStoreProfile, saveStoreProfile } from "@/lib/actions/store-profile";

// Pengaturan → Profil. Only the fields that have a real column AND reach the shopper live here: name,
// tagline (the storefront meta description + footer line), and the CS WhatsApp number.
//
// This replaced a cosmetic form — hardcoded `defaultValue`s, no save, a placeholder WhatsApp number
// (+62 812 3456 7890) that no shopper could reach. Email/address/currency used to sit here too, but
// they have no store column and saved nowhere, so they were dropped rather than kept as fields that
// lie. WhatsApp is nullable on purpose: clear it and the storefront shows NO button (honest) rather
// than a dead one.
export function StoreProfileCard() {
  const canWrite = useCan("settings:write");
  const [loading, setLoading] = React.useState(true);
  const [saving, start] = React.useTransition();

  const [name, setName] = React.useState("");
  const [tagline, setTagline] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    getStoreProfile().then(
      (p) => {
        if (!alive) return;
        setName(p.name);
        setTagline(p.tagline);
        setWhatsapp(p.whatsapp);
        setLoading(false);
      },
      () => alive && setLoading(false),
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = () => {
    start(async () => {
      const res = await saveStoreProfile({ name, tagline, whatsapp });
      if (res.ok) toast.success("Profil toko tersimpan.");
      else toast.error(res.error);
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" /> Profil Toko
        </CardTitle>
        <CardDescription>Nama, deskripsi singkat, dan nomor WhatsApp — tampil di storefront kamu.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-5">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </div>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="sp-name">Nama toko</Label>
              <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!canWrite} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sp-tagline">Deskripsi singkat</Label>
              <Input
                id="sp-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={160}
                placeholder="mis. Busana wanita modern — batik & ready-to-wear"
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">Muncul sebagai deskripsi toko di hasil pencarian & footer. Kosongkan jika belum.</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sp-wa" className="flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5" /> No. WhatsApp
              </Label>
              <Input
                id="sp-wa"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                inputMode="tel"
                placeholder="0812xxxxxxxx"
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">
                Tombol "Hubungi via WhatsApp" di storefront pakai nomor ini. <span className="font-medium">Kosongkan → tombolnya tidak muncul</span> (lebih baik daripada nomor yang tidak aktif).
              </p>
            </div>
          </>
        )}
      </CardContent>

      {canWrite && !loading && (
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
