"use client";
import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Truck, Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Switch } from "@tokophi/ui/switch";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import { useCan } from "@/components/admin/permissions";
import {
  getPlatformServices,
  getStoreServices,
  saveStoreServices,
  getCodEnabled,
  setCodEnabled,
  getFreeShip,
  setFreeShip,
  type PlatformService,
} from "@/lib/actions/shipping";
import { courierName } from "@tokophi/lib/couriers";

// KiriminAja's own speed classes (the `group` on every rate). Grouping the page by them — rather
// than by courier — is what makes it read like a shipping menu instead of a vendor list: a seller
// thinks "I want next-day", not "I want JNE".
const GROUPS: { key: string; label: string; desc: string }[] = [
  { key: "one_day", label: "Same Day", desc: "Tiba di hari yang sama." },
  { key: "next_day", label: "Next Day", desc: "Tiba keesokan harinya." },
  { key: "regular", label: "Reguler", desc: "Layanan standar, 1–3 hari tergantung tujuan." },
  { key: "economy", label: "Hemat", desc: "Ongkir termurah, waktu tempuh lebih lama." },
  { key: "cargo", label: "Kargo", desc: "Untuk kiriman berat/besar." },
];

const key = (s: { courier: string; type: string }) => `${s.courier}:${s.type}`;

export function JasaKirimCard() {
  const canWrite = useCan("settings:write");
  const [loading, setLoading] = React.useState(true);
  const [saving, start] = React.useTransition();

  const [services, setServices] = React.useState<PlatformService[]>([]);
  const [on, setOn] = React.useState<Record<string, boolean>>({});
  const [cod, setCod] = React.useState(false);
  const [freeShip, setFreeShipOn] = React.useState(false); // PROMO P1 — automatic free shipping
  const [freeShipMin, setFreeShipMin] = React.useState(""); // Rp threshold as a string (input)
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [platform, mine, codOn, fs] = await Promise.all([getPlatformServices(), getStoreServices(), getCodEnabled(), getFreeShip()]);
      if (!alive) return;
      setFreeShipOn(fs.enabled);
      setFreeShipMin(fs.minIdr ? String(fs.minIdr) : "");
      setServices(platform);
      // First visit (nothing saved yet) → default every platform service ON, so a new store can
      // sell immediately instead of silently having zero shipping options at checkout.
      const picked = mine.length
        ? Object.fromEntries(mine.map((m) => [key(m), true]))
        : Object.fromEntries(platform.map((p) => [key(p), true]));
      setOn(picked);
      setCod(codOn);
      setOpen(Object.fromEntries(GROUPS.map((g) => [g.key, true])));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const codCapable = services.filter((s) => s.codAllowed);
  const codCouriers = [...new Set(codCapable.map((s) => courierName(s.courier)))];

  const save = () =>
    start(async () => {
      const picked = services.filter((s) => on[key(s)]).map((s) => ({ courier: s.courier, type: s.type }));
      if (!picked.length) {
        toast.error("Pilih minimal satu layanan — tanpa itu pembeli tidak bisa checkout.");
        return;
      }
      const [a, b, c] = await Promise.all([
        saveStoreServices(picked),
        setCodEnabled(cod),
        setFreeShip({ enabled: freeShip, minIdr: Number((freeShipMin || "").replace(/[^\d]/g, "")) || 0 }),
      ]);
      if (a.ok && b.ok && c.ok) toast.success("Jasa kirim disimpan.");
      else toast.error(a.error ?? b.error ?? "Gagal menyimpan.");
    });

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Memuat layanan dari KiriminAja…
        </CardContent>
      </Card>
    );
  }

  if (!services.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Belum ada layanan kirim yang diaktifkan platform. Hubungi TokoΦ.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── COD ─────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Bayar di Tempat (COD)</CardTitle>
          <CardDescription>Pembeli membayar tunai saat paket tiba. Dana diteruskan ke saldo Anda setelah kurir menyetor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 20 switches on this one card had NO accessible name at all — measured in Chromium
              2026-08-05 (`Accessibility.getPartialAXTree`) on /pengaturan → Pengiriman. The audit
              that fixed /pengaturan fixed only the toggles routed through `ToggleRow`; every switch
              on this card is hand-rolled and was missed. `htmlFor` on the text already on screen is
              the fix — Base UI's Switch republishes it as `aria-labelledby`. */}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <label htmlFor="cod-enabled" className="block text-sm font-medium">Aktifkan COD</label>
              <div className="text-xs text-muted-foreground">
                {codCouriers.length
                  ? `Tersedia lewat ${codCouriers.join(", ")}.`
                  : "Belum ada layanan yang mendukung COD."}
              </div>
            </div>
            <Switch id="cod-enabled" checked={cod} onCheckedChange={setCod} disabled={!canWrite || !codCapable.length} />
          </div>
          {cod && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                COD hanya muncul di checkout untuk layanan berlabel <span className="font-medium text-foreground">COD</span> di bawah.
                Bila pembeli menolak paket, ongkos retur mengikuti ketentuan kurir — karena itu tidak semua layanan dibuka untuk COD.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Gratis ongkir otomatis (PROMO P1) ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Gratis Ongkir Otomatis</CardTitle>
          <CardDescription>Beri gratis ongkir otomatis saat belanja mencapai batas minimum — tanpa perlu kode voucher.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <label htmlFor="free-ship-on" className="block text-sm font-medium">Aktifkan gratis ongkir</label>
              <div className="text-xs text-muted-foreground">Ongkir otomatis Rp0 di checkout saat syarat terpenuhi.</div>
            </div>
            <Switch id="free-ship-on" checked={freeShip} onCheckedChange={setFreeShipOn} disabled={!canWrite} />
          </div>
          {freeShip && (
            <div className="grid gap-1.5 rounded-lg border p-3">
              <label htmlFor="free-ship-min" className="text-sm font-medium">Minimum belanja</label>
              <div className="relative max-w-48">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                <Input id="free-ship-min" inputMode="numeric" value={freeShipMin}
                  onChange={(e) => setFreeShipMin(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0" className="pl-8 tabular-nums" disabled={!canWrite} />
              </div>
              <p className="text-xs text-muted-foreground">Belanja ≥ nilai ini → ongkir gratis. Kosong/0 = selalu gratis.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Jasa kirim, dikelompokkan seperti menu ──────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4 text-muted-foreground" /> Jasa Kirim
          </CardTitle>
          <CardDescription>
            Pilih layanan yang ditawarkan ke pembeli saat checkout. Tarif &amp; resi otomatis dari TokoΦ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {GROUPS.map((g) => {
            const list = services.filter((s) => s.group === g.key);
            if (!list.length) return null;
            const activeCount = list.filter((s) => on[key(s)]).length;
            const isOpen = open[g.key];
            return (
              <div key={g.key} className="rounded-xl border">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{g.label}</span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                        {activeCount}/{list.length}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{g.desc}</div>
                  </div>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>

                {isOpen && (
                  <div className="divide-y border-t">
                    {list.map((s) => {
                      const k = key(s);
                      const enabled = !!on[k];
                      return (
                        <div key={k} className={cn("flex items-center justify-between gap-4 px-4 py-3", !enabled && "opacity-60")}>
                          <div className="min-w-0">
                            {/* The whole title row is the label, badges included, so the switch is
                                announced "Reguler, SPX, COD" rather than a bare "Reguler" that is
                                identical across five couriers. The name is exactly what is on
                                screen — nothing paraphrased, nothing to drift. */}
                            <label htmlFor={`svc-${k}`} className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium">{s.name}</span>
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                                {courierName(s.courier)}
                              </Badge>
                              {s.codAllowed && (
                                <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] hover:bg-emerald-600">COD</Badge>
                              )}
                            </label>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {s.codAllowed
                                ? cod
                                  ? "COD aktif untuk layanan ini."
                                  : "Mendukung COD — aktifkan COD di atas."
                                : "Tidak mendukung COD."}
                            </div>
                          </div>
                          <Switch
                            id={`svc-${k}`}
                            checked={enabled}
                            onCheckedChange={(v) => setOn((o) => ({ ...o, [k]: v }))}
                            disabled={!canWrite}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {canWrite && (
            <div className="flex justify-end border-t pt-4">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />} Simpan
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
