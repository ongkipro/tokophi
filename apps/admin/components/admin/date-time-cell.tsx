import { dateTimeShort } from "@tokophi/lib/format";

/** A compact, fixed-WIB timestamp for dense Seller tables. */
export function DateTimeCell({ value }: { value: Date | number | string }) {
  const dateValue = new Date(value);
  const [date, time] = dateTimeShort(dateValue.getTime()).split(", ");
  return (
    // ⚠️ tabular-nums belongs on the <time>, not on the clock alone.
    // It was on the second line only, so a column of these stacked a fixed-width "14.30 WIB" under a
    // ragged "22 Jul 2026" — the two lines of the SAME cell disagreeing. Measured 1440px, all-1 vs
    // all-8: 20,72px of ink on the date, 0 on the clock. This cell is the timestamp column of the
    // Produk, Saldo and Flash Sale tables, so that 20,72px is per ROW, down every list.
    // `min-w-[6.75rem]` is a floor on the CELL; it does nothing for the glyphs inside it.
    <time dateTime={dateValue.toISOString()} className="flex min-w-[6.75rem] flex-col leading-5 tabular-nums">
      <span>{date}</span>
      <span className="text-xs text-muted-foreground">{time} WIB</span>
    </time>
  );
}
