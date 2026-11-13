"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@tokophi/ui/dialog";
import { setStoreShippingProvider } from "@/lib/actions";
import type { StoreShipping } from "@/lib/shipping-data";

// ADR 0019 — which provider quotes THIS store's non-COD checkouts. Super Admin decides (owner 2026-11-13);
// the seller never does. The action (`setStoreShippingProvider`) is the boundary — owner rank, reason
// required, the outcome re-read and written to the store's activity log. The button is shown to every
// operator who can open this page, the way every other control here is: the gate answers in words.

const LABEL = { kiriminaja: "KiriminAja", mengantar: "Mengantar" } as const;
const ACCOUNT: Record<string, string> = {
  none: "belum ada",
  pending: "diantrekan",
  registering: "sedang didaftarkan",
  connected: "terhubung",
  email_taken: "email sudah dipakai di Mengantar",
  failed: "perlu dilengkapi",
  blocked: "diblokir",
  rotating: "memperbarui kunci",
};

export function ShippingProviderCard({ storeId, storeName, shipping }: { storeId: string; storeName: string; shipping: StoreShipping }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const target = shipping.provider === "mengantar" ? "kiriminaja" : "mengantar";

  // What the dispatch will actually do for this store right now — the same rule as `quoteShipping`.
  const effective =
    shipping.provider !== "mengantar"
      ? "Checkout non-COD dan COD memakai KiriminAja."
      : shipping.platformSwitch !== "mengantar"
        ? "Saklar platform sedang KiriminAja, jadi toko ini tetap memakai KiriminAja sampai saklar dinyalakan lagi."
        : shipping.accountState === "connected"
          ? "Checkout non-COD memakai akun Mengantar toko; COD tetap KiriminAja."
          : "Akun Mengantar toko belum terhubung — sementara itu checkout memakai KiriminAja.";

  const submit = () =>
    start(async () => {
      const r = await setStoreShippingProvider(storeId, target, reason);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setOpen(false);
      setReason("");
      router.refresh();
    });

  return (
    <Card data-store-shipping-provider={shipping.provider}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" /> Penyedia pengiriman
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Penyedia toko</span>
          <Badge variant="outline" className="font-semibold">{LABEL[shipping.provider]}</Badge>
        </div>
        {shipping.provider === "mengantar" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Akun Mengantar ({shipping.accountEnv})</span>
            <span className="text-right">{ACCOUNT[shipping.accountState] ?? shipping.accountState}</span>
          </div>
        )}
        {shipping.signupCode && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Kode daftar</span>
            <span className="font-mono text-xs">{shipping.signupCode}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{effective}</p>
        <Button variant="outline" size="sm" className="w-full" disabled={pending} onClick={() => setOpen(true)}>
          Pindahkan ke {LABEL[target]}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pindahkan {storeName} ke {LABEL[target]}?
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 text-sm text-muted-foreground">
            {target === "mengantar" ? (
              <p>
                Checkout non-COD toko ini memakai akun Mengantar milik toko begitu akunnya terhubung. Bila belum ada akun, TokoΦ
                mengantrekannya dan <b>menunggu persetujuan pemilik</b> lewat tombol “Hubungkan Mengantar” di Pengaturan Seller — tidak
                pernah didaftarkan tanpa persetujuan. COD tetap KiriminAja.
              </p>
            ) : (
              <p>
                Semua checkout baru toko ini kembali ke KiriminAja. Akun Mengantar toko (bila ada) tidak dihapus, dan pesanan Mengantar
                yang sudah ada tetap dikirim dan dilacak lewat akun itu.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="provider-reason" className="text-foreground">
                Alasan (wajib, masuk log aktivitas toko)
              </Label>
              <Input id="provider-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. permintaan pemilik toko via WhatsApp" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Batal</Button>} />
            <Button disabled={pending || reason.trim().length < 5} onClick={submit}>
              {pending ? "Menyimpan…" : `Pindahkan ke ${LABEL[target]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
