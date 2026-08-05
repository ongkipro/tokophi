"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Zap, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { createFlashSale, updateFlashSale, deleteFlashSale, type FlashInput } from "@/lib/actions/flash";
import type { FlashSaleEditor } from "@/lib/data/flash";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Switch } from "@tokophi/ui/switch";

type ProductRow = { id: string; title: string; basePrice: number };

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time; toISOString is UTC. Build the local string by
// hand so the value the merchant sees is the value they picked (no timezone shift on the way in).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function FlashEditor({
  sale,
  products,
  defaultStartsAt,
  defaultEndsAt,
}: {
  sale?: FlashSaleEditor;
  products: ProductRow[];
  defaultStartsAt: string;
  defaultEndsAt: string;
}) {
  const router = useRouter();
  const canWrite = useCan("discounts:write");
  const isNew = !sale;

  const [name, setName] = React.useState(sale?.name ?? "");
  const [active, setActive] = React.useState((sale?.status ?? "aktif") !== "nonaktif");
  const [startsAt, setStartsAt] = React.useState(toLocalInput(sale?.startsAt ?? defaultStartsAt));
  const [endsAt, setEndsAt] = React.useState(toLocalInput(sale?.endsAt ?? defaultEndsAt));

  // productId → sale price as a string ("" = not on this sale). Seeded from the sale's existing items.
  const [prices, setPrices] = React.useState<Record<string, string>>(() =>
    Object.fromEntries((sale?.items ?? []).map((i) => [i.productId, String(i.salePriceIdr)])),
  );
  const [saving, start] = React.useTransition();

  const setPrice = (id: string, v: string) =>
    setPrices((p) => ({ ...p, [id]: v.replace(/[^\d]/g, "") }));
  const toggle = (id: string, on: boolean, base: number) =>
    setPrices((p) => {
      const next = { ...p };
      if (on) next[id] = next[id] || String(Math.round(base * 0.8)); // default 20% off — a sensible start
      else delete next[id];
      return next;
    });

  const selectedCount = Object.values(prices).filter((v) => Number(v) > 0).length;

  function buildInput(): FlashInput {
    return {
      name: name.trim(),
      // Scheduling by date is what makes a sale "terjadwal": if it starts in the future, say so; the
      // storefront/order still gate on the window, this is just the honest label. Off → nonaktif.
      status: !active ? "nonaktif" : new Date(startsAt).getTime() > Date.now() ? "terjadwal" : "aktif",
      startsAt: startsAt ? new Date(startsAt).toISOString() : "",
      endsAt: endsAt ? new Date(endsAt).toISOString() : "",
      items: Object.entries(prices)
        .filter(([, v]) => Number(v) > 0)
        .map(([productId, v]) => ({ productId, salePriceIdr: Number(v) })),
    };
  }

  function validate(input: FlashInput): string | null {
    if (!input.name) return "Nama flash sale wajib diisi.";
    if (!input.startsAt || !input.endsAt) return "Tanggal mulai & berakhir wajib diisi.";
    if (new Date(input.endsAt) <= new Date(input.startsAt)) return "Tanggal berakhir harus setelah mulai.";
    if (!input.items.length) return "Pilih minimal satu produk dan isi harga promonya.";
    return null;
  }

  const save = () =>
    start(async () => {
      const input = buildInput();
      const err = validate(input);
      if (err) return void toast.error(err);
      try {
        // ⚠️ The action RETURNS its rule failures now (Next masks a thrown Error in production, so the
        // merchant got a digest instead of "Tanggal berakhir harus setelah tanggal mulai"). That means
        // the result has to be READ — awaiting and ignoring it would report "Flash sale dibuat." over a
        // save that did not happen. The `catch` stays for genuine failures, which still throw.
        const r = isNew ? await createFlashSale(input) : await updateFlashSale(sale!.id, input);
        if (!r.ok) return void toast.error(r.error, { duration: 9000 });
        toast.success(isNew ? "Flash sale dibuat." : "Flash sale disimpan.");
        router.push("/flash-sale");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal menyimpan — coba lagi.");
      }
    });

  const del = () =>
    start(async () => {
      try {
        await deleteFlashSale(sale!.id);
        toast.success("Flash sale dihapus.");
        router.push("/flash-sale");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus — coba lagi.");
      }
    });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-2">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/flash-sale" />}>
          <ArrowLeft /> Flash Sale
        </Button>
      </div>
      <PageHeader
        title={isNew ? "Flash Sale Baru" : "Edit Flash Sale"}
        desc="Turunkan harga produk pilihan untuk jangka waktu tertentu. Harga otomatis kembali normal setelah periode berakhir."
      />

      <div className="space-y-5">
        {/* Detail */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="size-4 text-amber-500" /> Detail</CardTitle>
            <CardDescription>Nama, jadwal, dan status kampanye.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <label htmlFor="fs-name" className="text-sm font-medium">Nama flash sale</label>
              <Input id="fs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo Gajian" disabled={!canWrite} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor="fs-start" className="text-sm font-medium">Mulai</label>
                <Input id="fs-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={!canWrite} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="fs-end" className="text-sm font-medium">Berakhir</label>
                <Input id="fs-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={!canWrite} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <label htmlFor="fs-active" className="block text-sm font-medium">Aktifkan</label>
                <div className="text-xs text-muted-foreground">Nonaktif = harga tetap normal walau di dalam jadwal.</div>
              </div>
              <Switch id="fs-active" checked={active} onCheckedChange={setActive} disabled={!canWrite} />
            </div>
          </CardContent>
        </Card>

        {/* Products */}
        <Card>
          <CardHeader>
            <CardTitle>Produk &amp; Harga Promo</CardTitle>
            <CardDescription>
              Centang produk, lalu isi harga promonya. {selectedCount > 0 && <span className="font-medium text-foreground">{selectedCount} produk dipilih.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {products.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada produk aktif.</p>}
            {products.map((p) => {
              const raw = prices[p.id];
              const on = raw != null;
              const salePrice = Number(raw || 0);
              const pct = on && salePrice > 0 && salePrice < p.basePrice ? Math.round(((p.basePrice - salePrice) / p.basePrice) * 100) : 0;
              return (
                <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${on ? "border-amber-300 bg-amber-50/40" : ""}`}>
                  {/* One switch per product, so this shape multiplies: the catalogue rendered 22
                      nameless switches in a column (measured 2026-08-05). `truncate` needs a block
                      box, which is why the label carries `block` — the shared <Label> is a flex
                      container and would break the ellipsis. */}
                  <Switch id={`fs-p-${p.id}`} checked={on} onCheckedChange={(v) => toggle(p.id, v, p.basePrice)} disabled={!canWrite} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`fs-p-${p.id}`} className="block truncate text-sm font-medium">{p.title}</label>
                    <div className="text-xs text-muted-foreground">Harga normal {IDR(p.basePrice)}</div>
                  </div>
                  {on && (
                    <div className="flex items-center gap-2">
                      <div className="relative w-36">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                        {/* No visible text label by design — the row's product name is the only
                            heading and the "Rp" is an adornment. A placeholder of "0" is what the
                            browser would otherwise announce as this field's name. */}
                        <Input aria-label={`Harga promo ${p.title}`} inputMode="numeric" value={raw} onChange={(e) => setPrice(p.id, e.target.value)} placeholder="0" className="pl-8 tabular-nums" disabled={!canWrite} />
                      </div>
                      {pct > 0 ? (
                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">−{pct}%</span>
                      ) : salePrice >= p.basePrice && salePrice > 0 ? (
                        <span className="text-xs text-red-600">≥ harga normal</span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {canWrite && (
          <div className="flex items-center justify-between">
            {!isNew ? (
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={del} disabled={saving}>
                <Trash2 /> Hapus
              </Button>
            ) : <span />}
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />} {isNew ? "Buat Flash Sale" : "Simpan"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
