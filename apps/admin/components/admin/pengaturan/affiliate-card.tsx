"use client";
// Pengaturan → Affiliate: the seller's OWN switch for the store affiliate programme (ADR 0022 — no Super
// Admin gate). Rates, approvals and payouts live on the Affiliate screen; this card only turns it on/off.
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { ToggleRow } from "@/components/admin/pengaturan/toggle-row";
import { useCan } from "@/components/admin/permissions";
import { getAffiliateProgramEnabled, setAffiliateProgramEnabled } from "@/lib/actions/affiliates";

export function AffiliateCard() {
  const canWrite = useCan("affiliates:write");
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    getAffiliateProgramEnabled().then(setEnabled);
  }, []);

  const toggle = (next: boolean) =>
    start(async () => {
      const r = await setAffiliateProgramEnabled(next);
      if (!r.ok) {
        toast.error(r.error ?? "Gagal menyimpan.");
        return;
      }
      setEnabled(next);
      toast.success(next ? "Program affiliate diaktifkan." : "Program affiliate dimatikan.");
    });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Program affiliate</CardTitle>
        <CardDescription>
          Reseller dan kreator mempromosikan toko Anda dengan kode atau link. Komisi dicatat otomatis dari pesanan; Anda
          mentransfernya sendiri (di luar TokoΦ) lalu menandainya dibayar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ToggleRow
          title="Aktifkan program affiliate"
          description="Saat aktif: kolom kode affiliate muncul di checkout, link affiliate dihitung, dan halaman /affiliate di toko menerima pendaftaran."
          checked={enabled === true}
          onCheckedChange={toggle}
          disabled={!canWrite || enabled === null || pending}
        />
        {enabled === false && (
          <p className="text-xs text-muted-foreground">
            Sedang mati: tidak ada komisi baru. Komisi dan affiliate yang sudah tercatat tetap tersimpan.
          </p>
        )}
        {!canWrite && <p className="text-xs text-muted-foreground">Peran Anda hanya bisa melihat pengaturan ini.</p>}
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" nativeButton={false} render={<Link href="/affiliate" />}>
          Kelola affiliate &amp; komisi
        </Button>
      </CardFooter>
    </Card>
  );
}
