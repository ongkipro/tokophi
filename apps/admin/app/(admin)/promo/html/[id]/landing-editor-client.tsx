"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Check, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { useCan } from "@/components/admin/permissions";
import { FormFieldsCard } from "@/components/admin/form-fields-card";
import { saveLanding, deleteLanding } from "@/lib/actions/landing";
import type { LandingEditor } from "@/lib/data/landing";
import type { FormConfig } from "@tokophi/lib/form-config";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Textarea } from "@tokophi/ui/textarea";
import { Switch } from "@tokophi/ui/switch";
import { Label } from "@tokophi/ui/label";

export function LandingEditorClient({ editor }: { editor: LandingEditor }) {
  const router = useRouter();
  const canWrite = useCan("content:write");
  const [saving, startSave] = React.useTransition();
  const [deleting, startDelete] = React.useTransition();
  const [copied, setCopied] = React.useState(false);

  const [f, setF] = React.useState({
    slug: editor.slug,
    title: editor.title,
    html: editor.html,
    productId: editor.productId,
    enabled: editor.enabled,
    countdownMinutes: editor.countdownMinutes,
    showScarcity: editor.showScarcity,
    formConfig: editor.formConfig,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const setFC = (k: keyof FormConfig, v: boolean) => setF((s) => ({ ...s, formConfig: { ...s.formConfig, [k]: v } }));

  function save() {
    startSave(async () => {
      const res = await saveLanding({ id: editor.id, ...f });
      if (!res.ok) {
        toast.error(res.error ?? "Gagal menyimpan");
        return;
      }
      toast.success("Landing disimpan");
      if (!editor.id && res.id) router.push(`/promo/html/${res.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!editor.id) return;
    startDelete(async () => {
      await deleteLanding(editor.id!);
      toast.success("Landing dihapus");
      router.push("/promo");
    });
  }

  function copyLink() {
    if (!editor.shareUrl) return;
    navigator.clipboard?.writeText(editor.shareUrl).then(() => {
      setCopied(true);
      toast.success("Link disalin");
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/promo" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Landing Page
        </Link>
        <PageHeader
          title={editor.id ? editor.title || "Landing HTML" : "Buat Landing HTML"}
          desc="Tempel HTML desain sendiri, pilih produk untuk checkout. Form order otomatis muncul di bawah halaman."
        />
      </div>

      {editor.shareUrl && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">Link halaman</div>
              <div className="truncate text-sm text-muted-foreground">{editor.shareUrl}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={copyLink}>
                {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                Salin
              </Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={editor.shareUrl} target="_blank" rel="noreferrer" />}>
                <ExternalLink className="mr-1.5 h-4 w-4" /> Lihat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <div className="font-medium">Aktifkan landing</div>
            <p className="text-sm text-muted-foreground">Saat nonaktif, URL /lp/{f.slug || "…"} mengembalikan 404.</p>
          </div>
          <Switch checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={!canWrite} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pengaturan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Judul halaman</Label>
              <Input id="title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="mis. Saratoga Anggrek" maxLength={160} disabled={!canWrite} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug URL</Label>
              <Input id="slug" value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="saratoga-anggrek" maxLength={80} disabled={!canWrite} />
              <p className="text-xs text-muted-foreground">URL: /lp/{f.slug || "…"}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product">Produk untuk checkout</Label>
            <select
              id="product"
              value={f.productId}
              onChange={(e) => set("productId", e.target.value)}
              disabled={!canWrite}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            >
              {editor.products.length === 0 && <option value="">— tidak ada produk aktif —</option>}
              {editor.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Form order (paket + ongkir + COD) memakai produk ini.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="countdown">Countdown (menit)</Label>
              <Input id="countdown" type="number" min={0} max={180} value={f.countdownMinutes} onChange={(e) => set("countdownMinutes", Number(e.target.value))} className="w-32" disabled={!canWrite} />
              <p className="text-xs text-muted-foreground">0 = tanpa countdown.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-line p-3">
              <div>
                <div className="text-sm font-medium">Tampilkan sisa stok</div>
                <p className="text-xs text-muted-foreground">Dari stok varian terpilih.</p>
              </div>
              <Switch checked={f.showScarcity} onCheckedChange={(v) => set("showScarcity", v)} disabled={!canWrite} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>HTML Landing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={f.html}
            onChange={(e) => set("html", e.target.value)}
            placeholder="<section>…tempel HTML halaman landing kamu di sini…</section>"
            rows={18}
            className="font-mono text-xs"
            disabled={!canWrite}
          />
          <p className="text-xs text-muted-foreground">
            Tempel isi HTML (bagian body). Form order + tombol "Pesan Sekarang" ditambahkan otomatis di
            bawah.{" "}
            <strong className="text-amber-700 dark:text-amber-500">
              HTML ini dijalankan apa adanya di halaman toko Anda, termasuk tag &lt;script&gt;.
            </strong>{" "}
            Jangan tempel kode dari sumber yang tidak Anda percaya — halaman ini memuat form pesanan
            (nama, WhatsApp, alamat).
          </p>
        </CardContent>
      </Card>

      <FormFieldsCard value={f.formConfig} onChange={setFC} disabled={!canWrite} />

      <div className="flex items-center justify-between gap-2">
        {editor.id ? (
          <Button variant="outline" onClick={remove} disabled={!canWrite || deleting} className="text-rose-600 hover:text-rose-700">
            <Trash2 className="mr-1.5 h-4 w-4" /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/promo" />}>
            Batal
          </Button>
          <Button onClick={save} disabled={!canWrite || saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
