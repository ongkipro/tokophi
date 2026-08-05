import { ArrowDownRight, ArrowUpRight, ShieldCheck, TriangleAlert, Wallet, Undo2 } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR, NO_FIGURE, num, pct } from "@tokophi/lib/format";
import { Sparkline } from "../sparkline";
import type { MoneyTile, ReturnSummary } from "@/lib/data/dashboard";

/**
 * "Uang masuk" — penjualan hari ini / 7 hari / 30 hari, each against the same-length previous
 * period, plus the return rate. Fixed ranges: they do NOT follow the range switcher (that drives
 * the chart below), because a seller centre always shows all three at once.
 *
 * The delta is rendered with its OWN sign (−6,4% when sales FELL) — money is the one place that must
 * not be ambiguous. The tile used to format that locally, one `toFixed(1).replace(".", ",")` away
 * from the shared `pct()` it was already identical to; it reaches for `pct()` now, because the
 * hand-rolled copy also hard-coded a "+" and so was the site that printed "+0,0%" on a store with no
 * history at all (`pct(0)` is "0,0%", unsigned — the two copies had already drifted).
 *
 * ⚠️ NO GOOD/BAD VERDICT MAY BE CARRIED BY COLOUR ALONE (WCAG 1.4.1) — and there are two here: the
 * sales delta (rose/fell) and the return rate (healthy/needs attention). Wherever the colour makes a
 * judgement the badge also carries a GLYPH and, for a screen reader, a WORD (↗/↘ + "naik"/"turun";
 * ⚠/🛡 + "perlu perhatian"/"sehat"). And each has a THIRD, NEUTRAL state for "we have nothing to
 * judge" — no previous period for a sales tile, no shipped parcel for the return rate — where the
 * glyph is dropped rather than replaced: an arrow says WHICH WAY and there is no way. An emerald pill
 * over "belum ada data" was a verdict nobody measured; it read "healthy" on a store that had never
 * posted a parcel.
 */
export function MoneyStrip({ tiles, returns }: { tiles: MoneyTile[]; returns: ReturnSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => <SalesTile key={t.key} tile={t} />)}
      <ReturnRateTile returns={returns} />
    </div>
  );
}

function SalesTile({ tile }: { tile: MoneyTile }) {
  // `null` = no previous period to divide by. NOT `>= 0`: `null >= 0` is true in JS, so the store
  // with no history would keep the emerald ↗ it never earned, now over an em dash.
  const up = tile.delta === null ? null : tile.delta >= 0;
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="size-4" /> {tile.label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
            up === null
              ? "bg-muted text-muted-foreground"
              : up
                ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/12 text-red-600 dark:text-red-400",
          )}
        >
          {/* The arrow says WHICH WAY; a neutral pill claims no direction, so there is none to draw. */}
          {up === null ? null : up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {pct(tile.delta)}
          {/* The glyph carries the verdict for a sighted reader; this carries it for everyone else.
              "—" is announced as nothing at all by most screen readers, and a colour to no one. */}
          <span className="sr-only">{up === null ? " tidak ada pembanding" : up ? " naik" : " turun"}</span>
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tracking-tight tabular-nums">{IDR(tile.value, { compact: true })}</div>
          <div className="mt-1 text-xs text-muted-foreground">vs {tile.compareLabel}</div>
        </div>
        <Sparkline data={tile.spark} up={up} />
      </div>
    </Card>
  );
}

function ReturnRateTile({ returns: r }: { returns: ReturnSummary }) {
  const rate = r.rate * 100;
  // Three states, not two. `shipped === 0` is NOT "healthy": nothing has been posted, so nothing has
  // been judged. It used to fall through to the `bad === false` arm and wear the same emerald pill a
  // genuinely clean 0,4% return rate wears — a verdict rendered over an empty denominator, which is
  // the "a figure with no source is —, never a number" rule wearing a colour instead of a digit.
  // >5% of shipped parcels coming back is where an Indonesian seller starts losing real money.
  const verdict = r.shipped === 0 ? "none" : rate > 5 ? "bad" : "good";
  const bad = verdict === "bad";
  const asPct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Undo2 className="size-4" /> Tingkat retur
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
            verdict === "none"
              ? "bg-muted text-muted-foreground"
              : bad
                ? "bg-red-500/12 text-red-600 dark:text-red-400"
                : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {verdict === "none" ? null : bad ? <TriangleAlert className="size-3" /> : <ShieldCheck className="size-3" />}
          {verdict === "none" ? "belum ada data" : bad ? "perlu perhatian" : "sehat"}
        </span>
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold tracking-tight tabular-nums">
          {r.shipped ? asPct(r.rate) : NO_FIGURE}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {r.shipped
            ? `${num(r.returned)} dari ${num(r.shipped)} paket terkirim kembali`
            : "Belum ada paket yang dikirim"}
        </div>
      </div>
      {/* The bar restates the figure above it; the badge and the "x,x%" carry the verdict in text, so
          its colour is never the only signal. With nothing shipped, `rate` is 0 and it draws nothing. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", bad ? "bg-destructive" : "bg-emerald-500")}
          style={{ width: `${Math.min(100, rate)}%` }}
        />
      </div>
      {r.codShipped > 0 && (
        <p className="mt-3 text-xs text-muted-foreground tabular-nums">
          COD {asPct(r.codRate)} · non-COD {asPct(r.nonCodRate)}
        </p>
      )}
    </Card>
  );
}
