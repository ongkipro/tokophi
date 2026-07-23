"use client";

import * as React from "react";
import {
  Download,
  ShoppingCart,
  TrendingUp,
  Info,
  Plug,
  Ban,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@tokophi/lib/format";
import type { AdChannelStatus } from "@/lib/data/marketing";
import { exportCsv } from "@/lib/csv";

import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Switch } from "@tokophi/ui/switch";
import { Separator } from "@tokophi/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tokophi/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@tokophi/ui/table";
import { FeedCard } from "./feed-card";
import type { FeedStatus } from "@/lib/data/feed";

// ---------------------------------------------------------------------------
// NOTHING on this page may show ad spend, impressions, clicks, ROAS, or a Pixel
// ID: TokoΦ has no Meta/Google/TikTok Ads integration, so there is no source of
// truth for any of it. The only real figures here are orders + revenue
// ATTRIBUTED to a channel via `orders.channel` (counted from the store's own
// non-cancelled orders) — they say nothing about what was spent.
// ---------------------------------------------------------------------------

const NA = "—";

// ---- small building blocks ----
function BrandSquare({
  channel,
  className = "size-8 rounded-lg text-sm",
}: {
  channel: AdChannelStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ background: channel.brand }}
      className={`inline-flex shrink-0 items-center justify-center font-bold text-white ${className}`}
    >
      {channel.name.charAt(0)}
    </span>
  );
}

function NotConnectedBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Belum terhubung
    </Badge>
  );
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  muted,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ElementType;
  muted?: boolean;
}) {
  return (
    <Card className="gap-0 p-5">
      <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" /> {label}
      </span>
      <div
        className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </Card>
  );
}

function IntegrationNotice() {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Belum ada saluran iklan yang terhubung</p>
          <p className="text-muted-foreground">
            Belanja iklan, impresi, klik, ROAS, dan ID Pixel hanya bisa datang
            dari platform iklannya (Meta, Google, TikTok). Selama saluran belum
            terhubung, TokoΦ tidak menampilkan angka-angka itu — lebih baik
            kosong daripada menyesatkan keputusan budget Anda.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---- Tab 1: Saluran Iklan ----
function ChannelCard({ channel }: { channel: AdChannelStatus }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <BrandSquare channel={channel} />
            <CardTitle className="text-base">{channel.name}</CardTitle>
          </div>
          <NotConnectedBadge />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniMetric label="Pesanan" value={num(channel.orders)} />
          <MiniMetric
            label="Pendapatan"
            value={IDR(channel.revenue, { compact: true })}
          />
          <MiniMetric label="Belanja iklan" value={NA} muted />
          <MiniMetric label="ROAS" value={NA} muted />
        </div>

        <p className="text-xs text-muted-foreground">
          Pesanan &amp; pendapatan dihitung dari pesanan yang tercatat berasal
          dari saluran ini. Belanja dan ROAS butuh data dari platform iklan —
          hubungkan saluran untuk melihatnya.
        </p>

        <Separator />

        <div className="mt-auto pt-1">
          <Button className="w-full" disabled>
            <Plug /> Hubungkan (belum tersedia)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SaluranTab({ channels }: { channels: AdChannelStatus[] }) {
  const totals = channels.reduce(
    (a, c) => ({ orders: a.orders + c.orders, revenue: a.revenue + c.revenue }),
    { orders: 0, revenue: 0 },
  );

  return (
    <div className="space-y-4">
      <IntegrationNotice />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Pesanan dari saluran iklan"
          value={num(totals.orders)}
          helper="Dihitung dari pesanan (tidak termasuk yang dibatalkan)"
          icon={ShoppingCart}
        />
        <StatCard
          label="Pendapatan dari saluran iklan"
          value={IDR(totals.revenue, { compact: true })}
          helper="Nilai pesanan yang tercatat berasal dari iklan"
          icon={TrendingUp}
        />
        <StatCard
          label="Belanja iklan & ROAS"
          value="Tidak tersedia"
          helper="Butuh integrasi platform iklan — belum terhubung"
          icon={Ban}
          muted
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {channels.map((c) => (
          <ChannelCard key={c.key} channel={c} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Penjualan yang diatribusikan per saluran</CardTitle>
          <p className="text-xs text-muted-foreground">
            Dari pesanan toko Anda — bukan dari platform iklan. Kolom belanja dan
            ROAS sengaja dikosongkan selama saluran belum terhubung.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Saluran</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pesanan</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                  <TableHead className="text-right">Belanja</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell>
                      <span className="flex items-center gap-2.5 font-medium">
                        <BrandSquare
                          channel={c}
                          className="size-6 rounded-md text-xs"
                        />
                        {c.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <NotConnectedBadge />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(c.orders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {IDR(c.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {NA}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {NA}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">
                    {num(totals.orders)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {IDR(totals.revenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {NA}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {NA}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Tab 2: Pelacakan ----
// No pixel is installed and no credential is stored anywhere, so every field is
// an empty, disabled placeholder — never a pre-filled ID or a token that implies
// tracking is live.
function TrackingCard({ channel }: { channel: AdChannelStatus }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <BrandSquare channel={channel} />
            <CardTitle className="text-base">
              {channel.pixelLabel || channel.name}
            </CardTitle>
          </div>
          <NotConnectedBadge />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${channel.key}-pixel`}>ID Pixel / Tag</Label>
            <Input
              id={`${channel.key}-pixel`}
              placeholder="Belum ada — hubungkan saluran"
              disabled
            />
          </div>
          <div className="flex items-end">
            <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2 opacity-60">
              <Label htmlFor={`${channel.key}-active`}>Pelacakan aktif</Label>
              <Switch id={`${channel.key}-active`} checked={false} disabled />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Tidak ada pixel yang terpasang — konversi dari saluran ini tidak
            terekam.
          </div>
          <Button size="sm" disabled>
            <Plug /> Hubungkan (belum tersedia)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PelacakanTab({ channels }: { channels: AdChannelStatus[] }) {
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pixel adalah kode pelacak yang mencatat tindakan pengunjung — melihat
        produk, menambah ke keranjang, hingga membeli — sehingga konversi dari
        setiap iklan dapat diukur. TokoΦ{" "}
        <span className="font-medium text-foreground">
          belum memasang pixel apa pun
        </span>{" "}
        dan belum terhubung ke Meta, Google, atau TikTok, jadi tidak ada konversi
        iklan yang sedang direkam.
      </p>

      <IntegrationNotice />

      {channels.map((c) => (
        <TrackingCard key={c.key} channel={c} />
      ))}
    </div>
  );
}

// ---- page ----
export function PemasaranClient({ channels, feed }: { channels: AdChannelStatus[]; feed: FeedStatus }) {
  const [tab, setTab] = React.useState("saluran");

  return (
    <>
      <PageHeader
        title="Pemasaran"
        desc="Status saluran iklan & pelacakan konversi. Belanja dan ROAS baru muncul setelah saluran terhubung."
      >
        <Button
          variant="outline"
          onClick={() =>
            exportCsv(
              "pemasaran",
              channels.map((c) => ({
                Saluran: c.name,
                Status: c.connected ? "Terhubung" : "Belum terhubung",
                Pesanan: c.orders,
                Pendapatan: c.revenue,
                Belanja: "",
                ROAS: "",
              })),
            )
          }
        >
          <Download /> Ekspor laporan
        </Button>
      </PageHeader>

      <FeedCard feed={feed} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="mb-4">
          <TabsTrigger value="saluran">Saluran Iklan</TabsTrigger>
          <TabsTrigger value="pelacakan">Pelacakan</TabsTrigger>
        </TabsList>

        <TabsContent value="saluran">
          <SaluranTab channels={channels} />
        </TabsContent>
        <TabsContent value="pelacakan">
          <PelacakanTab channels={channels} />
        </TabsContent>
      </Tabs>
    </>
  );
}
