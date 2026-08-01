"use client";

import { useState, useTransition, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Truck, Users, UserPlus, Save, ChevronDown, Plug, QrCode, Landmark, Smartphone, Store, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";
import type { CourierRow } from "@/lib/data";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Switch } from "@tokophi/ui/switch";
import { Checkbox } from "@tokophi/ui/checkbox";
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
import { saveGateways, saveCouriers, savePaymentChannels, syncPaymentChannels, invitePlatformAdmin, testKiriminajaConnection, testAutolarisConnection, saveCodAllowed, syncCouriersFromKiriminaja } from "@/lib/actions";
import type { PaymentChannelRow } from "@/lib/data";

type Toggle = { key: string; name: string; desc: string; on: boolean };

// KiriminAja's own speed classes, in the words a merchant uses.
const GROUP_LABEL: Record<string, string> = {
  regular: "Reguler", one_day: "Same Day", next_day: "Next Day", economy: "Hemat", cargo: "Kargo",
};
type TeamMember = { id: string; name: string; email: string; role: string };

const ROLE_CLASS: Record<string, string> = {
  owner: "bg-primary/12 text-primary",
  admin: "bg-chart-3/15 text-chart-3",
  support: "bg-muted text-foreground",
};
const roleLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
const ROLE_OPTIONS = ["admin", "support", "owner"];

type SectionId = "pembayaran" | "kurir" | "tim";
const SECTIONS: { id: SectionId; label: string; desc: string; icon: ReactNode }[] = [
  { id: "pembayaran", label: "Pembayaran", desc: "AutoLaris & COD", icon: <CreditCard /> },
  { id: "kurir", label: "Kurir", desc: "Agregator KiriminAja", icon: <Truck /> },
  { id: "tim", label: "Tim Platform", desc: "Operator", icon: <Users /> },
];

// Payment channels are grouped by `kind` — QRIS on its own, then Virtual Account / E-Wallet /
// Minimarket as collapsible groups so the long list stays tidy (matches how AutoLaris organizes them).
const CHANNEL_GROUPS: { kind: string; label: string; desc: string; icon: ReactNode }[] = [
  { kind: "qris", label: "QRIS", desc: "Satu QR untuk semua bank & e-wallet", icon: <QrCode className="size-4" /> },
  { kind: "va", label: "Virtual Account", desc: "Transfer bank (VA)", icon: <Landmark className="size-4" /> },
  { kind: "ewallet", label: "E-Wallet", desc: "Dompet digital", icon: <Smartphone className="size-4" /> },
  { kind: "retail", label: "Minimarket", desc: "Bayar tunai di gerai retail", icon: <Store className="size-4" /> },
];

export function PengaturanClient({
  gateways: initGateways,
  couriers: initCouriers,
  channels: initChannels,
  aggregator,
  team,
}: {
  gateways: Toggle[];
  couriers: CourierRow[];
  channels: PaymentChannelRow[];
  aggregator: { provider: string; enabled: boolean };
  team: TeamMember[];
}) {
  const router = useRouter();
  const [section, setSection] = useState<SectionId>("pembayaran");
  const [pending, startTransition] = useTransition();
  const [gateways, setGateways] = useState(initGateways);
  const [couriers, setCouriers] = useState(initCouriers);
  const [channels, setChannels] = useState(initChannels);
  const autoGateway = gateways.find((g) => g.key === "autolaris");
  const codGateway = gateways.find((g) => g.key === "cod");
  const activeChannels = channels.filter((c) => c.active).length;

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

  // AutoLaris payment-gateway connectivity test + channel sync
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

  // couriers has its own setter: it is CourierRow[], not Toggle[]
  const toggleCourier = (key: string, on: boolean) =>
    setCouriers((prev) => prev.map((c) => (c.key === key ? { ...c, on } : c)));

  // per-service COD overrides, keyed `${courier}:${service_type}`. Unset = keep what the DB says.
  const [codOn, setCodOn] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);

  const syncRoster = async () => {
    setSyncing(true);
    const r = await syncCouriersFromKiriminaja();
    setSyncing(false);
    if (r.ok) {
      toast.success(r.message);
      setCodOn({}); // the roster changed — drop stale overrides and re-read from the DB
      router.refresh();
    } else {
      toast.error(r.message);
    }
  };

  const saveCouriersFn = () =>
    startTransition(async () => {
      const codUpdates = couriers.flatMap((c) =>
        c.services
          .filter((s) => s.cod) // KiriminAja's flag is the ceiling — never send a service it won't COD
          .map((s) => ({
            courier: c.key,
            type: s.type,
            allowed: codOn[`${c.key}:${s.type}`] ?? s.codAllowed,
          })),
      );
      await Promise.all([
        saveCouriers(couriers.map((c) => ({ key: c.key, on: c.on }))),
        saveCodAllowed(codUpdates),
      ]);
      toast.success("Pengaturan kurir & COD disimpan.");
      router.refresh();
    });

  function submitInvite() {
    startTransition(async () => {
      const r = await invitePlatformAdmin({ name: invName, email: invEmail, role: invRole });
      if (r.ok) {
        // The password is random and shown ONCE — it is not stored anywhere readable and there is no
        // "resend". A toast that vanishes would strand the operator, so it stays on screen until
        // dismissed, exactly like the store-user hand-over.
        toast.success(`Operator ${invEmail} ditambahkan.`, {
          description: r.password ? `Password sementara: ${r.password} — salin sekarang, tidak bisa dilihat lagi.` : undefined,
          duration: Infinity,
          closeButton: true,
        });
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
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">
          Pembayaran, COD, dan kurir diatur di sini oleh platform — berlaku untuk{" "}
          <span className="font-medium text-foreground">semua toko</span>. Merchant hanya mengaktifkan yang tersedia.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* LEFT RAIL */}
        <div className="h-fit lg:sticky lg:top-6">
          <Card className="p-1.5">
            <nav className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => {
                const active = section === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                    )}
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      {s.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.label}</span>
                      <span className={cn("block truncate text-xs", active ? "text-primary/70" : "text-muted-foreground")}>{s.desc}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </div>

        {/* RIGHT CONTENT */}
        <div className="space-y-5">
          {section === "pembayaran" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" /> Pembayaran
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                {/* aggregator banner */}
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CreditCard className="size-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Agregator pembayaran: <span className="font-medium">{autoGateway?.name ?? "AutoLaris"}</span> · <span className="font-medium">{activeChannels}</span>/{channels.length} channel aktif</span>
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
                <p className="mb-3 text-xs text-muted-foreground">
                  Hanya channel <b>Aktif di AutoLaris</b> yang bisa di-on-kan — sisanya terkunci sampai diaktifkan di akun AutoLaris. Klik <b>Sync</b> untuk cek ulang status langsung ke AutoLaris. Toggle = ditawarkan ke merchant untuk checkout.
                </p>

                {/* COD — platform-managed, standalone */}
                {codGateway && (
                  <div className="mb-3 flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"><Store className="size-4" /></span>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="gw-cod" className="font-medium">{codGateway.name}</Label>
                          {codGateway.on && (
                            <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{codGateway.desc}</p>
                      </div>
                    </div>
                    <Switch id="gw-cod" checked={codGateway.on} onCheckedChange={(v) => toggle(setGateways, "cod", v)} />
                  </div>
                )}

                {/* AutoLaris channels — grouped, collapsible */}
                <div className="space-y-2">
                  {CHANNEL_GROUPS.map((g) => {
                    const rows = channels.filter((c) => c.kind === g.kind);
                    if (rows.length === 0) return null;
                    return <ChannelGroup key={g.kind} group={g} rows={rows} onToggle={toggleChannel} />;
                  })}
                </div>

                <div className="flex justify-end pt-4">
                  <Button className="gap-1.5" disabled={pending} onClick={savePayment}>
                    <Save className="size-4" /> Simpan
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {section === "kurir" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="size-4 text-muted-foreground" /> Integrasi Kurir
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Truck className="size-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Agregator pengiriman: <span className="font-medium">{aggregator.provider}</span> · <span className="font-medium">{couriers.filter((c) => c.on).length}</span>/{couriers.length} kurir aktif</span>
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
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="max-w-xl text-xs text-muted-foreground">
                    Kurir &amp; layanan datang langsung dari <b>KiriminAja</b> — bukan daftar yang kita tulis sendiri.
                    Aktifkan yang ditawarkan ke semua toko; merchant lalu memilih layanan mana yang ia pakai.
                    Centang <b>COD</b> untuk layanan yang boleh menerima bayar-di-tempat.
                  </p>
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={syncing} onClick={syncRoster}>
                    <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} /> {syncing ? "Menyinkronkan…" : "Sync dari KiriminAja"}
                  </Button>
                </div>

                {/* Retur, bukan ketersediaan, yang membuat COD mahal: paket COD yang ditolak
                    dikirim balik gratis oleh SPX, tapi ditagihkan ke merchant oleh kurir lain.
                    Karena itu ini keputusan platform per-layanan, bukan aturan yang dilas di kode. */}
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    KiriminAja mendukung COD di hampir semua layanan <b>Reguler</b>. Yang membedakan adalah <b>ongkos retur</b> bila
                    pembeli menolak paket — gratis di SPX, ditagihkan ke merchant di kurir lain. Buka COD hanya pada layanan
                    yang risikonya Anda terima.
                  </span>
                </div>

                {couriers.map((c, i) => (
                  <div key={c.key}>
                    {i > 0 && <Separator />}
                    <div className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`ku-${c.key}`} className="font-medium">{c.name}</Label>
                          {c.on && (
                            <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{c.services.length} layanan</span>
                        </div>
                        <Switch id={`ku-${c.key}`} checked={c.on} onCheckedChange={(v) => toggleCourier(c.key, v)} />
                      </div>

                      {c.on && c.services.length > 0 && (
                        <div className="mt-2 grid gap-1.5 pl-1">
                          {c.services.map((s) => (
                            <div key={s.type} className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-2.5 py-1.5">
                              <div className="min-w-0">
                                <span className="text-xs font-medium">{s.name}</span>
                                <span className="ml-2 text-[11px] text-muted-foreground">{GROUP_LABEL[s.group] ?? s.group}</span>
                              </div>
                              {s.cod ? (
                                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px]">
                                  <Checkbox
                                    checked={codOn[`${c.key}:${s.type}`] ?? s.codAllowed}
                                    onCheckedChange={(v) => setCodOn((m) => ({ ...m, [`${c.key}:${s.type}`]: !!v }))}
                                  />
                                  COD
                                </label>
                              ) : (
                                // KiriminAja tidak melayani COD di layanan ini — tak ada yang bisa kita nyalakan.
                                <span className="shrink-0 text-[11px] text-muted-foreground">COD tak tersedia</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
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
          )}

          {section === "tim" && (
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
                      <p className="text-xs text-muted-foreground">Password awal dibuat <span className="font-medium">acak</span> dan hanya ditampilkan sekali setelah operator ditambahkan — salin lalu berikan, tidak bisa dilihat lagi.</p>
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
          )}
        </div>
      </div>
    </div>
  );
}

// Collapsible group of payment channels (e.g. all Virtual Accounts). Header shows the group + how
// many are active; body lists each channel with its live "Aktif di AutoLaris" status + locked toggle.
function ChannelGroup({
  group,
  rows,
  onToggle,
}: {
  group: { kind: string; label: string; desc: string; icon: ReactNode };
  rows: PaymentChannelRow[];
  onToggle: (key: string, on: boolean) => void;
}) {
  const activeCount = rows.filter((r) => r.active).length;
  const enabledCount = rows.filter((r) => r.active && r.enabled).length;
  // open by default when something is on (or when there's only QRIS) so active groups aren't hidden
  const [open, setOpen] = useState(enabledCount > 0 || rows.length <= 1);
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">{group.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">{group.label}</span>
            <Badge variant="secondary" className="border-transparent bg-muted text-[11px] text-muted-foreground">{activeCount}/{rows.length} aktif</Badge>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{group.desc}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-3">
          {rows.map((c, i) => (
            <div key={c.key}>
              {i > 0 && <Separator />}
              <div className={cn("flex items-center justify-between py-2.5", c.active ? "" : "opacity-60")}>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`ch-${c.key}`} className="text-sm font-medium">{c.label}</Label>
                    {c.active ? (
                      <Badge variant="secondary" className="border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">Aktif di AutoLaris</Badge>
                    ) : (
                      <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">Belum aktif · Sync</Badge>
                    )}
                  </div>
                  <p className="text-[11px] uppercase text-muted-foreground">{c.key}</p>
                </div>
                {/* can't offer a channel AutoLaris rejects (rc≠00) — locked until Sync marks it active */}
                <Switch id={`ch-${c.key}`} checked={c.active && c.enabled} disabled={!c.active} onCheckedChange={(v) => onToggle(c.key, v)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
