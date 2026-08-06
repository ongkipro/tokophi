import { Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@tokophi/ui/card";
import { NO_FIGURE, num, share } from "@tokophi/lib/format";

// `share()` is the part-of-a-whole formatter and it is the one this card wants. It is NOT `pct()`:
// that one stamps a "+"/"−" because it measures a CHANGE, and a return rate is not a change.
//
// ⚠️ The local one-liner this replaces — `(n * 100).toFixed(1) + "%"` — got the right IDEA and the
// wrong OUTPUT: `toFixed` emits an ASCII decimal POINT, so an id-ID panel printed "0.0%" three rows
// under `return-by-courier.tsx` printing "0,0%" for the same kind of figure. The comment above it
// said "format locally instead", which is the instruction that produced two divergent copies (this
// file and `keranjang-client.tsx`) plus one caller that gave up and borrowed `pct()`. A rule
// re-obeyed by hand at every call site is how that third one happened.
//
// `returnRate` arrives as a 0..1 fraction, `share` takes percent — hence the ×100 at each call.

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
                  {share(shipped ? (returned / shipped) * 100 : 0)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {num(returned)} dari {num(shipped)} paket terkirim
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tingkat retur COD</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {codShipped === 0 ? NO_FIGURE : share((codReturned / codShipped) * 100)}
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
                    <span className="text-muted-foreground">({share(r.returnRate * 100)})</span>
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
