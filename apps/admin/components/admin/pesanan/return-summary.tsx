import { Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { num } from "@/lib/format";

// `pct()` in lib/format is a *delta* formatter (prefixes "+") — wrong for a rate. Local one.
const rate = (n: number) => `${(n * 100).toFixed(1)}%`;

// Shape mirrors `CourierReturns` from `lib/data/returns.ts`. Declared locally on purpose: that
// module is `server-only` and this card renders inside a client component.
export type CourierReturnRow = {
  courier: string;
  shipped: number;
  returned: number;
  returnRate: number; // 0..1
  codShipped: number;
  codReturned: number;
  codReturnRate: number; // 0..1
};

export function ReturnSummary({ rows }: { rows: CourierReturnRow[] }) {
  const shipped = rows.reduce((a, r) => a + r.shipped, 0);
  const returned = rows.reduce((a, r) => a + r.returned, 0);
  const codShipped = rows.reduce((a, r) => a + r.codShipped, 0);
  const codReturned = rows.reduce((a, r) => a + r.codReturned, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Undo2 className="size-4 text-orange-500" /> Retur
        </CardTitle>
      </CardHeader>
      <CardContent>
        {shipped === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada pesanan yang dikirim, jadi belum ada angka retur untuk ditampilkan.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Tingkat retur (semua)</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {rate(shipped ? returned / shipped : 0)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {num(returned)} dari {num(shipped)} paket terkirim
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tingkat retur COD</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {codShipped === 0 ? "—" : rate(codReturned / codShipped)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {codShipped === 0
                    ? "Belum ada paket COD terkirim"
                    : `${num(codReturned)} dari ${num(codShipped)} paket COD`}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              {rows.map((r) => (
                <div key={r.courier} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{r.courier}</span>
                  <span className="tabular-nums">
                    {num(r.returned)}/{num(r.shipped)}{" "}
                    <span className="text-muted-foreground">({rate(r.returnRate)})</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Honest caveat: `orders.courier` is only written when a shipment is booked through the
                aggregator, so historical/manual orders legitimately have no courier. */}
            {rows.some((r) => r.courier === "Tidak diketahui") && (
              <p className="text-xs text-muted-foreground">
                &quot;Tidak diketahui&quot; = pesanan tanpa data kurir (pengiriman belum dibuat lewat TokoΦ).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
