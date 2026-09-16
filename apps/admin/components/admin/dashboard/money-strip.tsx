import { ShieldCheck, TriangleAlert, Wallet, Undo2 } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR, NO_FIGURE, num, share } from "@tokophi/lib/format";
import { Sparkline } from "../sparkline";
import { DeltaBadge, KpiTile, deltaUp, pillClass } from "./kpi-tile";
import type { MoneyTile, ReturnSummary } from "@/lib/data/dashboard";

/**
 * "Uang masuk" — penjualan hari ini / 7 hari / 30 hari, each against the same-length previous
 * period, plus the return rate. Fixed ranges: they do NOT follow the range switcher (that drives
 * the chart below), because a seller centre always shows all three at once.
 *
 * The shell, the spacing scale and the delta pill are `kpi-tile.tsx`, shared with /analitik's
 * `KpiCard` — the two used to hold separate copies of all three. Everything below is what is
 * genuinely specific to these five tiles.
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
  return (
    <KpiTile
      icon={Wallet}
      label={tile.label}
      badge={<DeltaBadge delta={tile.delta} />}
      value={IDR(tile.value, { compact: true })}
      // No previous period means there is no "vs" to name. Saying one anyway puts the claim the em
      // dash just refused back on the line underneath the figure — see `kpi-card.tsx`.
      caption={`${tile.delta === null ? "belum ada pembanding" : `vs ${tile.compareLabel}`} · ${tile.note}`}
      aside={<Sparkline data={tile.spark} up={deltaUp(tile.delta)} />}
    />
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
  // `share()`, not `pct()`: this is a part of a whole, and `pct()` would stamp a "+" on it. Retiring
  // the local `toFixed(1).replace(".", ",")` copy at the same time — that hand-rolled one-liner is
  // exactly what `share()` was added to stop being re-written per call site.
  return (
    <KpiTile
      icon={Undo2}
      label="Tingkat retur"
      badge={
        <span className={pillClass(verdict === "none" ? "neutral" : bad ? "bad" : "good")}>
          {verdict === "none" ? null : bad ? <TriangleAlert aria-hidden className="size-3" /> : <ShieldCheck aria-hidden className="size-3" />}
          {verdict === "none" ? "belum ada data" : bad ? "perlu perhatian" : "sehat"}
        </span>
      }
      value={r.shipped ? share(rate) : NO_FIGURE}
      caption={
        // tabular-nums: both counts move every time a parcel ships or comes back, and without it the
        // sentence re-flowed by 11,5px under the figure it belongs to (measured 1440px, 2026-08-06).
        <span className="tabular-nums">
          {r.shipped
            ? `${num(r.returned)} dari ${num(r.shipped)} paket terkirim kembali`
            : "Belum ada paket yang dikirim"}
        </span>
      }
    >
      {/* The bar restates the figure above it, so it sits 8px from that figure's caption rather than
          the 12px that separates GROUPS — at 12px it read as a third block instead of the same fact
          drawn twice. The badge and the "x,x%" carry the verdict in text, so its colour is never the
          only signal. With nothing shipped, `rate` is 0 and it draws nothing. */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", bad ? "bg-destructive" : "bg-emerald-500")}
          style={{ width: `${Math.min(100, rate)}%` }}
        />
      </div>
      {r.codShipped > 0 && (
        <p className="mt-3 text-xs text-muted-foreground/75 tabular-nums">
          COD {share(r.codRate * 100)} · non-COD {share(r.nonCodRate * 100)}
        </p>
      )}
    </KpiTile>
  );
}
