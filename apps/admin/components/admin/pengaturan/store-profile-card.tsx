"use client";
import * as React from "react";
import { toast } from "sonner";
import { Store, Loader2, MessageCircle, MapPin, Phone, Share2, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Textarea } from "@tokophi/ui/textarea";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import {
  getStoreProfile,
  saveStoreProfile,
  saveStoreLogo,
  removeStoreLogo,
  saveStoreFavicon,
  removeStoreFavicon,
  type SocialHandles,
} from "@/lib/actions/store-profile";
import { SOCIAL_PLATFORMS, SOCIAL_META } from "@/lib/social";
import { BrandingUpload } from "@/components/admin/pengaturan/branding-upload";

// Pengaturan → Profil. Only the fields that have a real column AND reach the shopper live here: name,
// tagline (the storefront meta description + footer line), the CS WhatsApp number, and — since 0063 —
// the public shop address, a public phone, and five social usernames.
//
// ⚠️ EVERY field on this card is PUBLIC. That is the card's one organising idea, and it is why the
// address here is `stores.address` and NOT `store_settings.sender_address`: the latter is the courier
// pickup point that prices ongkir (Pengaturan → Pengiriman), it is usually the seller's HOME, and
// nothing on this screen may prefill, mirror or sync it. The copy on the field says so explicitly
// because a merchant will otherwise assume the two are "the address" and publish their house.
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
  const [address, setAddress] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [social, setSocial] = React.useState<SocialHandles>(
    () => Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ""])) as SocialHandles,
  );
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
        setAddress(p.address);
        setPhone(p.phone);
        setEmail(p.email);
        setSocial(p.social);
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
      const res = await saveStoreProfile({ name, tagline, whatsapp, address, phone, email, social });
      if (res.ok) {
        toast.success("Profil toko tersimpan.");
        // The server normalises: a pasted profile URL becomes a username, a mobile becomes 62…. Read
        // the stored values back so the merchant SEES what was actually saved, instead of leaving the
        // input showing the URL they pasted and discovering the difference on the storefront.
        getStoreProfile().then((p) => {
          setPhone(p.phone);
          setEmail(p.email);
          setSocial(p.social);
          setAddress(p.address);
        }, () => {});
      } else toast.error(res.error);
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" /> Profil Toko
        </CardTitle>
        <CardDescription>
          Logo, nama, kontak, alamat, dan media sosial — semua yang ada di halaman ini <span className="font-medium">tampil publik</span> di storefront kamu.
        </CardDescription>
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
              <div className="flex items-baseline justify-between">
                <Label htmlFor="sp-tagline">Deskripsi singkat</Label>
                {/* A visible counter. Without it the 160-char cap truncated SILENTLY, mid-word — a
                    merchant typed a full description and the field ate the tail with no signal, so the
                    storefront footer showed "…masing-masing da". The cap stays 160 (this doubles as the
                    SEO meta description, which Google truncates near there anyway); the fix is that the
                    limit is now SEEN. Turns amber as it approaches so the cut is never a surprise. */}
                <span className={`text-xs tabular-nums ${tagline.length >= 160 ? "text-amber-600" : tagline.length >= 140 ? "text-amber-500" : "text-muted-foreground"}`}>
                  {tagline.length}/160
                </span>
              </div>
              <Input
                id="sp-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={160}
                placeholder="mis. Busana wanita modern — batik & ready-to-wear"
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">Muncul sebagai deskripsi toko di hasil pencarian &amp; footer. Kosongkan jika belum.</p>
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

            <div className="grid gap-1.5">
              <Label htmlFor="sp-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> No. telepon publik
              </Label>
              <Input
                id="sp-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="mis. 021 5551234"
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">
                Ditampilkan di storefront sebagai kontak toko. Boleh nomor <span className="font-medium">telepon rumah/kantor</span> — tidak harus nomor WhatsApp di atas. Kosongkan jika tidak ingin ditampilkan.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sp-email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email publik
              </Label>
              <Input
                id="sp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoComplete="off"
                placeholder="mis. halo@namatoko.com"
                disabled={!canWrite}
              />
              {/* ⚠️ Says out loud that this is NOT the login. A merchant who assumes it is "the email
                  you already know" would publish the address they sign in with on every page of a
                  public website. Two fields, two jobs — see migration 0070. */}
              <p className="text-xs text-muted-foreground">
                Alamat email untuk <span className="font-medium">dihubungi pembeli</span>, ditampilkan di storefront. Bukan email login akun kamu. Kosongkan jika tidak ingin ditampilkan.
              </p>
            </div>

            {/* ⚠️ PUBLIC address. This is NOT the pickup address in Pengaturan → Pengiriman, and the
                copy has to say so out loud: most sellers here start from home, and a merchant who
                assumes this field is "the address you already know" would publish their house on
                every page of a public website. The two are never synced — see lib/actions/store-profile.ts. */}
            <div className="grid gap-1.5">
              <Label htmlFor="sp-address" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Alamat toko (publik)
              </Label>
              <Textarea
                id="sp-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder={"Jl. Malioboro No. 52\nRT 03 / RW 05, Sosromenduran\nGedongtengen, Yogyakarta 55271"}
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">
                Alamat yang <span className="font-medium">dilihat pembeli</span> di footer storefront. Boleh beberapa baris.{" "}
                <span className="font-medium text-foreground">Ini bukan alamat penjemputan kurir</span> — alamat pickup diatur terpisah di Pengaturan → Pengiriman dan tidak pernah ditampilkan ke pembeli. Kosongkan jika kamu tidak punya toko fisik atau tidak ingin alamatnya publik.
              </p>
            </div>

            {/* Usernames, never URLs: the column stores the handle and the storefront builds the link.
                The prefix adornment is what makes that obvious without a paragraph of instructions —
                and a merchant who pastes the whole URL anyway is handled on save, not scolded. */}
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> Media sosial
              </Label>
              <div className="grid gap-2">
                {SOCIAL_PLATFORMS.map((p) => {
                  const meta = SOCIAL_META[p];
                  return (
                    <div key={p} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                      <Label htmlFor={`sp-social-${p}`} className="text-sm font-normal text-muted-foreground">
                        {meta.label}
                      </Label>
                      <div className="flex h-8 items-center rounded-lg border border-input bg-transparent pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:bg-input/50 has-disabled:opacity-50 dark:bg-input/30">
                        <span className="shrink-0 select-none text-sm text-muted-foreground">{meta.prefix}</span>
                        <Input
                          id={`sp-social-${p}`}
                          value={social[p]}
                          onChange={(e) => setSocial((s) => ({ ...s, [p]: e.target.value }))}
                          placeholder={meta.placeholder}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={!canWrite}
                          className="h-7 rounded-none border-0 bg-transparent pl-0 focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Isi <span className="font-medium">username saja</span> (tanpa <code>@</code>). Kalau kamu menempelkan link profil lengkap, usernamenya kami ambil otomatis. Yang kosong tidak ditampilkan di storefront.
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
