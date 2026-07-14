"use client";
import * as React from "react";
import { toast } from "sonner";
import { ChevronDown, Truck, Info, Loader2, Lock, MapPinOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Switch } from "@tokophi/ui/switch";
import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import { useCan } from "@/components/admin/permissions";
import {
  getPlatformServices,
  getStoreServices,
  getCourierCoverage,
  saveStoreServices,
  getCodEnabled,
  setCodEnabled,
  type PlatformService,
} from "@/lib/actions/shipping";
import { courierName, isBaselineCourier } from "@tokophi/lib/couriers";

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

// Why a baseline courier's switch is greyed out. Written for a shop owner, not for us: no provider
// names, no "chain", no talk of rails or fallbacks.
const BASELINE_REASON: Record<string, string> = {
  spx: "Layanan utama toko dan satu-satunya yang melayani COD — selalu aktif.",
  jne: "Cadangan untuk rute yang tidak dijangkau layanan utama — selalu aktif.",
};
const baselineReason = (courier: string) =>
  BASELINE_REASON[courier] ?? "Layanan dasar toko — selalu aktif.";

export function JasaKirimCard() {
  const canWrite = useCan("settings:write");
  const [loading, setLoading] = React.useState(true);
  const [saving, start] = React.useTransition();

  const [services, setServices] = React.useState<PlatformService[]>([]);
  const [on, setOn] = React.useState<Record<string, boolean>>({});
  // code → true = collects from this store's pickup address. `null` = we do not know (no probe yet)
  // → render NO coverage state. An unverified claim about what the shopper sees is the bug we are
  // here to fix, not a bug to reintroduce with nicer wording.
  const [coverage, setCoverage] = React.useState<Record<string, boolean> | null>(null);
  const [cod, setCod] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [platform, mine, codOn, cov] = await Promise.all([
        getPlatformServices(),
        getStoreServices(),
        getCodEnabled(),
        getCourierCoverage(),
      ]);
      if (!alive) return;
      setServices(platform);
      // First visit (nothing saved yet) → default every platform service ON, so a new store can
      // sell immediately instead of silently having zero shipping options at checkout.
      const picked: Record<string, boolean> = mine.length
        ? Object.fromEntries(mine.map((m) => [key(m), true]))
        : Object.fromEntries(platform.map((p) => [key(p), true]));
      // Baseline couriers are ON, always — including for a store saved before the rule existed, or
      // by a hand-posted payload. Forcing them on here (rather than only rendering them as locked)
      // is what keeps the screen honest: the switch the seller sees and the payload the Simpan
      // button sends say the same thing.
      for (const p of platform) if (isBaselineCourier(p.courier)) picked[key(p)] = true;
      setOn(picked);
      setCod(codOn);
      setCoverage(cov);
      setOpen(Object.fromEntries(GROUPS.map((g) => [g.key, true])));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const codCapable = services.filter((s) => s.codAllowed);
  const codCouriers = [...new Set(codCapable.map((s) => courierName(s.courier)))];

  // SPX and JNE are baseline (@tokophi/lib/couriers): their switches are locked ON. Not a courtesy
  // rail the seller can talk themselves out of — switching off the primary silently kills COD (it is
  // the only COD rail) and switching off the backup leaves the routes the primary does not serve
  // with no shipping at all. Neither failure announces itself; the option simply stops appearing at
  // checkout. The seller keeps full control of the other six couriers.
  //
  // The lock is an AFFORDANCE. `saveStoreServices` re-checks it on the server, because a disabled
  // switch stops a seller, not a POST.
  const isLocked = (s: PlatformService) => isBaselineCourier(s.courier);

  // `false` = the probe priced a route from this store's pickup district and this courier did not
  // quote. `undefined` = unknown (no probe) → say nothing.
  const collects = (courier: string): boolean | undefined => coverage?.[courier];

  const save = () =>
    start(async () => {
      const picked = services.filter((s) => on[key(s)]).map((s) => ({ courier: s.courier, type: s.type }));
      if (!picked.length) {
        toast.error("Pilih minimal satu layanan — tanpa itu pembeli tidak bisa checkout.");
        return;
      }
      const [a, b] = await Promise.all([saveStoreServices(picked), setCodEnabled(cod)]);
      if (a.ok && b.ok) toast.success("Jasa kirim disimpan.");
      else toast.error(a.error ?? b.error ?? "Gagal menyimpan.");
    });

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Memuat layanan kirim…
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
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Aktifkan COD</div>
              <div className="text-xs text-muted-foreground">
                {codCouriers.length
                  ? `Tersedia lewat ${codCouriers.join(", ")}.`
                  : "Belum ada layanan yang mendukung COD."}
              </div>
            </div>
            <Switch checked={cod} onCheckedChange={setCod} disabled={!canWrite || !codCapable.length} />
          </div>
          {cod && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                COD berjalan lewat <span className="font-medium text-foreground">{codCouriers.join(", ") || "layanan COD"}</span> —
                karena itu layanan tersebut tidak bisa dimatikan selama COD aktif. COD hanya muncul di checkout untuk layanan
                berlabel <span className="font-medium text-foreground">COD</span> di bawah. Bila pembeli menolak paket, ongkos retur
                mengikuti ketentuan kurir — itu sebabnya tidak semua layanan dibuka untuk COD.
              </span>
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
          {/* The sentence this whole screen exists for: a switch is a PERMISSION, not a promise. */}
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              Layanan yang benar-benar muncul di checkout tergantung rutenya: kurir menentukan sendiri apakah mereka
              melayani jalur dari alamat jemput Anda ke alamat pembeli. Jadi layanan yang aktif di sini belum tentu
              tampil pada setiap pesanan.
            </span>
          </div>

          {GROUPS.map((g) => {
            const list = services.filter((s) => s.group === g.key);
            if (!list.length) return null;
            // Don't count a courier that cannot collect from this store toward "3/5 aktif" — it is
            // not active in any sense the seller cares about.
            const activeCount = list.filter((s) => on[key(s)] && collects(s.courier) !== false).length;
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
                      const locked = isLocked(s);
                      const uncovered = collects(s.courier) === false;
                      return (
                        <div
                          key={k}
                          className={cn(
                            "flex items-center justify-between gap-4 px-4 py-3",
                            (!enabled || uncovered) && "opacity-60",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium">{s.name}</span>
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                                {courierName(s.courier)}
                              </Badge>
                              {s.codAllowed && !uncovered && (
                                <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] hover:bg-emerald-600">COD</Badge>
                              )}
                              {locked && (
                                <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
                                  <Lock className="size-2.5" /> Wajib
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {/* Coverage first: if the courier never collects from here, whether it
                                  supports COD is a detail about a service the shopper cannot pick. */}
                              {uncovered ? (
                                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-500">
                                  <MapPinOff className="size-3 shrink-0" />
                                  Tidak menjemput dari alamat jemputmu — layanan ini tidak akan tampil di checkout.
                                </span>
                              ) : locked ? (
                                baselineReason(s.courier)
                              ) : s.codAllowed ? (
                                cod
                                  ? "COD aktif untuk layanan ini."
                                  : "Mendukung COD — aktifkan COD di atas."
                              ) : (
                                "Tidak mendukung COD."
                              )}
                            </div>
                          </div>
                          {uncovered ? (
                            // No switch at all. A green toggle that can never produce a rate is the
                            // exact lie this screen was rebuilt to stop telling.
                            <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-muted-foreground">
                              Tidak tersedia
                            </Badge>
                          ) : (
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => setOn((o) => ({ ...o, [k]: v }))}
                              disabled={!canWrite || locked}
                            />
                          )}
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
