"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Truck, Users, UserPlus, Save, ChevronDown, Plug } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Switch } from "@tokophi/ui/switch";
import { Label } from "@tokophi/ui/label";
import { Input } from "@tokophi/ui/input";
import { Separator } from "@tokophi/ui/separator";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@tokophi/ui/dropdown-menu";
import { cn } from "@tokophi/ui/lib/utils";
import { initials } from "@/components/bits";
import { saveGateways, saveCouriers, savePaymentChannels, syncPaymentChannels, invitePlatformAdmin, testKiriminajaConnection, testAutolarisConnection } from "@/lib/actions";
import type { PaymentChannelRow } from "@/lib/data";

type Toggle = { key: string; name: string; desc: string; on: boolean };
type TeamMember = { id: string; name: string; email: string; role: string };

const ROLE_CLASS: Record<string, string> = {
  owner: "bg-primary/12 text-primary",
  admin: "bg-chart-3/15 text-chart-3",
  support: "bg-muted text-foreground",
};
const roleLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
const ROLE_OPTIONS = ["admin", "support", "owner"];

export function PengaturanClient({
  gateways: initGateways,
  couriers: initCouriers,
  channels: initChannels,
  aggregator,
  team,
}: {
  gateways: Toggle[];
  couriers: Toggle[];
  channels: PaymentChannelRow[];
  aggregator: { provider: string; enabled: boolean };
  team: TeamMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gateways, setGateways] = useState(initGateways);
  const [couriers, setCouriers] = useState(initCouriers);
  const [channels, setChannels] = useState(initChannels);
  const autoGateway = gateways.find((g) => g.key === "autolaris");
  const codGateway = gateways.find((g) => g.key === "cod");

  // KiriminAja live connectivity test
  const [ping, setPing] = useState<{ ok: boolean; message: string } | null>(null);
  const [pinging, startPing] = useTransition();
  const testConn = () =>
    startPing(async () => {
      const r = await testKiriminajaConnection();
      setPing({ ok: r.ok, message: r.message });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  // AutoLaris payment-gateway connectivity test
  const [payPing, setPayPing] = useState<{ ok: boolean; message: string } | null>(null);
  const [payTesting, startPayPing] = useTransition();
  const [chanSyncing, startChanSync] = useTransition();
  const syncChannels = () =>
    startChanSync(async () => {
      await syncPaymentChannels();
      router.refresh(); // reloads channels with fresh active/enabled from AutoLaris probe
      toast.success("Channel disinkron dari AutoLaris.");
    });
  const toggleChannel = (key: string, on: boolean) =>
    setChannels((prev) => prev.map((c) => (c.key === key ? { ...c, enabled: on } : c)));
  // One "Simpan" for the whole payment section: PSP gateways (AutoLaris + COD) AND channels.
  const savePayment = () =>
    startTransition(async () => {
      await saveGateways(gateways.map((g) => ({ key: g.key, on: g.on })));
      await savePaymentChannels(channels.map((c) => ({ key: c.key, on: c.enabled })));
      toast.success("Pengaturan pembayaran disimpan.");
      router.refresh();
    });
  const testPay = () =>
    startPayPing(async () => {
      const r = await testAutolarisConnection();
      setPayPing({ ok: r.ok, message: r.message });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  // invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invName, setInvName] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("admin");

  const toggle = (setter: Dispatch<SetStateAction<Toggle[]>>, key: string, on: boolean) =>
    setter((prev) => prev.map((t) => (t.key === key ? { ...t, on } : t)));

  const saveCouriersFn = () =>
    startTransition(async () => {
      await saveCouriers(couriers.map((t) => ({ key: t.key, on: t.on })));
      toast.success("Pengaturan kurir disimpan.");
      router.refresh();
    });

  function submitInvite() {
    startTransition(async () => {
      const r = await invitePlatformAdmin({ name: invName, email: invEmail, role: invRole });
      if (r.ok) {
        toast.success(`Operator ${invEmail} ditambahkan.`);
        setInviteOpen(false);
        setInvName("");
        setInvEmail("");
        setInvRole("admin");
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal mengundang operator.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">
          Gateway pembayaran, COD, dan kurir diatur di sini oleh platform — berlaku untuk{" "}
          <span className="font-medium text-foreground">semua toko</span>. Merchant hanya mengaktifkan metode di tokonya.
        </p>
      </div>

      {/* payment — unified PSP (AutoLaris) + COD + channels, mirrors the courier card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" /> Pembayaran
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {/* aggregator banner (same treatment as the courier aggregator) */}
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span>Agregator pembayaran: <span className="font-medium">{autoGateway?.name ?? "AutoLaris"}</span> · API pembayaran dikelola platform</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {autoGateway?.on && (
                  <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                )}
                <Button variant="outline" size="sm" className="gap-1.5" disabled={chanSyncing} onClick={syncChannels}>
                  <Plug className="size-3.5" /> {chanSyncing ? "Menyinkron…" : "Sync"}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={payTesting} onClick={testPay}>
                  <Plug className="size-3.5" /> {payTesting ? "Menguji…" : "Test koneksi"}
                </Button>
              </div>
            </div>
            {payPing && (
              <p className={`mt-2 text-xs ${payPing.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {payPing.ok ? "✓ " : "✕ "}{payPing.message}
              </p>
            )}
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Aktifkan metode untuk semua toko — merchant lalu memilih yang ia pakai di checkout. <b>Sync</b> mengecek langsung channel mana yang aktif di akun AutoLaris (tak ada endpoint daftar) lalu menandainya.
          </p>

          {/* row list: COD (platform) + AutoLaris channels, one flat list like couriers */}
          {codGateway && (
            <div>
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="gw-cod" className="font-medium">{codGateway.name}</Label>
                    {codGateway.on && (
                      <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{codGateway.desc}</p>
                </div>
                <Switch id="gw-cod" checked={codGateway.on} onCheckedChange={(v) => toggle(setGateways, "cod", v)} />
              </div>
            </div>
          )}
          {channels.map((c) => (
            <div key={c.key}>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`ch-${c.key}`} className="font-medium">{c.label}</Label>
                    {c.active && (
                      <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif di AutoLaris</Badge>
                    )}
                  </div>
                  <p className="text-[11px] uppercase text-muted-foreground">{c.kind} · {c.key}</p>
                </div>
                <Switch id={`ch-${c.key}`} checked={c.enabled} onCheckedChange={(v) => toggleChannel(c.key, v)} />
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-3">
            <Button className="gap-1.5" disabled={pending} onClick={savePayment}>
              <Save className="size-4" /> Simpan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* couriers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4 text-muted-foreground" /> Integrasi Kurir
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Truck className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span>Agregator pengiriman: <span className="font-medium">{aggregator.provider}</span> · API kurir dikelola platform</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {aggregator.enabled && (
                  <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                )}
                <Button variant="outline" size="sm" className="gap-1.5" disabled={pinging} onClick={testConn}>
                  <Plug className="size-3.5" /> {pinging ? "Menguji…" : "Test koneksi"}
                </Button>
              </div>
            </div>
            {ping && (
              <p className={`mt-2 text-xs ${ping.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {ping.ok ? "✓ " : "✕ "}{ping.message}
              </p>
            )}
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            Kurir disediakan lewat agregator. Aktifkan yang tersedia untuk semua toko — merchant lalu memilih kurir &amp; layanannya.
          </p>
          {couriers.map((c, i) => (
            <div key={c.key}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`ku-${c.key}`} className="font-medium">{c.name}</Label>
                    {c.on && (
                      <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.desc}</p>
                </div>
                <Switch id={`ku-${c.key}`} checked={c.on} onCheckedChange={(v) => toggle(setCouriers, c.key, v)} />
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-3">
            <Button className="gap-1.5" disabled={pending} onClick={saveCouriersFn}>
              <Save className="size-4" /> Simpan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* platform team (real operators) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" /> Tim Platform
          </CardTitle>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5"><UserPlus className="size-4" /> Undang</Button>} />
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Undang operator platform</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="inv-name">Nama</Label>
                  <Input id="inv-name" value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="Nama operator" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="inv-email">Email</Label>
                  <Input id="inv-email" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="nama@tokophi.id" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Peran</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" className="justify-between gap-2 font-normal">{roleLabel(invRole)}<ChevronDown className="size-4 text-muted-foreground" /></Button>} />
                    <DropdownMenuContent align="start" className="w-[--anchor-width]">
                      {ROLE_OPTIONS.map((r) => (
                        <DropdownMenuItem key={r} onClick={() => setInvRole(r)}>{roleLabel(r)}</DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="text-xs text-muted-foreground">Password awal: <span className="font-mono">tokophi123</span> (operator ganti setelah masuk).</p>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Batal</Button>} />
                <Button disabled={pending || !invEmail} onClick={submitInvite}>{pending ? "Menyimpan…" : "Undang"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-0">
          {team.map((m, i) => (
            <div key={m.id}>
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </div>
                </div>
                <Badge className={cn(ROLE_CLASS[m.role] ?? "bg-muted text-foreground")}>{roleLabel(m.role)}</Badge>
              </div>
            </div>
          ))}
          {team.length === 0 && <p className="py-4 text-sm text-muted-foreground">Belum ada operator.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
