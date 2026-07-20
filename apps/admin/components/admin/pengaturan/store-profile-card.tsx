"use client";
import * as React from "react";
import { toast } from "sonner";
import { Store, Loader2, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import {
  getStoreProfile,
  saveStoreProfile,
  saveStoreLogo,
  removeStoreLogo,
  saveStoreFavicon,
  removeStoreFavicon,
} from "@/lib/actions/store-profile";
import { BrandingUpload } from "@/components/admin/pengaturan/branding-upload";

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
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    getStoreProfile().then(
      (p) => {
        if (!alive) return;
        setName(p.name);
        setTagline(p.tagline);
        setWhatsapp(p.whatsapp);
        setLogoUrl(p.logoUrl);
        setFaviconUrl(p.faviconUrl);
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
        <CardDescription>Logo, nama, deskripsi singkat, dan nomor WhatsApp — tampil di storefront kamu.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-5">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </div>
        ) : (
          <>
            {/* Branding first: it is the thing a merchant recognises as "my shop", and it lands on
                every page a shopper sees. `logo_url` had readers in the storefront and no writer
                anywhere — this form is that missing writer. */}
            <BrandingUpload
              label="Logo toko"
              // The numbers are MEASURED off the storefront, not rounded to something that sounds
              // tidy. Header.astro renders the logo at `h-9 sm:h-10 w-auto max-w-[11rem]` — 40px tall
              // at most, clamped to 176px wide — and the mobile menu at `h-8 max-w-[9rem]`. So:
              //  · 120px tall = 3x the largest render, which is what a modern phone screen wants.
              //  · Wider than ~4:1 hits `max-w-[11rem]` FIRST and is then rendered SHORTER than 40px.
              //    That is the invisible reason a merchant's wide logo looks small, so we say it.
              // If these classes change, change this line.
              hint="Tampil di header storefront & checkout. Terbaik: SVG (tajam di semua layar) atau PNG transparan, tinggi minimal 120 px — misalnya 480 × 120. Logo yang lebih lebar dari rasio 4:1 akan otomatis dikecilkan agar muat. Maks. 2 MB. Kosong → nama toko dipakai sebagai wordmark."
              value={logoUrl}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={!canWrite}
              onUpload={saveStoreLogo}
              onRemove={removeStoreLogo}
              onChanged={setLogoUrl}
              preview={(url) => (
                // object-contain, never cover: a logo cropped to fill a box is a mangled logo.
                <div className="grid h-16 w-28 shrink-0 place-items-center rounded-lg border bg-muted/30 p-2">
                  <img src={url} alt="Logo toko" className="max-h-full max-w-full object-contain" />
                </div>
              )}
            />

            <BrandingUpload
              label="Favicon"
              hint="Ikon kecil di tab browser storefront. Unggah format gambar apa pun — otomatis dijadikan PNG persegi 512 × 512. Paling rapi kalau gambarnya sudah persegi; yang tidak persegi diberi ruang kosong, bukan dipotong. Maks. 2 MB. Kosong → ikon bawaan TokoΦ yang dipakai."
              value={faviconUrl}
              // Every raster format sharp can decode — the merchant converts nothing by hand;
              // `saveFavicon` squares it to 512 and writes PNG. This `accept` must stay in step with
              // FAVICON_TYPES in lib/actions/store-profile.ts: offering a format the server cannot read
              // is a promise the picker makes and the upload breaks.
              // ⚠️ NO .ico, and do not add it back — sharp has no ICO decoder (verified on 0.34.5), so
              // every .ico upload can only end in "tidak bisa dibaca". NO .svg either: see the note on
              // FAVICON_TYPES. Everything else raster is fine.
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff,image/heic,image/heif"
              disabled={!canWrite}
              onUpload={saveStoreFavicon}
              onRemove={removeStoreFavicon}
              onChanged={setFaviconUrl}
              preview={(url) => (
                // Shown at the size it actually ships at (16px) inside a mock tab: a mark that reads
                // fine at 200px can be an unrecognisable smudge at 16, and the merchant should find
                // that out here rather than from a shopper.
                <div className="flex h-16 shrink-0 items-end">
                  <div className="flex items-center gap-1.5 rounded-t-md border border-b-0 bg-muted/50 px-2.5 py-1.5">
                    <img src={url} alt="Favicon" className="size-4 rounded-[2px] object-contain" />
                    <span className="max-w-24 truncate text-xs text-muted-foreground">{name || "Toko"}</span>
                  </div>
                </div>
              )}
            />

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
