"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X, Copy, Check, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { useCan } from "@/components/admin/permissions";
import { FormFieldsCard } from "@/components/admin/form-fields-card";
import { savePromoPage, generatePromoContent } from "@/lib/actions/promo";
import type { PromoConfig, PromoContent, PromoEditor } from "@/lib/data/promo";
import type { FormConfig } from "@tokophi/lib/form-config";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Textarea } from "@tokophi/ui/textarea";
import { Switch } from "@tokophi/ui/switch";
import { Label } from "@tokophi/ui/label";

export function PromoEditorClient({ editor }: { editor: PromoEditor }) {
  const router = useRouter();
  const canWrite = useCan("content:write");
  const [saving, startSave] = React.useTransition();
  const [copied, setCopied] = React.useState(false);

  const [generating, startGenerate] = React.useTransition();
  const [cfg, setCfg] = React.useState<PromoConfig>(editor.config);
  const set = <K extends keyof PromoConfig>(k: K, v: PromoConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const setContent = <K extends keyof PromoContent>(k: K, v: PromoContent[K]) =>
    setCfg((c) => ({ ...c, content: { ...c.content, [k]: v } }));
  const setFC = (k: keyof FormConfig, v: boolean) => setCfg((c) => ({ ...c, formConfig: { ...c.formConfig, [k]: v } }));

  function generate() {
    startGenerate(async () => {
      const res = await generatePromoContent(editor.productId);
      if (!res.ok || !res.draft) {
        toast.error(res.error ?? "Gagal generate.");
        return;
      }
      const d = res.draft;
      setCfg((c) => ({
        ...c,
        headline: d.headline ?? c.headline,
        subheadline: d.subheadline ?? c.subheadline,
        badge: d.badge ?? c.badge,
        benefits: d.benefits?.length ? d.benefits : c.benefits,
        idealFor: d.idealFor?.length ? d.idealFor : c.idealFor,
        content: { ...c.content, ...d.content },
      }));
      toast.success("Konten dibuat AI — periksa lalu Simpan.");
    });
  }

  // "Ideal Untuk" chip input
  const [chip, setChip] = React.useState("");
  function addChip() {
    const v = chip.trim();
    if (!v) return;
    if (!cfg.idealFor.includes(v)) set("idealFor", [...cfg.idealFor, v].slice(0, 12));
    setChip("");
  }

  function save() {
    startSave(async () => {
      const res = await savePromoPage(editor.productId, cfg);
      if (res.ok) {
        toast.success("Halaman promo disimpan");
        router.refresh();
      } else {
        toast.error(res.error ?? "Gagal menyimpan");
      }
    });
  }

  function copyLink() {
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
        <PageHeader title={editor.name} desc="Atur halaman pesanan langsung (COD) untuk produk ini." />
      </div>

      {/* share link */}
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

      {/* enable */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <div className="font-medium">Aktifkan halaman promo</div>
            <p className="text-sm text-muted-foreground">
              Saat nonaktif, link di atas mengembalikan 404 dan produk hanya tampil di halaman produk biasa.
            </p>
          </div>
          <Switch checked={cfg.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={!canWrite} />
        </CardContent>
      </Card>

      {/* AI generate */}
      <Card className="border-brand-200 bg-brand-50/40">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-4 w-4 text-brand-600" /> Generate dengan AI
            </div>
            <p className="text-sm text-muted-foreground">
              Claude menulis judul, masalah, solusi, manfaat &amp; gejala dari data produk. Isi form terisi otomatis — periksa lalu Simpan.
            </p>
          </div>
          <Button onClick={generate} disabled={!canWrite || generating} className="shrink-0">
            <Sparkles className="mr-1.5 h-4 w-4" />
            {generating ? "Membuat…" : "Generate"}
          </Button>
        </CardContent>
      </Card>

      {/* content overrides */}
      <Card>
        <CardHeader>
          <CardTitle>Konten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="headline">Judul</Label>
            <Input
              id="headline"
              value={cfg.headline}
              onChange={(e) => set("headline", e.target.value)}
              placeholder={editor.name}
              maxLength={120}
              disabled={!canWrite}
            />
            <p className="text-xs text-muted-foreground">Kosongkan untuk memakai nama produk.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subheadline">Subjudul</Label>
            <Textarea
              id="subheadline"
              value={cfg.subheadline}
              onChange={(e) => set("subheadline", e.target.value)}
              placeholder={editor.productDescription || "Deskripsi singkat produk…"}
              rows={2}
              maxLength={300}
              disabled={!canWrite}
            />
            <p className="text-xs text-muted-foreground">Kosongkan untuk memakai deskripsi produk.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="badge">Badge</Label>
            <Input
              id="badge"
              value={cfg.badge}
              onChange={(e) => set("badge", e.target.value)}
              placeholder={editor.productBadge || "mis. PILIHAN UNGGUL"}
              maxLength={40}
              disabled={!canWrite}
            />
          </div>
        </CardContent>
      </Card>

      {/* Manfaat Utama */}
      <Card>
        <CardHeader>
          <CardTitle>Manfaat Utama</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cfg.benefits.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={b}
                onChange={(e) => set("benefits", cfg.benefits.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="mis. Bahan adem, tidak menerawang"
                maxLength={120}
                disabled={!canWrite}
              />
              <Button variant="ghost" size="icon" onClick={() => set("benefits", cfg.benefits.filter((_, j) => j !== i))} disabled={!canWrite}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {cfg.benefits.length < 8 && (
            <Button variant="outline" size="sm" onClick={() => set("benefits", [...cfg.benefits, ""])} disabled={!canWrite}>
              <Plus className="mr-1.5 h-4 w-4" /> Tambah manfaat
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Ideal Untuk (chips) */}
      <Card>
        <CardHeader>
          <CardTitle>Ideal Untuk</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {cfg.idealFor.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-sm">
                {c}
                <button type="button" onClick={() => set("idealFor", cfg.idealFor.filter((x) => x !== c))} disabled={!canWrite} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {cfg.idealFor.length === 0 && <span className="text-sm text-muted-foreground">Belum ada.</span>}
          </div>
          {cfg.idealFor.length < 12 && (
            <div className="flex gap-2">
              <Input
                value={chip}
                onChange={(e) => setChip(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addChip();
                  }
                }}
                placeholder="mis. kerja, kondangan, santai — Enter untuk tambah"
                maxLength={40}
                disabled={!canWrite}
              />
              <Button variant="outline" size="sm" onClick={addChip} disabled={!canWrite || !chip.trim()}>
                Tambah
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Copywriting (long-form, AI-generated) */}
      <Card>
        <CardHeader>
          <CardTitle>Copywriting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="problem-title">Judul bagian masalah</Label>
            <Input
              id="problem-title"
              value={cfg.content.problemTitle ?? ""}
              onChange={(e) => setContent("problemTitle", e.target.value)}
              placeholder="mis. Gejala yang sering diabaikan"
              maxLength={120}
              disabled={!canWrite}
            />
          </div>

          <div className="space-y-2">
            <Label>Poin masalah / gejala</Label>
            {(cfg.content.problemBullets ?? []).map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={b}
                  onChange={(e) =>
                    setContent("problemBullets", (cfg.content.problemBullets ?? []).map((x, j) => (j === i ? e.target.value : x)))
                  }
                  placeholder="mis. Daun mulai menguning walau sudah dipupuk"
                  maxLength={240}
                  disabled={!canWrite}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setContent("problemBullets", (cfg.content.problemBullets ?? []).filter((_, j) => j !== i))}
                  disabled={!canWrite}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {(cfg.content.problemBullets?.length ?? 0) < 6 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setContent("problemBullets", [...(cfg.content.problemBullets ?? []), ""])}
                disabled={!canWrite}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Tambah poin
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agitation">Agitasi</Label>
            <Textarea
              id="agitation"
              value={cfg.content.agitation ?? ""}
              onChange={(e) => setContent("agitation", e.target.value)}
              placeholder="Konsekuensi bila masalah dibiarkan…"
              rows={2}
              maxLength={400}
              disabled={!canWrite}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="solution-title">Judul bagian solusi</Label>
            <Input
              id="solution-title"
              value={cfg.content.solutionTitle ?? ""}
              onChange={(e) => setContent("solutionTitle", e.target.value)}
              placeholder="mis. Kenapa produk ini berbeda"
              maxLength={120}
              disabled={!canWrite}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="solution-body">Isi solusi</Label>
            <Textarea
              id="solution-body"
              value={cfg.content.solutionBody ?? ""}
              onChange={(e) => setContent("solutionBody", e.target.value)}
              placeholder="Bagaimana produk ini menyelesaikan masalahnya…"
              rows={3}
              maxLength={600}
              disabled={!canWrite}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guarantee">Garansi / kepercayaan</Label>
            <Textarea
              id="guarantee"
              value={cfg.content.guarantee ?? ""}
              onChange={(e) => setContent("guarantee", e.target.value)}
              placeholder="mis. Produk original, dilayani admin resmi, uang kembali jika tidak sesuai."
              rows={2}
              maxLength={400}
              disabled={!canWrite}
            />
          </div>
        </CardContent>
      </Card>

      {/* Field Form */}
      <FormFieldsCard value={cfg.formConfig} onChange={setFC} disabled={!canWrite} />

      {/* Urgensi */}
      <Card>
        <CardHeader>
          <CardTitle>Urgensi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="countdown">Countdown (menit)</Label>
            <Input
              id="countdown"
              type="number"
              min={0}
              max={180}
              value={cfg.countdownMinutes}
              onChange={(e) => set("countdownMinutes", Number(e.target.value))}
              className="w-32"
              disabled={!canWrite}
            />
            <p className="text-xs text-muted-foreground">0 = tanpa countdown.</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Tampilkan sisa stok</div>
              <p className="text-sm text-muted-foreground">Angka nyata dari stok varian terpilih.</p>
            </div>
            <Switch checked={cfg.showScarcity} onCheckedChange={(v) => set("showScarcity", v)} disabled={!canWrite} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/promo" />}>
          Batal
        </Button>
        <Button onClick={save} disabled={!canWrite || saving}>
          {saving ? "Menyimpan…" : "Simpan Perubahan"}
        </Button>
      </div>
    </div>
  );
}
