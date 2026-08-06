import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";

/**
 * Data tables that survive a phone.
 *
 * A table is a desktop instrument: it trades width for the ability to compare rows down a column.
 * A phone has no width to trade. Ours degraded by hiding the trade instead of making one — the row
 * ran off the right edge inside a scroller, so `audit:responsive` (rightly) excused it while a seller
 * on a 390px screen saw "Pembeli: Thobr…" and a Total column that simply was not there. Scrolling a
 * table sideways to read one order is not a mobile pattern; it is a desktop table someone shrank.
 *
 * So below `md` the same rows render as CARDS instead, and each screen writes its own card body.
 * That is deliberate, not laziness: a good card is not derivable from a table. It has a hierarchy a
 * table does not — one thing to lead with, one number that matters, the rest as supporting detail —
 * and only the screen knows which column is which. A generic auto-converter would emit six equal
 * label/value pairs per row and be uniformly poor everywhere. This component owns the SHELL (the
 * breakpoint, the card frame, the label/value rhythm, the tap target) so the screens stay consistent;
 * the screens own the CONTENT.
 *
 *   <ResponsiveTable
 *     table={<Table>…the existing desktop table, untouched…</Table>}
 *     cards={rows.map((r) => (
 *       <DataCard key={r.id} href={`/pesanan/${r.number}`} title={r.id} meta={timeAgo(r.minutesAgo)}>
 *         <DataRow label="Pembeli">{r.buyer}</DataRow>
 *         <DataRow label="Dibayar" strong>{IDR(r.total)}</DataRow>
 *       </DataCard>
 *     ))}
 *   />
 *
 * Breakpoint is `md` (768px), not `sm`: at 640-767px — a phablet, a split view, an iPad portrait
 * sidebar — a six-column table is already unreadable even though it technically fits.
 */
export function ResponsiveTable({ table, cards }: { table: React.ReactNode; cards: React.ReactNode }) {
  return (
    <>
      <div className="hidden md:block">{table}</div>
      <div className="divide-y md:hidden">{cards}</div>
    </>
  );
}

/**
 * One row, as a card. `href` makes the WHOLE card the tap target rather than a small link inside it —
 * a thumb is ~44px wide and a 12px order number is not a button.
 */
export function DataCard({
  href,
  lead,
  title,
  meta,
  badge,
  actions,
  media,
  children,
  className,
}: {
  href?: string;
  /** Sits left of the title, OUTSIDE the link — a bulk-select checkbox belongs here, since nesting it
   *  in the anchor means every tap to select navigates instead. */
  lead?: React.ReactNode;
  /** Any node: the caller styles it, because the lead line differs per screen — a mono order number on
   *  Pesanan, a thumbnail + product name on Produk. Forcing one look here made the component fit the
   *  first screen that used it and fight the second. */
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  /** Free-form content above the label/value list — a product thumbnail strip, a chart, an avatar row.
   *  Separate from `children` because those live in a <dl>, which may only contain <dt>/<dd>. */
  media?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const head = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">{title}</div>
      {/* `meta` is the mobile card's timestamp/count slot — its own doc example is `timeAgo(…)`, i.e.
          a figure that changes on its own between renders. tabular-nums here rather than at each
          call site, because the shift belongs to the slot, not to any one caller. */}
      {meta && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>}
    </div>
  );

  return (
    <div className={cn("px-4 py-3.5", className)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        {/* `lead` and the actions stay OUTSIDE the link: a checkbox or a dropdown nested in an anchor
            swallows its own clicks and navigates instead of doing its job. */}
        {lead && <div className="shrink-0 pt-0.5">{lead}</div>}
        {href ? (
          <Link href={href} className="min-w-0 flex-1 hover:underline">
            {head}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">{head}</div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {badge}
          {actions}
          {href && !actions && <ChevronRight className="size-4 text-muted-foreground/50" />}
        </div>
      </div>
      {media && <div className="mb-2.5">{media}</div>}
      {children && <dl className="space-y-1.5">{children}</dl>}
    </div>
  );
}

/** A label/value pair. Labels are the column headers the card no longer has, so they carry the meaning
 *  the header row used to — never drop them to save a line. */
export function DataRow({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 flex-1 text-right", strong && "font-semibold tabular-nums")}>{children}</dd>
    </div>
  );
}
