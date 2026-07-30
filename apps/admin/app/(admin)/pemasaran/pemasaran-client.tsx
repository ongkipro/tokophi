"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download,
  ShoppingCart,
  TrendingUp,
  Info,
  Plug,
  Ban,
  Loader2,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@tokophi/lib/format";
import type { AdChannelStatus } from "@/lib/data/marketing";
import type { TrackingConfig, TrackingChannelKey, TrackingHealth } from "@/lib/data/tracking";
import { setTrackingChannel, retryTrackingDeliveries, testTrackingConnection, clearTrackingToken } from "@/lib/actions/tracking";
import { useCan } from "@/components/admin/permissions";
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

// ---- Tab 2: Pelacakan (REAL — merchant configures pixels + CAPI, persisted to store_tracking_channels) ----
// Shopify-style: the merchant pastes their own Pixel/Tag ID (public) and optional server-side token
// (CAPI/Measurement Protocol/Events API, encrypted at rest). The storefront fires from this config.
const CH_META: Record<TrackingChannelKey, { name: string; brand: string; pixelLabel: string; pixelHint: string; capiName: string; where: string }> = {
  meta:   { name: "Meta Pixel",          brand: "#0866FF", pixelLabel: "Pixel ID",            pixelHint: "cth. 1023456789012345",       capiName: "Conversions API (CAPI)", where: "Meta Events Manager → Data Sources → Pixel" },
  google: { name: "Google (GA4 / Ads)",  brand: "#4285F4", pixelLabel: "Measurement / Tag ID", pixelHint: "G-XXXXXXX atau AW-XXXXXXXXX", capiName: "Measurement Protocol",    where: "GA4 Admin → Data Streams (atau Google Ads → Konversi)" },
  tiktok: { name: "TikTok Pixel",        brand: "#000000", pixelLabel: "Pixel ID",            pixelHint: "cth. C4A7B8C9D0E1F2G3H4",     capiName: "Events API",             where: "TikTok Ads Manager → Aset → Events" },
};

function TrackingCard({ cfg, health }: { cfg: TrackingConfig; health?: TrackingHealth }) {
  const canWrite = useCan("integrations:write");
  const router = useRouter();
  const meta = CH_META[cfg.channel];
  const [enabled, setEnabled] = React.useState(cfg.enabled);
  const [pixelId, setPixelId] = React.useState(cfg.pixelId);
  const [advanced, setAdvanced] = React.useState(cfg.advancedMatching);
  const [capiEnabled, setCapiEnabled] = React.useState(cfg.capiEnabled);
  const [capiToken, setCapiToken] = React.useState(""); // blank = leave stored token unchanged
  const [testCode, setTestCode] = React.useState(cfg.testEventCode);
  const [adsSendTo, setAdsSendTo] = React.useState(cfg.adsSendTo);
  const [saving, start] = React.useTransition();
  const [retrying, startRetry] = React.useTransition();
  const [testing, startTest] = React.useTransition();

  const test = () =>
    startTest(async () => {
      const r = await testTrackingConnection(cfg.channel);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  const clearToken = () =>
    startTest(async () => {
      const r = await clearTrackingToken(cfg.channel);
      if (r.ok) { toast.success("Token server dihapus."); router.refresh(); }
      else toast.error(r.error ?? "Gagal menghapus token.");
    });

  const retry = () =>
    startRetry(async () => {
      const r = await retryTrackingDeliveries(cfg.channel);
      if (r.ok) { toast.success(`${r.requeued ?? 0} konversi dimasukkan ke antrean lagi.`); router.refresh(); }
      else toast.error(r.error ?? "Gagal mengantre ulang.");
    });

  const save = () =>
    start(async () => {
      const r = await setTrackingChannel({
        channel: cfg.channel,
        enabled,
        pixelId,
        capiEnabled,
        advancedMatching: advanced,
        testEventCode: testCode,
        adsSendTo: cfg.channel === "google" ? adsSendTo : undefined,
        capiToken: capiToken.trim() ? capiToken.trim() : undefined,
      });
      if (r.ok) { toast.success(`${meta.name} disimpan.`); setCapiToken(""); router.refresh(); }
      else toast.error(r.error ?? "Gagal menyimpan.");
    });

  const live = cfg.enabled && cfg.pixelId;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden style={{ background: meta.brand }} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white">{meta.name.charAt(0)}</span>
            <div>
              <CardTitle className="text-base">{meta.name}</CardTitle>
              <p className="text-xs text-muted-foreground">Dari {meta.where}</p>
            </div>
          </div>
          {live ? (
            <Badge className="gap-1 bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="size-3.5" /> Aktif</Badge>
          ) : (
            <NotConnectedBadge />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${cfg.channel}-pixel`}>{meta.pixelLabel}</Label>
            <Input id={`${cfg.channel}-pixel`} value={pixelId} onChange={(e) => setPixelId(e.target.value.trim())} placeholder={meta.pixelHint} disabled={!canWrite} />
          </div>
          <div className="flex items-end">
            <div className="flex w-full items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor={`${cfg.channel}-active`} className="cursor-pointer">Aktifkan pelacakan</Label>
              <Switch id={`${cfg.channel}-active`} checked={enabled} onCheckedChange={setEnabled} disabled={!canWrite} />
            </div>
          </div>
        </div>

        {/* Google Ads is a SEPARATE destination from GA4 — different id, and a per-action conversion
            label. One field could only ever serve one of them, so a merchant running both had one
            silently doing nothing. */}
        {cfg.channel === "google" && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label htmlFor="ads-send-to">Tujuan konversi Google Ads (opsional)</Label>
            <Input id="ads-send-to" value={adsSendTo} onChange={(e) => setAdsSendTo(e.target.value.trim())}
              placeholder="AW-123456789/AbC-D_efGh" disabled={!canWrite} />
            <p className="text-xs text-muted-foreground">
              Dari Google Ads → Tujuan → konversi Anda → &quot;Tag&quot; (gabungan ID konversi dan label).
              Kolom di atas untuk <span className="font-medium text-foreground">GA4</span> (analitik);
              yang ini yang membuat konversi tercatat di <span className="font-medium text-foreground">Google Ads</span>.
              Isi keduanya kalau Anda memakai keduanya.
            </p>
          </div>
        )}

        {/* Advanced matching */}
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium"><ShieldCheck className="size-4 text-muted-foreground" /> Advanced matching (browser)</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Kirim email/telepon pembeli (di-hash) dari browser agar konversi lebih akurat. Event sisi
              server selalu menyertakannya — tanpa itu {meta.name} tidak bisa mencocokkan konversi sama sekali.
            </p>
          </div>
          <Switch checked={advanced} onCheckedChange={setAdvanced} disabled={!canWrite} />
        </div>

        {/* CAPI / server-side */}
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{meta.capiName} <span className="font-normal text-muted-foreground">— pelacakan sisi server</span></div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Kirim event dari server TokoΦ (tahan ad-blocker). Butuh token akses.{" "}
                <span className="text-foreground">Pesanan prabayar (VA/QRIS) hanya terhitung lewat jalur ini</span> —
                dihitung saat pembayaran terkonfirmasi, bukan saat halaman terima kasih. Pesanan COD
                terhitung begitu pesanan masuk.
              </p>
            </div>
            <Switch checked={capiEnabled} onCheckedChange={setCapiEnabled} disabled={!canWrite} />
          </div>
          {capiEnabled && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${cfg.channel}-capi`}>Token akses server</Label>
                <Input id={`${cfg.channel}-capi`} type="password" value={capiToken} onChange={(e) => setCapiToken(e.target.value)}
                  placeholder={cfg.capiConfigured ? "•••••••• (tersimpan — isi untuk mengganti)" : "Tempel token akses"} disabled={!canWrite} autoComplete="off" />
                <p className="text-xs text-muted-foreground">
                  Disimpan terenkripsi. {cfg.capiConfigured ? "Token sudah tersimpan." : "Belum ada token."}
                </p>
                {canWrite && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={test} disabled={testing}>
                      {testing && <Loader2 className="size-4 animate-spin" />} Uji koneksi
                    </Button>
                    {cfg.capiConfigured && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={clearToken} disabled={testing}>
                        Hapus token
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {cfg.channel !== "google" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${cfg.channel}-testcode`}>Kode uji (opsional)</Label>
                  <Input id={`${cfg.channel}-testcode`} value={testCode} onChange={(e) => setTestCode(e.target.value.trim())}
                    placeholder="cth. TEST12345" disabled={!canWrite} />
                  {/* Not a sandbox. Meta documents that events carrying a test code still flow into
                      Events Manager and are used for targeting and measurement — saying otherwise would
                      invite a merchant to pollute their own dataset while "just testing". */}
                  <p className="text-xs text-muted-foreground">
                    Menandai event agar muncul di {cfg.channel === "meta" ? "Events Manager → Test Events" : "TikTok Events Manager → Test Event"}.
                    Event tetap terkirim dan tetap terhitung — kosongkan saat sudah live.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Kesehatan pengiriman event 7 hari terakhir — hanya metadata, tak pernah payload provider.
              Deliberately NOT gated on `capiEnabled`: switching CAPI off is the first thing a merchant
              tries when something looks broken, and hiding the diagnostics at that exact moment is how
              a fixable problem becomes a support ticket. */}
          {health && (health.succeeded + health.queued + health.failed + health.deadLetter) > 0 && (
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="font-medium">7 hari terakhir:</span>
                <span className="text-emerald-600">{num(health.succeeded)} terkirim</span>
                {health.queued > 0 && <span className="text-muted-foreground">{num(health.queued)} antre</span>}
                {health.failed > 0 && <span className="text-amber-600">{num(health.failed)} dicoba ulang</span>}
                {health.deadLetter > 0 && <span className="text-destructive">{num(health.deadLetter)} gagal</span>}
              </div>
              {health.lastError && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  Kendala terakhir: {health.lastError}
                </p>
              )}
              {/* Without this, a gagal conversion is a one-way door: the merchant fixes the token and
                  the events from the broken window stay lost. Bounded to 7 hari — older than that and
                  the ad platforms reject them anyway. */}
              {health.deadLetter > 0 && canWrite && (
                <Button size="sm" variant="outline" className="mt-2" onClick={retry} disabled={retrying}>
                  {retrying && <Loader2 className="size-4 animate-spin" />} Coba kirim ulang
                </Button>
              )}
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />} Simpan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PelacakanTab({ tracking, health, mayRead }: { tracking: TrackingConfig[]; health: Record<TrackingChannelKey, TrackingHealth>; mayRead: boolean }) {
  if (!mayRead) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        Pengaturan pelacakan berisi kredensial toko, jadi hanya <span className="font-medium text-foreground">Owner</span> yang
        bisa melihat dan mengubahnya — sama seperti Pengaturan toko.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pixel adalah kode pelacak yang mencatat tindakan pengunjung — melihat produk, menambah ke
        keranjang, hingga membeli — sehingga konversi dari setiap iklan dapat diukur. Tempel ID Pixel/Tag
        milik Anda, aktifkan, dan TokoΦ memasangnya di storefront otomatis.
      </p>
      {tracking.map((t) => (
        <TrackingCard key={t.channel} cfg={t} health={health[t.channel]} />
      ))}
    </div>
  );
}

// ---- page ----
export function PemasaranClient({ channels, feed, tracking, health, mayReadTracking }: { channels: AdChannelStatus[]; feed: FeedStatus; tracking: TrackingConfig[]; health: Record<TrackingChannelKey, TrackingHealth>; mayReadTracking: boolean }) {
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
          <PelacakanTab tracking={tracking} health={health} mayRead={mayReadTracking} />
        </TabsContent>
      </Tabs>
    </>
  );
}
