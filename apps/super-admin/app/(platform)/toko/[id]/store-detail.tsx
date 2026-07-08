"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronDown,
  ExternalLink,
  Ban,
  Play,
  ShoppingBag,
  Package,
  CalendarDays,
  Wallet,
  User,
  Mail,
  MapPin,
  ArrowUpRight,
  UserPlus,
  CreditCard,
  Receipt,
  CircleCheck,
  AlertTriangle,
  CircleAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Separator } from "@tokophi/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";
import { cn } from "@tokophi/ui/lib/utils";

import { planName, planPrice, type Plan, type Store } from "@/lib/mock";
import { type StoreHealth, type CheckStatus, checkToneClass } from "@/lib/health-types";
import { PlanBadge, StatusBadge, HealthBadge } from "@/components/bits";
import { impersonateStore, setStoreStatus, setStorePlan } from "@/lib/actions";
import { IDR, num } from "@tokophi/lib/format";

const PLAN_KEYS: Plan[] = ["pemula", "bisnis", "skala"];
const BAR_TONE: Record<StoreHealth["verdict"], string> = {
  sehat: "bg-emerald-500",
  perhatian: "bg-amber-500",
  bermasalah: "bg-destructive",
};

function CheckIcon({ status }: { status: CheckStatus }) {
  const Icon = status === "ok" ? CircleCheck : status === "warn" ? AlertTriangle : CircleAlert;
  return <Icon className={cn("size-4 shrink-0", checkToneClass[status])} />;
}

export function StoreDetail({ store, health }: { store: Store; health: StoreHealth | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const suspended = store.status === "ditangguhkan";

  function openAdmin() {
    startTransition(async () => {
      const r = await impersonateStore(store.id);
      if (r.ok && r.adminUrl) {
        toast.success(`Membuka panel admin “${store.name}”…`);
        window.open(r.adminUrl, "_blank", "noopener");
      } else {
        toast.error(r.error ?? "Gagal membuka panel admin.");
      }
    });
  }

  function toggleSuspend() {
    const next = suspended ? "active" : "suspended";
    startTransition(async () => {
      await setStoreStatus(store.id, next);
      toast.success(next === "suspended" ? `Toko “${store.name}” ditangguhkan.` : `Toko “${store.name}” diaktifkan.`);
      router.refresh();
    });
  }

  function changePlan(plan: Plan) {
    if (plan === store.plan) return;
    startTransition(async () => {
      await setStorePlan(store.id, plan);
      toast.success(`Paket “${store.name}” diubah ke ${planName(plan)}.`);
      router.refresh();
    });
  }

  const stats = [
    { label: "GMV", value: IDR(store.gmv), icon: Wallet },
    { label: "Pesanan", value: num(store.orders), icon: ShoppingBag },
    { label: "Produk", value: num(store.products), icon: Package },
    { label: "Bergabung", value: `${store.createdDaysAgo} hari lalu`, icon: CalendarDays },
  ];

  const timeline = [
    { icon: UserPlus, title: "Toko bergabung", desc: `Mendaftar ${store.createdDaysAgo} hari lalu` },
    { icon: CreditCard, title: `Berlangganan ${planName(store.plan)}`, desc: `${IDR(planPrice(store.plan))} / bln` },
    { icon: Receipt, title: "Transaksi terakhir", desc: `Total ${num(store.orders)} pesanan sepanjang waktu` },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* top bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/toko" aria-label="Kembali ke Toko" />}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Link href="/toko" className="hover:text-foreground">
              Toko
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{store.name}</h1>
            <PlanBadge plan={store.plan} />
            <StatusBadge status={store.status} />
            {health && <HealthBadge verdict={health.verdict} />}
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="gap-1.5" disabled={pending} onClick={openAdmin}>
            <ExternalLink className="size-4" /> Buka panel admin
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            className={cn(!suspended && "text-destructive hover:text-destructive")}
            onClick={toggleSuspend}
          >
            {suspended ? (
              <>
                <Play className="size-4" /> Aktifkan
              </>
            ) : (
              <>
                <Ban className="size-4" /> Tangguhkan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{s.value}</div>
          </Card>
        ))}
      </div>

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
              ) : (
                <p className="text-sm text-muted-foreground">Data kesehatan tidak tersedia.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3">
                <SummaryItem label="Paket" value={planName(store.plan)} />
                <SummaryItem label="Kontribusi MRR" value={IDR(planPrice(store.plan))} />
                <SummaryItem label="Total pesanan" value={num(store.orders)} />
                <SummaryItem label="Produk aktif" value={num(store.products)} />
                <SummaryItem label="Kota" value={store.city} />
                <SummaryItem label="ID toko" value={store.id} mono />
              </div>
              <Separator className="my-4" />
              <p className="text-sm text-muted-foreground">
                Toko ini menyumbang {IDR(planPrice(store.plan))} per bulan ke MRR platform dan telah
                memproses {num(store.orders)} pesanan dengan total GMV {IDR(store.gmv)}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aktivitas</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-5 border-l pl-6">
                {timeline.map((t) => (
                  <li key={t.title} className="relative">
                    <span className="absolute -left-[31px] flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground">
                      <t.icon className="size-3.5" />
                    </span>
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.desc}</div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* sidebar */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Pemilik</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="size-4 text-muted-foreground" />
                <span>{store.owner}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <span className="truncate">{store.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <span>{store.city}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Langganan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{planName(store.plan)}</span>
                  <StatusBadge status={store.status} />
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold tracking-tight tabular-nums">
                    {IDR(planPrice(store.plan))}
                  </span>
                  <span className="text-sm text-muted-foreground">/bln</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tindakan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                disabled={pending}
                onClick={openAdmin}
              >
                <ExternalLink className="size-4" /> Buka panel admin
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" className="w-full justify-between gap-2" disabled={pending}>
                      <span className="flex items-center gap-2">
                        <ArrowUpRight className="size-4" /> Ubah paket
                      </span>
                      <ChevronDown className="size-4 text-muted-foreground" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-[--anchor-width]">
                  <DropdownMenuLabel>Pindah paket</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PLAN_KEYS.map((p) => (
                    <DropdownMenuItem key={p} disabled={p === store.plan} onClick={() => changePlan(p)}>
                      {planName(p)} · {IDR(planPrice(p))}/bln
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {suspended ? (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  disabled={pending}
                  onClick={toggleSuspend}
                >
                  <Play className="size-4" /> Aktifkan
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={toggleSuspend}
                >
                  <Ban className="size-4" /> Tangguhkan
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-sm font-medium", mono && "font-mono")}>{value}</div>
    </div>
  );
}
