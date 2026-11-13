"use client";
import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plug, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { useCan } from "@/components/admin/permissions";
import { ConfirmDelete } from "@/components/admin/confirm-delete";
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row";
import {
  disconnectKelolaAction,
  getPluginCard,
  removePluginData,
  saveKelola,
  setKelolaLeads,
  setPluginActive,
  type PluginCardState,
} from "@/lib/actions/plugins";

// Pengaturan → Plugin (ADR 0019, KEL-001) — the same list AdsBookCMS shows at Pengaturan → Plugin.
// Owner-only (`plugins:manage`): the actions are the boundary, this hides the card from roles that
// cannot use it. Every action answers `{ ok, message }`; the message is shown either way.

const fmt = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(d)) : "—";

export function PluginCard() {
  const canManage = useCan("plugins:manage");
  const [card, setCard] = React.useState<PluginCardState | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [busy, startBusy] = React.useTransition();
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const load = React.useCallback(() => {
    getPluginCard()
      .then((c) => { setCard(c); setLoadError(false); })
      .catch(() => setLoadError(true));
  }, []);
  React.useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plugin</CardTitle>
          <CardDescription>Hanya Pemilik toko yang dapat mengaktifkan plugin dan menyambungkan akunnya.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    startBusy(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message, { duration: 10000 });
      if (r.ok) after?.();
      load();
    });

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plugin</CardTitle>
          <CardDescription>Daftar plugin gagal dimuat. Muat ulang halaman ini.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!card) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Memuat plugin…
        </CardContent>
      </Card>
    );
  }

  const k = card.kelola;
  const kelolaMeta = card.plugins.find((p) => p.id === "kelola");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" aria-hidden /> Plugin
          </CardTitle>
          <CardDescription>
            Fitur tambahan buatan TokoΦ yang bisa Anda aktifkan per toko. Plugin yang tidak diaktifkan tidak berjalan sama
            sekali — tidak mengirim data apa pun.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {card.plugins.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.enabled ? (
                    <Badge className="bg-emerald-100 text-emerald-800">Aktif</Badge>
                  ) : p.installed ? (
                    <Badge variant="secondary">Nonaktif</Badge>
                  ) : (
                    <Badge variant="outline">Belum diaktifkan</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{p.description}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={p.enabled ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => run(() => setPluginActive(p.id, !p.enabled))}
                >
                  {p.enabled ? "Nonaktifkan" : "Aktifkan"}
                </Button>
                {p.installed && (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                    Hapus data
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {kelolaMeta?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Kelola CRM</CardTitle>
            <CardDescription>
              Setiap pesanan COD dikirim ke Penjualan Kelola begitu dibuat; pesanan prabayar dikirim setelah lunas (paling
              lambat sekitar 15 menit). Status pesanan tetap diatur di TokoΦ.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {k.brokenAt && (
              <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Kelola menolak kredensial toko ini sejak {fmt(k.brokenAt)}. Pengiriman dihentikan. Tempel ulang URL & secret
                  dari Kelola lalu simpan — pesanan yang tertunda akan dikirim otomatis.
                </span>
              </div>
            )}
            {!k.encryptionReady && (
              <p role="alert" className="text-sm text-red-700">Server belum siap menyimpan kredensial terenkripsi. Hubungi tim TokoΦ.</p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {k.configured ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  <span>Terhubung ke</span>
                  <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{k.maskedUrl}</code>
                  <span className="text-muted-foreground">sejak {fmt(k.connectedAt)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Belum terhubung.</span>
              )}
            </div>

            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveKelola({ url, secret }), () => setSecret(""));
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="kelola-url">URL webhook pesanan</Label>
                <Input
                  id="kelola-url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://kelolatim.com/api/public/toko/order/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Di Kelola: Toko → Pengaturan → Toko & advertiser → hubungkan toko → salin URL & secret.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kelola-secret">Secret</Label>
                <Input
                  id="kelola-secret"
                  type="password"
                  autoComplete="new-password"
                  placeholder={k.configured ? "Kosongkan untuk tetap memakai secret yang tersimpan" : ""}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required={!k.configured}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !k.encryptionReady}>
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Simpan & tes koneksi
                </Button>
                {k.configured && (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => disconnectKelolaAction())}>
                    Putuskan
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Kredensial hanya disimpan setelah Kelola menerimanya, dan tidak pernah ditampilkan lagi.
              </p>
            </form>

            <ToggleRow
              title="Kirim keranjang yang ditinggal"
              description="Pembeli yang mengisi nomor WhatsApp lalu meninggalkan checkout dikirim ke Data tertinggal Kelola untuk di-follow up CS."
              checked={k.pushLeads}
              disabled={busy || !k.configured}
              onCheckedChange={(on) => run(() => setKelolaLeads(on))}
            />

            {k.sync && k.configured && (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Terkirim (7 hari)</dt><dd className="tabular-nums font-medium">{k.sync.synced}</dd></div>
                <div><dt className="text-muted-foreground">Gagal, dicoba lagi</dt><dd className="tabular-nums font-medium">{k.sync.failing}</dd></div>
                <div><dt className="text-muted-foreground">Ditolak Kelola</dt><dd className="tabular-nums font-medium">{k.sync.gave_up}</dd></div>
                <div><dt className="text-muted-foreground">Terakhir terkirim</dt><dd className="font-medium">{fmt(k.sync.last_synced_at)}</dd></div>
                {k.sync.lastError && (
                  <div className="col-span-full text-xs text-muted-foreground">
                    Galat terakhir ({k.sync.lastError.number}, {k.sync.lastError.attempts}× dicoba): {k.sync.lastError.last_error}
                  </div>
                )}
              </dl>
            )}

            <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Dengan menghubungkan Kelola, nama, nomor WhatsApp, dan alamat pembeli pada setiap pesanan — serta keranjang yang
                ditinggal bila diaktifkan — dikirim ke Kelola sebagai pemroses data toko Anda (UU PDP). Pastikan kebijakan
                privasi toko Anda menyebutkannya.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDelete
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Hapus data Kelola CRM?"
        description="Kredensial dan riwayat pengiriman ke Kelola di toko ini dihapus permanen, dan plugin dinonaktifkan. Data yang sudah ada di Kelola tidak terhapus."
        confirmLabel="Ya, hapus data"
        pending={busy}
        onConfirm={() => run(() => removePluginData("kelola"), () => setConfirmRemove(false))}
      />
    </div>
  );
}
