"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2, Truck, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { useCan } from "@/components/admin/permissions";
import { IDR } from "@tokophi/lib/format";
import { connectMengantar, getMengantarCard, rotateMengantarKey, type MengantarCardState } from "@/lib/actions/mengantar";
import { MengantarConsent } from "@/components/admin/mengantar-consent";

// Pengaturan → Pengiriman → "Akun Mengantar" (Mengantar Partner Business API). The store's own Mengantar
// account is created by TokoΦ with the owner's email — automatically at signup, or with one click here.
// The seller never sees or pastes a key (owner O7/O10). Owner-only (`settings:write`); the action is the
// boundary, this hides the card from roles that cannot use it. Seller copy may say "Mengantar" (O5).

const STATE: Record<MengantarCardState["state"], { label: string; tone: string }> = {
  none: { label: "Belum terhubung", tone: "bg-muted text-muted-foreground" },
  pending: { label: "Dijadwalkan", tone: "bg-amber-100 text-amber-800" },
  registering: { label: "Sedang didaftarkan", tone: "bg-amber-100 text-amber-800" },
  connected: { label: "Terhubung", tone: "bg-emerald-100 text-emerald-800" },
  email_taken: { label: "Email sudah dipakai di Mengantar", tone: "bg-red-100 text-red-700" },
  failed: { label: "Perlu dilengkapi", tone: "bg-red-100 text-red-700" },
  blocked: { label: "Dinonaktifkan", tone: "bg-red-100 text-red-700" },
  rotating: { label: "Memperbarui kunci", tone: "bg-amber-100 text-amber-800" },
};

/** `onOpenAlamat` jumps to Pengaturan → Alamat (the page owns which section is open). */
export function MengantarCard({ onOpenAlamat }: { onOpenAlamat?: () => void } = {}) {
  const canOwn = useCan("settings:write");
  const [card, setCard] = React.useState<MengantarCardState | null>(null);
  const [busy, startBusy] = React.useTransition();

  const load = React.useCallback(() => {
    getMengantarCard().then(setCard).catch(() => setCard(null));
  }, []);
  React.useEffect(() => {
    if (canOwn) load();
  }, [canOwn, load]);

  if (!canOwn) return null;

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startBusy(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.message(r.message, { duration: 10000 });
      load();
    });

  const state = card?.state ?? "none";
  // Created by TokoΦ (Super Admin) or approved without the owner's click: the account waits for THEIR
  // agreement (`connectStoreMengantar`, partner docs) — a first-time connect, not a failed one.
  const awaitingConsent = state === "pending" && card?.lastErrorCode === "awaiting_consent";
  const meta = awaitingConsent ? { label: "Perlu persetujuan", tone: "bg-amber-100 text-amber-800" } : STATE[state];
  const firstConnect = state === "none" || awaitingConsent;
  // No button that cannot work: `blocked` is always refused (`sellerConnectRefusal`), and a store still
  // waiting for TokoΦ's approval is parked again by `connectStoreMengantar` whatever the owner clicks.
  const awaitingApproval = state === "pending" && card?.lastErrorCode === "awaiting_approval";
  const canConnect = state !== "connected" && state !== "rotating" && state !== "blocked" && !awaitingApproval;
  return (
    <Card data-mengantar-card={state}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" /> Akun Mengantar
          {card && <Badge className={`border-transparent ${meta.tone}`}>{meta.label}</Badge>}
        </CardTitle>
        <CardDescription>
          Pengiriman non-COD tokomu memakai akun Mengantar milik toko sendiri, dibuat oleh TokoΦ. Ongkir ke kurir dibayar dari saldo Mengantar
          toko; ongkir yang dibayar pembeli masuk ke saldo TokoΦ-mu.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!card ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat…
          </p>
        ) : (
          <>
            {/* Whether checkout ACTUALLY quotes through Mengantar. "Terhubung" alone misled: a broken
                link below falls back silently (O6), right for the shopper, invisible to the seller.
                Glyph + words, never colour alone. */}
            <div
              data-mengantar-checkout={card.checkout.active ? "active" : card.checkout.fix ?? "platform"}
              className="flex items-start gap-2 rounded-lg border p-3"
            >
              {card.checkout.active ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{card.checkout.active ? "Dipakai di checkout" : "Belum dipakai di checkout"}</p>
                <p className="text-xs text-muted-foreground">
                  {card.checkout.active
                    ? "Ongkir pesanan non-COD toko ini dihitung dan dikirim lewat Mengantar. COD tetap memakai pengiriman standar TokoΦ."
                    : card.checkout.reason}
                </p>
                {card.checkout.fix === "alamat" && onOpenAlamat && (
                  <Button size="sm" variant="outline" className="mt-1" onClick={onOpenAlamat}>
                    Buka Alamat Pengambilan
                  </Button>
                )}
              </div>
            </div>
            {state === "connected" && card.balance != null && card.balance <= 0 && (
              <p className="flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Saldo Mengantar kosong. Pengiriman yang kamu buat tetap tercatat, tapi ongkirnya berstatus belum dibayar dan resi belum terbit
                sampai saldo diisi lalu ongkir dibayar dari halaman pesanan.
              </p>
            )}
            {state === "connected" && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Email akun</dt>
                <dd className="min-w-0 truncate">{card.ownerEmail ?? "—"}</dd>
                <dt className="text-muted-foreground">Saldo Mengantar</dt>
                <dd className="tabular-nums">{card.balance == null ? "—" : IDR(card.balance)}</dd>
              </dl>
            )}
            {state === "connected" && (
              <p className="text-xs text-muted-foreground">
                Masuk ke aplikasi Mengantar lewat “Lupa Password” dengan email di atas untuk mengisi saldo, melihat pengiriman, atau menarik dana.
              </p>
            )}
            {awaitingConsent ? (
              <p className="text-xs text-muted-foreground">
                Akun Mengantar toko ini belum dibuat karena menunggu persetujuanmu sebagai pemilik toko. Tekan “Hubungkan Mengantar” — sekali saja.
              </p>
            ) : (
              card.lastError && state !== "connected" && <p className="text-xs text-muted-foreground">{card.lastError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {canConnect && (
                <Button size="sm" disabled={busy || state === "registering"} onClick={() => run(connectMengantar)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {firstConnect ? "Hubungkan Mengantar" : "Coba hubungkan lagi"}
                </Button>
              )}
              {state === "connected" && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => run(rotateMengantarKey)}>
                  <RefreshCw className="size-3.5" /> Perbarui kunci akses
                </Button>
              )}
            </div>
            {/* The agreement sits next to EVERY button that can create the account (a retry can be the
                first successful registration too). */}
            {canConnect && <MengantarConsent action="connect" />}
            {state === "connected" && (
              <p className="text-xs text-muted-foreground">
                Memakai webhook di aplikasi Mengantar? Setelah kunci diperbarui, perbarui juga secret webhook-mu di sana.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
