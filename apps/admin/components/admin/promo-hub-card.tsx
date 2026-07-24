"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, LayoutTemplate, ExternalLink } from "lucide-react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { useCan } from "@/components/admin/permissions";
import { setPromoHub, type PromoHubConfig } from "@/lib/actions/promo-hub";

// Editor for the storefront /promo hub banner (PROMO P4b). Empty fields fall back to defaults on the
// storefront, so the page always renders — this only overrides the hero copy + optional banner image.
export function PromoHubCard({ initial }: { initial: PromoHubConfig }) {
  const canWrite = useCan("settings:write");
  const [title, setTitle] = React.useState(initial.title);
  const [subtitle, setSubtitle] = React.useState(initial.subtitle);
  const [banner, setBanner] = React.useState(initial.bannerUrl);
  const [saving, start] = React.useTransition();

  const dirty = title !== initial.title || subtitle !== initial.subtitle || banner !== initial.bannerUrl;

  const save = () =>
    start(async () => {
      try {
        const r = await setPromoHub({ title, subtitle, bannerUrl: banner });
        if (r.ok) toast.success("Halaman promo disimpan.");
      } catch {
        toast.error("Gagal menyimpan — coba lagi.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutTemplate className="size-4 text-muted-foreground" /> Halaman Promo
        </CardTitle>
        <CardDescription>
          Atur banner halaman <Link href="/promo" className="font-medium text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">/promo <ExternalLink className="inline size-3" /></Link> — tempat semua promo (flash sale, voucher, gratis ongkir) tampil dalam satu halaman.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <label htmlFor="ph-title" className="text-sm font-medium">Judul</label>
          <Input id="ph-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Semua Promo, Satu Halaman" maxLength={80} disabled={!canWrite} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="ph-sub" className="text-sm font-medium">Subjudul</label>
          <Input id="ph-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Flash sale, kode voucher, dan gratis ongkir — semuanya di sini." maxLength={160} disabled={!canWrite} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="ph-banner" className="text-sm font-medium">URL gambar banner <span className="font-normal text-muted-foreground">(opsional)</span></label>
          <Input id="ph-banner" value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="https://… atau /api/uploads/…" disabled={!canWrite} />
          <p className="text-xs text-muted-foreground">Kosong = pakai latar gradien bawaan. Isi dengan URL gambar (rasio lebar disarankan).</p>
        </div>
        {canWrite && (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || !dirty}>
              {saving && <Loader2 className="size-4 animate-spin" />} Simpan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
