"use client";

import Link from "next/link";
import {
  ChevronLeft,
  LogIn,
  Ban,
  CircleCheck,
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
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@indostore/ui/card";
import { Button } from "@indostore/ui/button";
import { Separator } from "@indostore/ui/separator";
import { cn } from "@indostore/ui/lib/utils";

import { planName, planPrice, type Store } from "@/lib/mock";
import { PlanBadge, StatusBadge } from "@/components/bits";
import { IDR, num } from "@indostore/lib/format";

export function StoreDetail({ store }: { store: Store }) {
  const suspended = store.status === "ditangguhkan";

  const stats = [
    { label: "GMV", value: IDR(store.gmv), icon: Wallet },
    { label: "Pesanan", value: num(store.orders), icon: ShoppingBag },
    { label: "Produk", value: num(store.products), icon: Package },
    {
      label: "Bergabung",
      value: `${store.createdDaysAgo} hari lalu`,
      icon: CalendarDays,
    },
  ];

  const timeline = [
    {
      icon: UserPlus,
      title: "Toko bergabung",
      desc: `Mendaftar ${store.createdDaysAgo} hari lalu`,
    },
    {
      icon: CreditCard,
      title: `Berlangganan ${planName(store.plan)}`,
      desc: `${IDR(planPrice(store.plan))} / bln`,
    },
    {
      icon: Receipt,
      title: "Transaksi terakhir",
      desc: `Total ${num(store.orders)} pesanan sepanjang waktu`,
    },
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
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            className="gap-1.5"
            onClick={() => toast.success("Masuk sebagai " + store.name)}
          >
            <LogIn className="size-4" /> Impersonasi
          </Button>
          <Button
            variant="ghost"
            className={cn(!suspended && "text-destructive hover:text-destructive")}
            onClick={() =>
              toast(
                suspended
                  ? `Toko "${store.name}" diaktifkan kembali.`
                  : `Toko "${store.name}" ditangguhkan.`,
              )
            }
          >
            {suspended ? (
              <>
                <CircleCheck className="size-4" /> Aktifkan
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
              <span className="text-sm font-medium text-muted-foreground">
                {s.label}
              </span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
              {s.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* main column */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3">
                <SummaryItem label="Paket" value={planName(store.plan)} />
                <SummaryItem
                  label="Kontribusi MRR"
                  value={IDR(planPrice(store.plan))}
                />
                <SummaryItem label="Total pesanan" value={num(store.orders)} />
                <SummaryItem label="Produk aktif" value={num(store.products)} />
                <SummaryItem label="Kota" value={store.city} />
                <SummaryItem label="ID toko" value={store.id} mono />
              </div>
              <Separator className="my-4" />
              <p className="text-sm text-muted-foreground">
                Toko ini menyumbang {IDR(planPrice(store.plan))} per bulan ke MRR
                platform dan telah memproses {num(store.orders)} pesanan dengan
                total GMV {IDR(store.gmv)}.
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
                onClick={() => toast.success("Masuk sebagai " + store.name)}
              >
                <LogIn className="size-4" /> Impersonasi
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => toast("Ubah paket (mock).")}
              >
                <ArrowUpRight className="size-4" /> Ubah paket
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                onClick={() =>
                  toast(`Toko "${store.name}" ditangguhkan.`)
                }
              >
                <Ban className="size-4" /> Tangguhkan
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-sm font-medium", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}
