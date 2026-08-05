import { ArrowDownRight, ArrowUpRight, Wallet, Undo2 } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR, num } from "@tokophi/lib/format";
import { Sparkline } from "../sparkline";
import type { MoneyTile, ReturnSummary } from "@/lib/data/dashboard";

/**
 * "Uang masuk" — penjualan hari ini / 7 hari / 30 hari, each against the same-length previous
 * period, plus the return rate. Fixed ranges: they do NOT follow the range switcher (that drives
 * the chart below), because a seller centre always shows all three at once.
 *
 * The delta is rendered with its OWN sign (−6,4% when sales FELL) — money is the one place that must
 * not be ambiguous. This tile predates `pct()` carrying its own sign and still formats locally; the
 * shared `KpiCard` reaches for `pct(delta)`, which now emits the same string.
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
  const up = tile.delta >= 0;
  // Signed, id-ID decimal comma: "+16,9%" / "−6,4%".
  const signed = `${up ? "+" : "−"}${Math.abs(tile.delta).toFixed(1).replace(".", ",")}%`;
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="size-4" /> {tile.label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
            up
              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/12 text-red-600 dark:text-red-400",
          )}
        >
          {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {signed}
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
  // >5% of shipped parcels coming back is where an Indonesian seller starts losing real money.
  const bad = rate > 5;
  const asPct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Undo2 className="size-4" /> Tingkat retur
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold",
            bad
              ? "bg-red-500/12 text-red-600 dark:text-red-400"
              : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {r.shipped === 0 ? "belum ada data" : bad ? "perlu perhatian" : "sehat"}
        </span>
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold tracking-tight tabular-nums">
          {r.shipped ? asPct(r.rate) : "—"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {r.shipped
            ? `${num(r.returned)} dari ${num(r.shipped)} paket terkirim kembali`
            : "Belum ada paket yang dikirim"}
        </div>
      </div>
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
