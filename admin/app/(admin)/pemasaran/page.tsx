"use client";

import * as React from "react";
import {
  Download,
  Wallet,
  TrendingUp,
  Gauge,
  ShoppingCart,
  CheckCircle2,
  Radio,
  Plug,
  Settings2,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@/lib/format";
import { AD_CHANNELS, type AdChannel } from "@/lib/mock/store";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SpendRevenueChart } from "@/components/admin/pemasaran/spend-revenue-chart";

// ---- derived metrics ----
const roasOf = (c: { revenue: number; spend: number }) =>
  c.spend > 0 ? c.revenue / c.spend : 0;
const ctrOf = (c: { clicks: number; impressions: number }) =>
  c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
const cpcOf = (c: { spend: number; clicks: number }) =>
  c.clicks > 0 ? c.spend / c.clicks : 0;
const cpaOf = (c: { spend: number; conversions: number }) =>
  c.conversions > 0 ? c.spend / c.conversions : 0;

const fmtRoas = (n: number) => `${n.toFixed(1).replace(".", ",")}×`;
const fmtPct = (n: number) => `${n.toFixed(2).replace(".", ",")}%`;

// blended totals across channels
const totals = AD_CHANNELS.reduce(
  (a, c) => ({
    spend: a.spend + c.spend,
    impressions: a.impressions + c.impressions,
    clicks: a.clicks + c.clicks,
    conversions: a.conversions + c.conversions,
    revenue: a.revenue + c.revenue,
  }),
  { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
);

// ---- small building blocks ----
function BrandSquare({
  channel,
  className = "size-8 rounded-lg text-sm",
}: {
  channel: AdChannel;
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

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="gap-0 p-5">
      <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" /> {label}
      </span>
      <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </Card>
  );
}

// ---- Tab 1: Ringkasan ----
function RingkasanTab() {
  const chartData = AD_CHANNELS.map((c) => ({
    name: c.name.replace(" Ads", ""),
    brand: c.brand,
    spend: c.spend,
    revenue: c.revenue,
  }));
  const blendedRoas = roasOf(totals);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Belanja Iklan"
          value={IDR(totals.spend, { compact: true })}
          helper="Gabungan 3 saluran, 30 hari terakhir"
          icon={Wallet}
        />
        <StatCard
          label="Pendapatan dari Iklan"
          value={IDR(totals.revenue, { compact: true })}
          helper="Nilai konversi terlacak"
          icon={TrendingUp}
        />
        <StatCard
          label="ROAS Gabungan"
          value={fmtRoas(blendedRoas)}
          helper="Pendapatan per Rp1 belanja"
          icon={Gauge}
        />
        <StatCard
          label="Total Konversi"
          value={num(totals.conversions)}
          helper="Pembelian dari iklan"
          icon={ShoppingCart}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Belanja vs Pendapatan per Saluran</CardTitle>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-muted-foreground/30" />
              Belanja
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-foreground/70" />
              Pendapatan
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <SpendRevenueChart data={chartData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Perbandingan Saluran</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Saluran</TableHead>
                  <TableHead className="text-right">Belanja</TableHead>
                  <TableHead className="text-right">Impresi</TableHead>
                  <TableHead className="text-right">Klik</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Konversi</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AD_CHANNELS.map((c) => {
                  const roas = roasOf(c);
                  return (
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
                      <TableCell className="text-right tabular-nums">
                        {IDR(c.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {num(c.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {num(c.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtPct(ctrOf(c))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {IDR(cpcOf(c))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(c.conversions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {IDR(c.revenue)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${
                          roas >= 3
                            ? "text-emerald-600 dark:text-emerald-400"
                            : ""
                        }`}
                      >
                        {fmtRoas(roas)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total gabungan</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {IDR(totals.spend)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {num(totals.impressions)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {num(totals.clicks)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtPct(ctrOf(totals))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {IDR(cpcOf(totals))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {num(totals.conversions)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {IDR(totals.revenue)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold tabular-nums ${
                      roasOf(totals) >= 3
                        ? "text-emerald-600 dark:text-emerald-400"
                        : ""
                    }`}
                  >
                    {fmtRoas(roasOf(totals))}
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

// ---- Tab 2: Saluran Iklan ----
function ChannelCard({ channel }: { channel: AdChannel }) {
  const roas = roasOf(channel);
  const topCampaigns = [...channel.campaigns].sort(
    (a, b) => roasOf(b) - roasOf(a),
  );
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <BrandSquare channel={channel} />
            <CardTitle className="text-base">{channel.name}</CardTitle>
          </div>
          {channel.connected ? (
            <Badge className="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3" /> Terhubung
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Belum terhubung
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniMetric label="Belanja" value={IDR(channel.spend, { compact: true })} />
          <MiniMetric label="ROAS" value={fmtRoas(roas)} accent={roas >= 3} />
          <MiniMetric label="Konversi" value={num(channel.conversions)} />
          <MiniMetric label="CPA" value={IDR(cpaOf(channel))} />
        </div>

        <Separator />

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Kampanye teratas
          </div>
          <ul className="space-y-2">
            {topCampaigns.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {IDR(c.spend, { compact: true })}
                </span>
                <span className="w-12 text-right font-semibold tabular-nums">
                  {fmtRoas(roasOf(c))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto pt-1">
          {channel.connected ? (
            <Button variant="outline" className="w-full">
              <Settings2 /> Kelola
            </Button>
          ) : (
            <Button className="w-full">
              <Plug /> Hubungkan
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          accent ? "text-emerald-600 dark:text-emerald-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SaluranTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {AD_CHANNELS.map((c) => (
        <ChannelCard key={c.key} channel={c} />
      ))}
    </div>
  );
}

// ---- Tab 3: Pelacakan ----
type TrackingState = Record<string, { pixel: boolean; capi: boolean }>;

function StatusLine({ active }: { active: boolean }) {
  return active ? (
    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5" /> Pelacakan aktif dan menerima peristiwa
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">
      Pelacakan nonaktif — konversi tidak akan terekam.
    </div>
  );
}

function PelacakanTab() {
  const [tracking, setTracking] = React.useState<TrackingState>(() =>
    Object.fromEntries(
      AD_CHANNELS.map((c) => [
        c.key,
        { pixel: c.pixelActive, capi: c.capiActive },
      ]),
    ),
  );

  const set = (key: string, field: "pixel" | "capi", val: boolean) =>
    setTracking((t) => ({ ...t, [key]: { ...t[key], [field]: val } }));

  const meta = AD_CHANNELS.find((c) => c.key === "meta")!;
  const google = AD_CHANNELS.find((c) => c.key === "google")!;
  const tiktok = AD_CHANNELS.find((c) => c.key === "tiktok")!;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pixel adalah kode pelacak yang mencatat tindakan pengunjung — melihat
        produk, menambah ke keranjang, hingga membeli — sehingga konversi dari
        setiap iklan dapat diukur dengan akurat. Aktifkan juga Conversions/Events
        API agar data tetap terkirim meski cookie browser diblokir.
      </p>

      {/* Meta */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <BrandSquare channel={meta} />
            <CardTitle className="text-base">{meta.pixelLabel}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meta-pixel">ID Meta Pixel</Label>
              <Input id="meta-pixel" defaultValue={meta.pixelId} />
            </div>
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="meta-pixel-active" className="cursor-pointer">
                  Pixel aktif
                </Label>
                <Switch
                  id="meta-pixel-active"
                  checked={tracking.meta.pixel}
                  onCheckedChange={(v) => set("meta", "pixel", v)}
                />
              </div>
            </div>
          </div>
          <Separator />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meta-capi">Token Conversions API (CAPI)</Label>
              <Input
                id="meta-capi"
                type="password"
                defaultValue="EAAxxxxxxxxxxxxxxxxxxxxxxxxx"
                placeholder="Tempel token CAPI"
              />
            </div>
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="meta-capi-active" className="cursor-pointer">
                  Conversions API aktif
                </Label>
                <Switch
                  id="meta-capi-active"
                  checked={tracking.meta.capi}
                  onCheckedChange={(v) => set("meta", "capi", v)}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusLine active={tracking.meta.pixel} />
            <Button variant="outline" size="sm">
              <Radio /> Uji peristiwa
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Google */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <BrandSquare channel={google} />
            <CardTitle className="text-base">{google.pixelLabel}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ga-tag">ID Google Tag (GA4)</Label>
              <Input id="ga-tag" defaultValue={google.pixelId} />
            </div>
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="ga-active" className="cursor-pointer">
                  Tag aktif
                </Label>
                <Switch
                  id="ga-active"
                  checked={tracking.google.pixel}
                  onCheckedChange={(v) => set("google", "pixel", v)}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5 md:max-w-[calc(50%-0.5rem)]">
            <Label htmlFor="gads-conv">ID Konversi Google Ads</Label>
            <Input id="gads-conv" defaultValue="AW-11234567/AbC-D_efG" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusLine active={tracking.google.pixel} />
            <Button variant="outline" size="sm">
              <Radio /> Uji peristiwa
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TikTok — not connected */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <BrandSquare channel={tiktok} />
              <CardTitle className="text-base">{tiktok.pixelLabel}</CardTitle>
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              Belum terhubung
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tt-pixel">ID TikTok Pixel</Label>
              <Input id="tt-pixel" placeholder="mis. C9XXXXXXXXXXXXXXXX" />
            </div>
            <div className="flex items-end">
              <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="tt-active" className="cursor-pointer">
                  Pixel aktif
                </Label>
                <Switch
                  id="tt-active"
                  checked={tracking.tiktok.pixel}
                  onCheckedChange={(v) => set("tiktok", "pixel", v)}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5 md:max-w-[calc(50%-0.5rem)]">
            <Label htmlFor="tt-token">Events API access token</Label>
            <Input
              id="tt-token"
              type="password"
              placeholder="Tempel access token"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Belum terhubung — hubungkan akun TikTok untuk mulai melacak
              konversi.
            </div>
            <Button size="sm">
              <Plug /> Hubungkan TikTok
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- page ----
export default function PemasaranPage() {
  const [tab, setTab] = React.useState("ringkasan");

  return (
    <>
      <PageHeader
        title="Pemasaran"
        desc="Kelola iklan dan pelacakan konversi dari Meta, Google, dan TikTok."
      >
        <Button variant="outline">
          <Download /> Ekspor laporan
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="mb-4">
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="saluran">Saluran Iklan</TabsTrigger>
          <TabsTrigger value="pelacakan">Pelacakan</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan">
          <RingkasanTab />
        </TabsContent>
        <TabsContent value="saluran">
          <SaluranTab />
        </TabsContent>
        <TabsContent value="pelacakan">
          <PelacakanTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
