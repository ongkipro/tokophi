"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { useCan } from "@/components/admin/permissions";
import { getKelolaOrderPanel, resendKelolaOrder, type KelolaOrderPanel as Panel } from "@/lib/actions/plugins";

// Order detail → "Kelola CRM" (ADR 0021, KEL-001). Renders NOTHING unless the store has the Kelola
// plugin active and connected (dormant = zero effect, on this screen too). Read-only status plus
// "Kirim ulang" (`orders:write`). Kelola never changes this order's status — it is a CRM mirror.

const fmt = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(d)) : "";

export function KelolaOrderPanel({ orderNumber }: { orderNumber: string }) {
  const canOrders = useCan("orders:write");
  const [panel, setPanel] = React.useState<Panel | null>(null);
  const [busy, startBusy] = React.useTransition();

  const load = React.useCallback(() => {
    getKelolaOrderPanel(orderNumber).then(setPanel).catch(() => setPanel(null));
  }, [orderNumber]);
  React.useEffect(() => {
    if (canOrders) load();
  }, [canOrders, load]);

  if (!canOrders || !panel?.active) return null;
  const s = panel.state;

  let status: React.ReactNode;
  if (s?.synced_at) status = <>Terkirim ke Kelola · {fmt(s.synced_at)}</>;
  // attempts 0 + gave_up = skipped because the plugin was OFF when the order came in (never POSTed).
  else if (s?.gave_up_at && !s.attempts) status = <span className="text-muted-foreground">{s.last_error}</span>;
  else if (s?.gave_up_at) status = <span className="text-red-700">Ditolak Kelola: {s.last_error}</span>;
  else if (s?.attempts) status = <span className="text-amber-700">Gagal ({s.attempts}×), dicoba lagi otomatis: {s.last_error}</span>;
  else status = <span className="text-muted-foreground">Belum terkirim. Pesanan COD dikirim saat dibuat; prabayar setelah lunas.</span>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kelola CRM</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="break-words">{status}</p>
        {s?.last_note && <p className="text-xs text-muted-foreground">{s.last_note}</p>}
        {!s?.synced_at && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              startBusy(async () => {
                const r = await resendKelolaOrder(orderNumber);
                if (r.ok) toast.success(r.message);
                else toast.error(r.message, { duration: 10000 });
                load();
              })
            }
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Kirim ulang
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
