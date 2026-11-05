"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2, Truck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { useCan } from "@/components/admin/permissions";
import { IDR } from "@tokophi/lib/format";
import { connectMengantar, getMengantarCard, rotateMengantarKey, type MengantarCardState } from "@/lib/actions/mengantar";

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

export function MengantarCard() {
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
  const meta = STATE[state];
  return (
    <Card data-mengantar-card={state}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" /> Akun Mengantar
          {card && <Badge className={`border-transparent ${meta.tone}`}>{meta.label}</Badge>}
        </CardTitle>
        <CardDescription>
          TokoΦ membuatkan akun Mengantar atas nama toko ini dengan email pemilik toko. Ongkir pesanan yang dikirim lewat Mengantar dibayar dari
          saldo Mengantar toko, dan ongkir yang dibayar pembeli masuk ke saldo TokoΦ toko. Pesanan COD dan toko yang belum terhubung tetap memakai
          pengiriman standar TokoΦ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!card ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat…
          </p>
        ) : (
          <>
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
            {card.lastError && state !== "connected" && <p className="text-xs text-muted-foreground">{card.lastError}</p>}
            {state === "email_taken" && (
              <p className="text-xs text-muted-foreground">
                Email pemilik toko sudah punya akun Mengantar sendiri, jadi TokoΦ tidak bisa membuatkan akun baru dengan email itu. Toko tetap
                memakai pengiriman standar TokoΦ.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {state !== "connected" && state !== "rotating" && (
                <Button size="sm" disabled={busy || state === "registering"} onClick={() => run(connectMengantar)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {state === "none" ? "Hubungkan Mengantar" : "Coba hubungkan lagi"}
                </Button>
              )}
              {state === "connected" && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => run(rotateMengantarKey)}>
                  <RefreshCw className="size-3.5" /> Perbarui kunci akses
                </Button>
              )}
            </div>
            {state === "none" && (
              <p className="text-xs text-muted-foreground">
                Dengan menekan “Hubungkan Mengantar”, kamu setuju TokoΦ membuat akun Mengantar atas nama toko ini memakai email dan nomor HP
                pengirim toko.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
