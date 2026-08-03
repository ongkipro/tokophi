import "server-only";
import { sql, type SQL } from "drizzle-orm";

// ---------------------------------------------------------------------------
// ONE definition of "a day", used by every day-bucketed query the Dashboard and /analitik read.
//
// WHY IT IS A SHARED MODULE AND NOT FOUR COPIES OF `to_char(...)`:
// `lib/data/dashboard.ts` matches the daily series against the channel rows, the product-sale rows,
// the funnel rows and the device rows **by string equality on the date key** (`rangeDates()` builds a
// `Set<string>` and every other reader does `cur.has(r.date)`). If two of those queries bucket in
// different time zones, the sets still LOOK right and the numbers silently stop reconciling for
// every order placed between 17:00 and 24:00 UTC — which in Jakarta is 00:00–07:00 the NEXT day.
// A mismatch here does not error; it just makes one card disagree with the one beside it.
//
// The container's `TimeZone` is UTC, so every one of these queries used to answer "hari ini" as
// 07:00 WIB → 07:00 WIB. An Indonesian merchant opening the dashboard at 09:00 WIB was shown a
// "today" that had started two hours earlier and had lost the previous evening's orders to
// "kemarin".
//
// ⚠️ WIB IS ASSUMED FOR EVERY STORE. Indonesia has three zones (WIB/WITA/WIT) and `stores` has no
// timezone column, so a Makassar (WITA) or Jayapura (WIT) merchant reads a day boundary 1–2 hours
// off their own. That is a known, stated limitation — not a number anyone invented. Fixing it means
// a `stores.timezone` column and threading it through these queries; until then this constant is
// the single place to change.
// ---------------------------------------------------------------------------

export const STORE_TZ = "Asia/Jakarta";

/**
 * `YYYY-MM-DD` — the calendar date the merchant would call this instant.
 * `timezone(zone, timestamptz)` (the function form of `AT TIME ZONE`) is used rather than the
 * operator so the zone can travel as a bound parameter instead of being spliced into the string.
 */
export const dayKey = (col: SQL): SQL => sql`to_char(timezone(${STORE_TZ}, ${col}), 'YYYY-MM-DD')`;

/** The merchant's date for an instant, as a `date` — for joining against a generated series. */
export const dayOf = (col: SQL): SQL => sql`timezone(${STORE_TZ}, ${col})::date`;

/** Hour-of-day (0–23) in the merchant's calendar — for the intraday chart. */
export const hourOf = (col: SQL): SQL => sql`extract(hour from timezone(${STORE_TZ}, ${col}))::int`;

/** Today, in the merchant's calendar. */
export const today = (): SQL => sql`timezone(${STORE_TZ}, now())::date`;

/**
 * Midnight (merchant time) `n` days ago as a **timestamptz**, so it can be compared against
 * `placed_at` / `ts` directly and still use `orders_store_placed_idx (store_id, placed_at)`.
 * Bucketing on an expression would not: the index is on the raw column.
 */
export const midnightDaysAgo = (n: number): SQL =>
  sql`timezone(${STORE_TZ}, (timezone(${STORE_TZ}, now())::date - ${n}::int)::timestamp)`;
