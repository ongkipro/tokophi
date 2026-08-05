import { dateTimeShort } from "@tokophi/lib/format";

/** A compact, fixed-WIB timestamp for dense Seller tables. */
export function DateTimeCell({ value }: { value: Date | number | string }) {
  const dateValue = new Date(value);
  const [date, time] = dateTimeShort(dateValue.getTime()).split(", ");
  return (
    <time dateTime={dateValue.toISOString()} className="flex min-w-[6.75rem] flex-col leading-5">
      <span>{date}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{time} WIB</span>
    </time>
  );
}
