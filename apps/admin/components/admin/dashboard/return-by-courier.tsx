import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { num, share } from "@tokophi/lib/format";
import type { ReturnSummary } from "@/lib/data/dashboard";

/**
 * Retur per kurir — which courier is sending parcels back, and (when COD is on) whether COD is the
 * reason. Denominator is orders that SHIPPED (dikirim | selesai | retur), same as getReturnsByCourier.
 *
 * ── N55: THE VERDICT MAY NOT BE CARRIED BY COLOUR ALONE (WCAG 1.4.1) ─────────────────────────────
 *
 * Each row's judgement — is this courier's return rate a problem? — was the bar's colour and nothing
 * else: `rate > 5 ? bg-destructive : bg-emerald-500/70`, beside a neutral "x,x%" that reads the same
 * either way. Nothing in the row's TEXT said which side of the line it fell on, so a red/green
 * colour-blind merchant, a screen-reader user, and anyone printing the dashboard in greyscale all
 * got the number without the finding. This is the third site of the class; the money strip's sales
 * delta and its return-rate tile were the first two, and this borrows their signal rather than
 * inventing a third — same glyphs, same words, same 5% threshold.
 *
 * ⚠️ Two states here, not the tile's three. The tile needs a "nothing to judge" arm because a store
 * with no shipped parcel still renders it; a courier row only EXISTS once that courier has shipped
 * (`getReturnsByCourier` groups over shipped orders), so `shipped === 0` cannot reach this map. A
 * neutral arm here would be dead code pretending to be a safeguard.
 *
 * ── Task 5.18: A PARCEL WITH NO COURIER IS NOT A COURIER ───────────────────────────────────────
 * `getReturnsByCourier` used to fold every shipped order with a NULL/'' courier into a row named
 * "Tidak diketahui" and rank it here beside SPX and JNE with a rate, a bar and a verdict glyph — a
 * per-courier finding about a courier that does not exist. Those orders now arrive as
 * `r.unattributed`, outside every rate, and the card says how many were left out instead.
 */
/**
 * The ONE sentence for orders left out of every per-courier rate. Shared with the Pesanan tab's
 * `ReturnSummary` so the dashboard tile and the "Pengembalian" tab never explain the same gap in two
 * different words.
 */
export const unattributedNote = (n: number) =>
  `${num(n)} pesanan tanpa data kurir tidak dihitung (pengiriman tidak dibuat lewat TokoΦ).`;

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
          <p className="py-8 text-center text-sm text-muted-foreground">
            {r.unattributed > 0 ? "Belum ada paket dengan data kurir yang dikirim." : "Belum ada paket yang dikirim."}
          </p>
        ) : (
          r.byCourier.map((c) => {
            const rate = c.returnRate * 100;
            const bad = rate > 5;
            return (
              <div key={c.courier} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-sm font-medium">{c.courier}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", bad ? "bg-destructive" : "bg-emerald-500/70")}
                    style={{ width: `${Math.min(100, Math.max(rate, c.returned ? 4 : 0))}%` }}
                  />
                </div>
                {/* The glyph carries the verdict for a sighted reader who cannot use the colour; the
                    sr-only word carries it for one who cannot see either. `aria-hidden` on the icon
                    keeps a screen reader from announcing it twice. */}
                {bad
                  ? <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />
                  : <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                {/* `share()`, not `rate.toFixed(1) + "%"`. This rendered "0.0%" — an ASCII decimal
                    POINT — on an id-ID panel where the money tile directly above it says "0,0%",
                    measured in a browser 2026-08-06. It is a part of a whole, so it is not `pct()`
                    either: that one carries a sign, and a return rate is not a change. */}
                <span className="w-11 shrink-0 text-right text-sm font-medium tabular-nums">
                  {share(rate)}
                  <span className="sr-only">{bad ? " — perlu perhatian" : " — sehat"}</span>
                </span>
                <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
                  {num(c.returned)}/{num(c.shipped)}
                </span>
              </div>
            );
          })
        )}
        {r.unattributed > 0 && (
          <p className="pt-1 text-xs text-muted-foreground tabular-nums">
            {unattributedNote(r.unattributed)}
          </p>
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
