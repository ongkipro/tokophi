"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, KeyRound, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Badge } from "@tokophi/ui/badge";
import { Textarea } from "@tokophi/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@tokophi/ui/dialog";
import type { ProviderStatus } from "@/lib/data";
import { saveMengantarPartner, setShippingProvider } from "@/lib/actions";

// Mengantar Partner Business API (0116) — the PARTNER credential card and the platform switch.
//
// There is no Mengantar shipping key on the platform any more: every store has its OWN seller account,
// registered by TokoΦ with this partner credential (Pengiriman → Akun Mengantar toko shows them). What is
// drawn here is the partner id (not secret), the MASKED tail of the secret and where it came from —
// never a value. The secret typed in goes to the server action and nowhere else. Owner-only controls are
// hidden from an `admin` operator as a courtesy; `platformGate("owner")` inside the action is the boundary.

type Shipping = ProviderStatus["shipping"]["active"];
type Env = "sandbox" | "production";
const PROVIDER_LABEL: Record<Shipping, string> = { kiriminaja: "KiriminAja", mengantar: "Mengantar" };

const SOURCE_LABEL: Record<"db" | "env" | "none", string> = {
  db: "tersimpan",
  env: "env (cadangan)",
  none: "tidak ada",
};

function PartnerForm({ env, encryptionAvailable }: { env: Env; encryptionAvailable: boolean }) {
  const router = useRouter();
  const [partnerId, setPartnerId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = () =>
    startSave(async () => {
      const r = await saveMengantarPartner(env, partnerId, secret);
      setResult(r);
      if (r.ok) {
        setSecret("");
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.message);
    });
  const disabled = !encryptionAvailable || saving;
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="min-w-0 basis-40">
        <Label htmlFor={`mg-partner-id-${env}`} className="sr-only">Partner ID {env}</Label>
        <Input id={`mg-partner-id-${env}`} autoComplete="off" spellCheck={false} placeholder="Partner ID" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} disabled={disabled} />
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <Label htmlFor={`mg-partner-secret-${env}`} className="sr-only">Partner secret {env}</Label>
        <Input
          id={`mg-partner-secret-${env}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={encryptionAvailable ? "Partner secret" : "INTEGRATION_TOKEN_KEY belum diset — tidak bisa disimpan"}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={disabled}
        />
      </div>
      <Button type="submit" size="sm" disabled={disabled || !partnerId.trim() || !secret.trim()}>
        {saving ? "Menguji & menyimpan…" : "Uji & simpan"}
      </Button>
      {result && !result.ok && <p className="basis-full text-xs text-red-600 dark:text-red-400">✕ {result.message}</p>}
    </form>
  );
}

export function MengantarKeys({ status, canEdit, encryptionAvailable }: { status: ProviderStatus["mengantar"]; canEdit: boolean; encryptionAvailable: boolean }) {
  return (
    <div className="mb-3 space-y-2" data-provider-keys="mengantar">
      <p className="text-xs text-muted-foreground">
        Mengantar Partner Business API — kredensial <b>Partner</b> per lingkungan. Dengan kredensial ini TokoΦ membuatkan akun Mengantar untuk
        setiap toko (email pemilik toko); ongkir dan booking memakai kunci akun toko itu sendiri, dibayar dari saldo Mengantar toko. Lingkungan
        aktif: <b>{status.env}</b> (env MENGANTAR_ENV). Tersimpan terenkripsi, menang atas env container.
      </p>
      {(["sandbox", "production"] as const).map((env) => {
        const slot = status.slots[env];
        return (
          <div key={env} className="rounded-lg border bg-background p-3" data-key-slot={`mengantar:partner:${env}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">Partner {env}</span>
                {status.env === env && <Badge variant="secondary" className="border-transparent bg-primary/12 text-primary">aktif</Badge>}
                <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">{SOURCE_LABEL[slot.source]}</Badge>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{slot.partnerId ?? "—"}</code>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{slot.secretMasked}</code>
              </div>
            </div>
            {!slot.originKnown && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Origin Partner API {env} belum diketahui dari Mengantar — pendaftaran akun toko di {env} belum bisa jalan.</p>
            )}
            {canEdit && <PartnerForm env={env} encryptionAvailable={encryptionAvailable} />}
          </div>
        );
      })}
    </div>
  );
}

export function ShippingProviderSwitch({ shipping, mengantar, canEdit }: { shipping: ProviderStatus["shipping"]; mengantar: ProviderStatus["mengantar"]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [switching, startSwitch] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = shipping.active;
  const target: Shipping = current === "kiriminaja" ? "mengantar" : "kiriminaja";
  // Mirrors the server's readiness check so an owner is not offered a button that can only refuse.
  // The action re-checks; this is courtesy, not the boundary.
  const blocked = target === "mengantar" && !mengantar.ready;
  const reasonOk = reason.trim().length >= 5;

  const doSwitch = () =>
    startSwitch(async () => {
      const r = await setShippingProvider(target, reason);
      if (r.ok) {
        setOpen(false);
        setReason("");
        setError(null);
        toast.success(r.message, { duration: 8000 });
        router.refresh();
      } else {
        setError(r.message);
        toast.error(r.message, { duration: 8000 });
      }
    });

  return (
    <Card className="mb-4" data-shipping-provider={current}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" /> Provider pengiriman aktif
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span>Checkout baru memakai</span>
            <Badge variant="secondary" className="border-transparent bg-primary/12 text-primary" data-shipping-active>{PROVIDER_LABEL[current]}</Badge>
            <span className="text-xs text-muted-foreground">
              {shipping.source === "db" ? "· diatur dari sini" : shipping.source === "env" ? "· dari env SHIPPING_PROVIDER" : "· bawaan"}
            </span>
          </div>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={blocked || switching}
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
              data-shipping-switch
            >
              <ArrowLeftRight className="size-3.5" /> Alihkan ke {PROVIDER_LABEL[target]}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Peralihan hanya berlaku untuk <b>checkout baru</b> dari toko yang <b>akun Mengantar-nya sudah terhubung</b>. Toko lain dan semua
          pesanan COD tetap lewat KiriminAja. Pesanan yang sudah ada tetap memakai provider tempat pesanan itu dibuat — pelacakan,
          pembatalan, dan label mengikuti pesanannya, bukan pengaturan ini.
        </p>
        {canEdit && blocked && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-shipping-blocked>
            Belum bisa beralih ke Mengantar: {mengantar.why}
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && !switching && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alihkan provider pengiriman ke {PROVIDER_LABEL[target]}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Mulai sekarang, ongkir di checkout dan pemesanan kurir untuk <b>pesanan baru</b> lewat <b>{PROVIDER_LABEL[target]}</b>.
            </p>
            <p className="text-muted-foreground">
              Pesanan yang sudah ada tidak berpindah: pelacakan dan pembatalannya tetap lewat {PROVIDER_LABEL[current]}. Seller mungkin
              perlu memilih ulang layanan kurirnya.
            </p>
            {target === "mengantar" && (
              <p className="text-muted-foreground">Hanya toko dengan akun Mengantar terhubung yang berpindah; toko lain dan COD tetap lewat KiriminAja.</p>
            )}
            <div className="space-y-1 pt-1">
              <Label htmlFor="shipping-switch-reason">Alasan (wajib, minimal 5 karakter)</Label>
              <Textarea
                id="shipping-switch-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: uji coba Mengantar sudah lolos, mulai dipakai untuk semua toko"
                disabled={switching}
              />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">✕ {error}</p>}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={switching} />}>Batal</DialogClose>
            <Button disabled={switching || !reasonOk} onClick={doSwitch}>
              {switching ? "Mengalihkan…" : `Ya, alihkan ke ${PROVIDER_LABEL[target]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
