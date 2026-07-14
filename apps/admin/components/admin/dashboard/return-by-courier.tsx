import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { num } from "@tokophi/lib/format";
import type { ReturnSummary } from "@/lib/data/dashboard";

/**
 * Retur per kurir — which courier is sending parcels back, and (when COD is on) whether COD is the
 * reason. Denominator is orders that SHIPPED (dikirim | selesai | retur), same as getReturnsByCourier.
 */
export function ReturnByCourier({ returns: r }: { returns: ReturnSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retur per Kurir</CardTitle>
        <CardDescription>
          {r.codShipped > 0
            ? "Bandingkan retur COD vs non-COD"
            : "Dari paket yang sudah dikirim"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.byCourier.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada paket yang dikirim.</p>
        ) : (
          r.byCourier.map((c) => {
            const rate = c.returnRate * 100;
            return (
              <div key={c.courier} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-sm font-medium">{c.courier}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", rate > 5 ? "bg-destructive" : "bg-emerald-500/70")}
                    style={{ width: `${Math.min(100, Math.max(rate, c.returned ? 4 : 0))}%` }}
                  />
                </div>
                <span className="w-11 text-right text-sm font-medium tabular-nums">{rate.toFixed(1)}%</span>
                <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
                  {num(c.returned)}/{num(c.shipped)}
                </span>
              </div>
            );
          })
        )}
        {r.codShipped === 0 && r.byCourier.length > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            Belum ada pesanan COD — semua retur di atas berasal dari pesanan yang sudah dibayar di muka.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
