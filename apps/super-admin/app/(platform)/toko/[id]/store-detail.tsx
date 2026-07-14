"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ExternalLink, Ban, Play, ShoppingBag, Package, Wallet, Activity,
  User, Mail, MapPin, UserPlus, Gift, Crown, KeyRound, Clock, Copy, Trash2, Users,
  CircleCheck, AlertTriangle, CircleAlert, Receipt, Send,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Separator } from "@tokophi/ui/separator";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@tokophi/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@tokophi/ui/dropdown-menu";
import { cn } from "@tokophi/ui/lib/utils";

import { type Store } from "@/lib/types";
import { BILLING, SEGMENT_META, type BillingState } from "@tokophi/lib/billing";
import { type StoreHealth, type CheckStatus, checkToneClass } from "@/lib/health-types";
import { SegmentBadge, StatusBadge, HealthBadge, InvoiceBadge, ActivityIcon, initials } from "@/components/bits";
import type { StoreInvoiceRow, StoreUserRow, StoreBalance, StoreMovement, StorePayout, StoreMoneySignals } from "@/lib/data";
import type { PActivity } from "@/lib/types";
import { SaldoSection } from "./saldo-section";
import {
  impersonateStore, setStoreStatus, compStore, extendTrial, setStoreComped,
  resetOwnerPassword, resetStoreUserPassword, setStoreUserRole, removeStoreUser, addStoreUser,
  createManualInvoice, sendPaymentReminder,
} from "@/lib/actions";
import { IDR, num } from "@tokophi/lib/format";

const BAR_TONE: Record<StoreHealth["verdict"], string> = { sehat: "bg-emerald-500", perhatian: "bg-amber-500", bermasalah: "bg-destructive" };
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", staff: "Staf", gudang: "Gudang" };

function CheckIcon({ status }: { status: CheckStatus }) {
  const Icon = status === "ok" ? CircleCheck : status === "warn" ? AlertTriangle : CircleAlert;
  return <Icon className={cn("size-4 shrink-0", checkToneClass[status])} />;
}

export function StoreDetail({ store, health, billing, invoices, users, activity, comp, balance, movements, payouts, signals }: {
  store: Store; health: StoreHealth | null; billing: BillingState | null;
  invoices: StoreInvoiceRow[]; users: StoreUserRow[]; activity: PActivity[];
  comp: { comped: boolean; reason: string | null };
  balance: StoreBalance;
  movements: { rows: StoreMovement[]; total: number; page: number; pages: number };
  payouts: StorePayout[];
  signals: StoreMoneySignals;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const suspended = store.status === "ditangguhkan";

  // credential reveal dialog (after a password reset)
  const [cred, setCred] = useState<{ email: string; password: string } | null>(null);
  // manual-invoice VA reveal
  const [invoiceInfo, setInvoiceInfo] = useState<{ number: string; va?: string; reused?: boolean } | null>(null);
  // VIP reason dialog
  const [vipOpen, setVipOpen] = useState(false);
  const [vipReason, setVipReason] = useState(`${store.orders30d} pesanan/30 hari — dibebaskan platform`);
  // add-user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [auName, setAuName] = useState("");
  const [auEmail, setAuEmail] = useState("");
  const [auRole, setAuRole] = useState<"admin" | "staff" | "gudang">("staff");

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    startTransition(async () => { await fn(); if (ok) toast.success(ok); router.refresh(); });

  function openAdmin() {
    startTransition(async () => {
      const r = await impersonateStore(store.id);
      if (r.ok && r.adminUrl) { toast.success(`Membuka Dashboard Seller “${store.name}”…`); window.open(r.adminUrl, "_blank", "noopener"); }
      else toast.error(r.error ?? "Gagal membuka Dashboard Seller.");
    });
  }
  const toggleSuspend = () => run(() => setStoreStatus(store.id, suspended ? "active" : "suspended"), suspended ? "Toko diaktifkan." : "Toko ditangguhkan.");
  const giveComp = () => run(() => compStore(store.id, 1), "Diberi gratis 1 bulan.");
  const makeInvoice = () => startTransition(async () => {
    const r = await createManualInvoice(store.id, "monthly");
    if (r.ok) { setInvoiceInfo({ number: r.number!, va: r.virtualAccount, reused: r.reused }); toast.success(r.reused ? "Sudah ada tagihan menunggu." : "Tagihan VA dibuat."); router.refresh(); }
    else toast.error(r.error ?? "Gagal membuat tagihan.");
  });
  const remind = () => run(() => sendPaymentReminder(store.id), "Pengingat pembayaran dikirim.");
  const giveTrial = () => run(() => extendTrial(store.id, 7), "Trial diperpanjang 7 hari.");
  const revertVip = () => run(() => setStoreComped(store.id, false), "VIP dicabut — kembali berbayar.");
  function confirmVip() {
    startTransition(async () => {
      await setStoreComped(store.id, true, vipReason);
      setVipOpen(false);
      toast.success(`“${store.name}” dijadikan VIP (gratis).`);
      router.refresh();
    });
  }
  function resetOwner() {
    startTransition(async () => {
      const r = await resetOwnerPassword(store.id);
      if (r.ok && r.password) setCred({ email: r.email!, password: r.password });
      else toast.error("Gagal reset password owner.");
    });
  }
  function resetUser(u: StoreUserRow) {
    startTransition(async () => {
      const r = await resetStoreUserPassword(store.id, u.userId);
      if (r.ok && r.password) setCred({ email: r.email!, password: r.password });
      else toast.error("Gagal reset password.");
      router.refresh();
    });
  }
  function submitAddUser() {
    startTransition(async () => {
      const r = await addStoreUser(store.id, { name: auName, email: auEmail, role: auRole });
      if (r.ok) { setAddOpen(false); setAuName(""); setAuEmail(""); if (r.password) setCred({ email: auEmail, password: r.password }); toast.success("User ditambahkan."); router.refresh(); }
      else toast.error(r.error ?? "Gagal menambah user.");
    });
  }

  // Every figure here is derived from `orders` / `products` at read time (lib/data.ts STORES_SQL).
  // GMV excludes cancelled orders. There is no "kiriman/hari" card any more — `fulfillments` is
  // empty and no shipments table exists, so the number it showed had no source at all.
  const stats = [
    { label: "GMV (di luar batal)", value: IDR(store.gmv, { compact: true }), icon: Wallet },
    { label: "Total pesanan", value: num(store.orders), icon: ShoppingBag },
    { label: "Pesanan 30 hari", value: num(store.orders30d), icon: Activity, hot: store.orders30d > 0 },
    { label: "Produk aktif", value: num(store.products), icon: Package },
    {
      label: "Order terakhir",
      value: store.lastOrderDays == null ? "Belum pernah" : `${store.lastOrderDays} hari lalu`,
      icon: Clock,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* top bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/toko" aria-label="Kembali ke Toko" />}>
              <ChevronLeft className="size-4" />
            </Button>
            <Link href="/toko" className="hover:text-foreground">Toko</Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{store.name}</h1>
            <SegmentBadge segment={store.segment} />
            <StatusBadge status={store.status} />
            {health && <HealthBadge verdict={health.verdict} />}
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="gap-1.5" disabled={pending} onClick={openAdmin}><ExternalLink className="size-4" /> Buka Dashboard Seller</Button>
          <Button variant="ghost" disabled={pending} className={cn(!suspended && "text-destructive hover:text-destructive")} onClick={toggleSuspend}>
            {suspended ? <><Play className="size-4" /> Aktifkan</> : <><Ban className="size-4" /> Tangguhkan</>}
          </Button>
        </div>
      </div>

      {/* VIP / recommendation banner */}
      {comp.comped && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-900/50 dark:bg-violet-950/30">
          <span className="flex items-center gap-2 text-violet-700 dark:text-violet-300"><Crown className="size-4" /> <b>VIP</b> — langganan dibebaskan{comp.reason ? ` · ${comp.reason}` : ""}. Tidak ada tagihan bulanan.</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={revertVip}>Cabut VIP</Button>
        </div>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className={cn("flex size-8 items-center justify-center rounded-lg", s.hot ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                <s.icon className="size-4" />
              </span>
            </div>
            <div className={cn("mt-3 text-2xl font-bold tracking-tight tabular-nums", s.hot && "text-primary")}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* SALDO & TRANSAKSI — the platform's window into this merchant's money (read-only; the
          withdrawal queue itself lives in /pencairan). */}
      <SaldoSection storeId={store.id} balance={balance} movements={movements} payouts={payouts} signals={signals} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* main column */}
        <div className="space-y-5 lg:col-span-2">
          {/* healthcheck */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Healthcheck</CardTitle>
              {health && <HealthBadge verdict={health.verdict} />}
            </CardHeader>
            <CardContent className="space-y-4">
              {health ? (
                <>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Skor kesehatan</span>
                      <span className="font-semibold tabular-nums">{health.score}/100</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", BAR_TONE[health.verdict])} style={{ width: `${health.score}%` }} />
                    </div>
                  </div>
                  <ul className="divide-y">
                    {health.checks.map((c) => (
                      <li key={c.key} className="flex items-center gap-3 py-2.5">
                        <CheckIcon status={c.status} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{c.label}</div>
                          <div className="text-xs text-muted-foreground">{c.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="text-sm text-muted-foreground">Data kesehatan tidak tersedia.</p>}
            </CardContent>
          </Card>

          {/* users of this store */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /> Pengguna toko</CardTitle>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5"><UserPlus className="size-4" /> Tambah</Button>} />
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Tambah pengguna ke {store.name}</DialogTitle></DialogHeader>
                  <div className="flex flex-col gap-4 py-2">
                    <div className="flex flex-col gap-2"><Label htmlFor="au-name">Nama</Label><Input id="au-name" value={auName} onChange={(e) => setAuName(e.target.value)} placeholder="Nama" /></div>
                    <div className="flex flex-col gap-2"><Label htmlFor="au-email">Email</Label><Input id="au-email" type="email" value={auEmail} onChange={(e) => setAuEmail(e.target.value)} placeholder="user@toko.id" /></div>
                    <div className="flex flex-col gap-2">
                      <Label>Peran</Label>
                      <div className="flex gap-2">
                        {(["admin", "staff", "gudang"] as const).map((r) => (
                          <Button key={r} type="button" variant={auRole === r ? "default" : "outline"} size="sm" onClick={() => setAuRole(r)}>{ROLE_LABEL[r]}</Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Password sementara dibuat otomatis (bisa disalin setelah ditambahkan).</p>
                  </div>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline">Batal</Button>} />
                    <Button disabled={pending || !auEmail} onClick={submitAddUser}>{pending ? "Menyimpan…" : "Tambah"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-0">
              {users.map((u, i) => (
                <div key={u.id}>
                  {i > 0 && <Separator />}
                  <div className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">{initials(u.name)}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{u.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {u.role === "owner" ? (
                        <Badge variant="secondary" className="border-transparent bg-primary/12 text-primary">Owner</Badge>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-1">{ROLE_LABEL[u.role] ?? u.role}</Button>} />
                          <DropdownMenuContent align="end">
                            {(["admin", "staff", "gudang"] as const).map((r) => (
                              <DropdownMenuItem key={r} disabled={r === u.role} onClick={() => run(() => setStoreUserRole(store.id, u.id, r), "Peran diperbarui.")}>{ROLE_LABEL[r]}</DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Reset password" onClick={() => resetUser(u)}><KeyRound className="size-4" /></Button>
                      {u.role !== "owner" && (
                        <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Hapus" className="text-destructive hover:text-destructive" onClick={() => run(async () => { const r = await removeStoreUser(store.id, u.id); if (!r.ok) toast.error(r.error ?? "Gagal."); }, "User dihapus.")}><Trash2 className="size-4" /></Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {users.length === 0 && <p className="py-4 text-sm text-muted-foreground">Belum ada pengguna.</p>}
            </CardContent>
          </Card>

          {/* real invoices */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="size-4 text-muted-foreground" /> Tagihan</CardTitle></CardHeader>
            <CardContent className="space-y-0">
              {invoices.map((inv, i) => (
                <div key={inv.number}>
                  {i > 0 && <Separator />}
                  <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{inv.number}</span>
                    <span className="tabular-nums">{IDR(inv.amount)}</span>
                    <InvoiceBadge status={inv.status} />
                    <span className="w-20 text-right text-xs text-muted-foreground">{inv.daysAgo} hari lalu</span>
                  </div>
                </div>
              ))}
              {invoices.length === 0 && <p className="py-4 text-sm text-muted-foreground">Belum ada tagihan{comp.comped ? " (VIP — dibebaskan)" : ""}.</p>}
            </CardContent>
          </Card>

          {/* audit / activity */}
          <Card>
            <CardHeader><CardTitle>Aktivitas &amp; audit</CardTitle></CardHeader>
            <CardContent>
              {activity.length > 0 ? (
                <ul className="space-y-3">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-3">
                      <ActivityIcon kind={a.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{a.text}</div>
                        <div className="text-xs text-muted-foreground">{a.minutesAgo < 60 ? `${a.minutesAgo} mnt lalu` : a.minutesAgo < 1440 ? `${Math.round(a.minutesAgo / 60)} jam lalu` : `${Math.round(a.minutesAgo / 1440)} hari lalu`}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-2 text-sm text-muted-foreground">Belum ada aktivitas tercatat. Tindakan platform (gratis, VIP, reset, suspend) akan muncul di sini.</p>}
            </CardContent>
          </Card>
        </div>

        {/* sidebar */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Pemilik</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><User className="size-4 text-muted-foreground" /><span>{store.owner}</span></div>
              <div className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" /><span className="truncate">{store.email}</span></div>
              <div className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /><span>{store.city}</span></div>
              <Separator />
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" disabled={pending} onClick={resetOwner}><KeyRound className="size-4" /> Reset password owner</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Langganan</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{SEGMENT_META[store.segment].label}</span>
                  <StatusBadge status={store.status} />
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold tracking-tight tabular-nums">{comp.comped ? "Gratis" : IDR(billing?.nextAmount ?? BILLING.MONTHLY_IDR)}</span>
                  {!comp.comped && <span className="text-sm text-muted-foreground">/bln{billing?.isPromo ? " (promo)" : ""}</span>}
                </div>
                {billing && !comp.comped && (
                  <div className="mt-3 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Status</span><span className="font-medium text-foreground">{billing.label}</span></div>
                    {billing.status !== "suspended" && (
                      <div className="flex justify-between"><span>{billing.status === "trial" ? "Sisa uji coba" : "Perpanjang dalam"}</span><span className="font-medium text-foreground">{billing.daysLeft} hari</span></div>
                    )}
                    <div className="flex justify-between"><span>Kontribusi MRR</span><span className="font-medium text-foreground tabular-nums">{IDR(billing.nextAmount)}</span></div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* full control */}
          <Card>
            <CardHeader><CardTitle>Kontrol langganan</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={openAdmin}><ExternalLink className="size-4" /> Buka Dashboard Seller</Button>
              <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={giveComp}><Gift className="size-4" /> Gratiskan 1 bulan</Button>
              <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={giveTrial}><Clock className="size-4" /> Perpanjang trial 7 hari</Button>
              {!comp.comped && (
                <>
                  <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={makeInvoice}><Receipt className="size-4" /> Buat tagihan (VA)</Button>
                  <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={remind}><Send className="size-4" /> Kirim pengingat bayar</Button>
                </>
              )}
              {comp.comped ? (
                <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={revertVip}><Crown className="size-4" /> Cabut VIP (kembali berbayar)</Button>
              ) : (
                <Button variant="outline" className="w-full justify-start gap-2 text-violet-600 hover:text-violet-600 dark:text-violet-400" disabled={pending} onClick={() => setVipOpen(true)}><Crown className="size-4" /> Jadikan VIP (hapus langganan)</Button>
              )}
              {suspended ? (
                <Button variant="outline" className="w-full justify-start gap-2" disabled={pending} onClick={toggleSuspend}><Play className="size-4" /> Aktifkan</Button>
              ) : (
                <Button variant="outline" className="w-full justify-start gap-2 text-destructive hover:text-destructive" disabled={pending} onClick={toggleSuspend}><Ban className="size-4" /> Tangguhkan</Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* VIP reason dialog */}
      <Dialog open={vipOpen} onOpenChange={setVipOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Jadikan {store.name} VIP</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">Langganan dibebaskan — toko ini tidak akan ditagih bulanan. Bisa dicabut kapan saja.</p>
            <div className="flex flex-col gap-2"><Label htmlFor="vip-reason">Alasan (opsional)</Label><Input id="vip-reason" value={vipReason} onChange={(e) => setVipReason(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button disabled={pending} onClick={confirmVip}>{pending ? "Menyimpan…" : "Jadikan VIP"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* manual invoice VA reveal */}
      <Dialog open={!!invoiceInfo} onOpenChange={(o) => !o && setInvoiceInfo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{invoiceInfo?.reused ? "Tagihan menunggu" : "Tagihan VA dibuat"}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">Tagihan <span className="font-mono">{invoiceInfo?.number}</span> untuk {store.name}. Merchant bisa membayarnya dari halaman Langganan; langganan aktif otomatis setelah dibayar.</p>
            {invoiceInfo?.va && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">Virtual Account BCA</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-bold tracking-wide">{invoiceInfo.va}</span>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { navigator.clipboard?.writeText(invoiceInfo.va!); toast.success("Disalin."); }}><Copy className="size-3.5" /> Salin</Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter><DialogClose render={<Button>Selesai</Button>} /></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* credential reveal dialog */}
      <Dialog open={!!cred} onOpenChange={(o) => !o && setCred(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Password sementara</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">Salin dan berikan ke pemilik. Password disimpan terenkripsi (scrypt) — ini satu-satunya kali ditampilkan.</p>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="text-xs text-muted-foreground">{cred?.email}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{cred?.password}</span>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { if (cred) { navigator.clipboard?.writeText(cred.password); toast.success("Disalin."); } }}><Copy className="size-3.5" /> Salin</Button>
              </div>
            </div>
          </div>
          <DialogFooter><DialogClose render={<Button>Selesai</Button>} /></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
