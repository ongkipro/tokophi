"use client";
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, Info, QrCode, Landmark, Wallet, Store, HandCoins } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPlatformChannels, getStoreChannels, saveStoreChannels } from "@/lib/actions/payment-settings";
import { useCan } from "@/components/admin/permissions";

type Ch = { channel: string; label: string; kind: string };
const GROUPS: { kind: string; label: string; desc: string; icon: React.ReactNode }[] = [
  { kind: "qris", label: "QRIS", desc: "Satu QR untuk semua bank & e-wallet", icon: <QrCode className="size-4" /> },
  { kind: "va", label: "Virtual Account", desc: "Transfer bank (VA)", icon: <Landmark className="size-4" /> },
  { kind: "ewallet", label: "E-Wallet", desc: "Dompet digital", icon: <Wallet className="size-4" /> },
  { kind: "retail", label: "Minimarket", desc: "Bayar tunai di gerai retail", icon: <Store className="size-4" /> },
];
const COD: Ch = { channel: "COD", label: "COD (Bayar di Tempat)", kind: "cod" };

export function PaymentMethodsCard() {
  const canSave = useCan("settings:write");
  const [pending, start] = React.useTransition();
  const [available, setAvailable] = React.useState<Ch[] | null>(null); // null = loading
  const [on, setOn] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    (async () => {
      const [platform, chosen] = await Promise.all([getPlatformChannels(), getStoreChannels()]);
      const avail = [COD, ...platform];
      setAvailable(avail);
      // NULL selection = offer everything the platform makes available
      setOn(new Set(chosen ?? avail.map((c) => c.channel)));
    })();
  }, []);

  const toggle = (channel: string, val: boolean) => {
    const next = new Set(on);
    if (val) next.add(channel); else next.delete(channel);
    setOn(next);
    if (!canSave) return;
    start(async () => {
      const r = await saveStoreChannels([...next]);
      if (r.ok) toast.success("Metode pembayaran diperbarui.");
      else toast.error(r.error ?? "Gagal menyimpan.");
    });
  };

  const cod = available?.find((c) => c.channel === "COD");
  const activeCount = available ? available.filter((c) => on.has(c.channel)).length : 0;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Metode Pembayaran</CardTitle>
        <CardDescription>Pilih metode yang ditawarkan ke pembeli saat checkout.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Gateway pembayaran &amp; COD dikelola oleh <span className="font-medium text-foreground">TokoΦ</span> — Anda cukup memilih yang ingin diterima. Metode yang tampil di sini sudah diaktifkan platform.</span>
        </div>

        {available === null ? (
          <p className="py-4 text-sm text-muted-foreground">Memuat metode…</p>
        ) : available.length <= 1 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Belum ada channel pembayaran yang diaktifkan platform. Hubungi TokoΦ.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{activeCount}</span> metode aktif</p>

            {/* COD — standalone */}
            {cod && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-3 text-sm">
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"><HandCoins className="size-4" /></span>
                  <span>
                    <span className="block font-medium">{cod.label}</span>
                    <span className="block text-xs text-muted-foreground">Bayar tunai saat pesanan tiba</span>
                  </span>
                </span>
                <Switch checked={on.has("COD")} disabled={!canSave} onCheckedChange={(v) => toggle("COD", v)} />
              </div>
            )}

            {/* grouped channels */}
            {GROUPS.map((g) => {
              const rows = available.filter((c) => c.kind === g.kind);
              if (rows.length === 0) return null;
              return <Group key={g.kind} group={g} rows={rows} on={on} canSave={canSave} onToggle={toggle} />;
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Group({ group, rows, on, canSave, onToggle }: {
  group: { kind: string; label: string; desc: string; icon: React.ReactNode };
  rows: Ch[]; on: Set<string>; canSave: boolean; onToggle: (c: string, v: boolean) => void;
}) {
  const activeCount = rows.filter((r) => on.has(r.channel)).length;
  const [open, setOpen] = React.useState(activeCount > 0);
  return (
    <div className="overflow-hidden rounded-lg border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{group.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="text-sm font-medium">{group.label}</span><span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{activeCount}/{rows.length}</span></span>
          <span className="block truncate text-xs text-muted-foreground">{group.desc}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-3">
          {rows.map((c, i) => (
            <div key={c.channel}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-[11px] uppercase text-muted-foreground">{c.channel}</p>
                </div>
                <Switch checked={on.has(c.channel)} disabled={!canSave} onCheckedChange={(v) => onToggle(c.channel, v)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
