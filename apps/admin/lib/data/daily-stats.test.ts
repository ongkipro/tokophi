import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { getSeries, getSummary, shiftMonth } from "./dashboard";
import type { DayPoint } from "@/lib/mock/store";
import type { HourPoint } from "./analytics";
import type { Tx } from "@/lib/tenant";
import type { ReconciliationMismatch } from "./reconciliation";

// The Dashboard / Analitik daily series — the numbers a merchant opens every morning.
//
// WHY THIS FILE EXISTS. The series used to read `analytics_daily`, a table whose only writer in the
// entire repository was the seed. Six of seven stores had zero rows (an empty dashboard over real
// orders) and the seventh froze on the day the seed ran, so "Penjualan hari ini Rp0 · −100,0%" sat
// directly above a list of orders placed that morning. Every claim this file makes is one that was
// FALSE in production and is invisible to `tsc`, ESLint and `next build`:
//
//   · the series is DENSE and its last row is TODAY   (a bare GROUP BY silently drops empty days,
//     and then "7 hari terakhir" means "the last 7 days that sold something")
//   · the day boundary is WIB, not the container's UTC (7 hours of every merchant's evening)
//   · the totals reconcile with `orders`, exactly     (the whole point)
//   · the 24 intraday buckets sum to the day's total  (they used to be a hard-coded weight curve)
//   · "Bulan Ini" follows the DATA, never a literal   (it was `startsWith("2026-06")`)
//
// The pure half runs everywhere. The Postgres half runs the REAL query (the same exported function
// the page calls) under `SET LOCAL ROLE tokophi_app` + the `app.store_id` GUC, i.e. through RLS,
// against a throwaway database — everything inside a transaction that is always rolled back.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run apps/admin/lib/data/daily-stats.test.ts

// ---------------------------------------------------------------------------
// Pure: the range resolver. No DB, always runs.
// ---------------------------------------------------------------------------

const series = (endDate: string, n: number, per: (i: number) => Partial<DayPoint> = () => ({})): DayPoint[] => {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, ts: Date.parse(date), sales: 0, orders: 0, visitors: 0, ...per(i) };
  });
};

describe("range anchors are read off the data, never hard-coded", () => {
  it("shiftMonth crosses year boundaries in both directions", () => {
    expect(shiftMonth("2026-08", -1)).toBe("2026-07");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-01", -2)).toBe("2025-11");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });

  it('"Bulan Ini" is the month the series ENDS in — the exact bug: it was frozen at "2026-06"', () => {
    // 15 Jan 2027, 120 days of history, Rp1.000 per day.
    const all = series("2027-01-15", 121, () => ({ sales: 1_000, orders: 1 }));
    expect(getSummary(all, "month").orders.value).toBe(15); // Jan 1..15
    expect(getSummary(all, "lastmonth").orders.value).toBe(31); // all of December
    // The frozen version returned 0 here for every date outside June/May 2026.
    expect(getSummary(all, "month").sales.value).toBe(15_000);
  });

  it("an empty series yields an empty month, not every row (`startsWith('')` matches all)", () => {
    expect(getSummary([], "month").orders.value).toBe(0);
    expect(getSummary([], "lastmonth").sales.value).toBe(0);
  });

  it('"Hari ini" is the LAST row of the series', () => {
    const all = series("2027-01-15", 5, (i) => ({ sales: i * 10, orders: i }));
    expect(getSummary(all, "today").sales.value).toBe(40);
    expect(getSummary(all, "yesterday").sales.value).toBe(30);
  });
});

describe("the intraday chart is measured, not synthesized", () => {
  const all = series("2027-01-15", 3, () => ({ sales: 900, orders: 3 }));

  it("24 buckets built from real hourly rows, and they sum to the day's own total", () => {
    const hours: HourPoint[] = [
      { date: "2027-01-15", hour: 9, sales: 400, orders: 1 },
      { date: "2027-01-15", hour: 21, sales: 500, orders: 2 },
      { date: "2027-01-14", hour: 9, sales: 900, orders: 3 },
    ];
    const { points, granularity } = getSeries(all, "today", hours);
    expect(granularity).toBe("hour");
    expect(points).toHaveLength(24);
    expect(points[9].sales).toBe(400);
    expect(points[21].sales).toBe(500);
    expect(points.reduce((a, p) => a + p.sales, 0)).toBe(getSummary(all, "today").sales.value);
    expect(points.reduce((a, p) => a + p.orders, 0)).toBe(getSummary(all, "today").orders.value);
    expect(points[9].prev).toBe(900); // yesterday's 09:00, for the dashed comparison line
  });

  it("with no hourly rows the bars are ZERO — never a curve invented from the daily total", () => {
    const { points } = getSeries(all, "today", []);
    expect(points.reduce((a, p) => a + p.sales, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Postgres: the real query, through RLS, rolled back.
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;
// `analytics.ts` pulls `@tokophi/db` transitively, which throws at import time with no DATABASE_URL.
let dailyStatsRows: (typeof import("./analytics"))["dailyStatsRows"];
let hourlyStatsRows: (typeof import("./analytics"))["hourlyStatsRows"];
let SERIES_DAYS: number;
let reconciliationMismatchRows: (db: Tx, storeId: string, limit?: number) => Promise<ReconciliationMismatch[]>;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ dailyStatsRows, hourlyStatsRows, SERIES_DAYS } = await import("./analytics"));
  // Dynamic by design: skipped DB suites must not initialize @tokophi/db without DATABASE_URL.
  ({ reconciliationMismatchRows } = await import("./reconciliation"));
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const rows = async (tx: Db, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Record<string, unknown>[];

let seq = 0;
async function mkStore(tx: Db): Promise<string> {
  const a = await rows(tx, sql`insert into accounts (name) values ('Daily Stats Acc') returning id`);
  const s = await rows(tx, sql`insert into stores (account_id, name, slug) values (${a[0].id}, 'Daily Stats Store', ${"ds-" + ++seq}) returning id`);
  return s[0].id as string;
}
/** An order placed at a WIB wall-clock instant. Since 0104 the revenue expression reads the
 *  entitlement view, whose LEGACY arm (no order_financials) is `greatest(subtotal − discount, 0)` —
 *  so the fixture seeds `subtotal_idr = total − tax`, the goods figure these tests assert. */
async function mkOrder(tx: Db, storeId: string, wib: string, total: number, opts: { tax?: number; status?: string } = {}) {
  const inserted = await rows(tx, sql`
    insert into orders (store_id, number, status, placed_at, total_idr, tax_idr, subtotal_idr)
    values (${storeId}, ${"DS-" + ++seq}, ${opts.status ?? "selesai"}::order_status,
            timezone('Asia/Jakarta', ${wib}::timestamp), ${total}, ${opts.tax ?? 0}, ${total - (opts.tax ?? 0)})
    returning id`);
  return inserted[0].id as string;
}
// The suite's `db` is a bare drizzle handle; `dailyStatsRows` takes the schema-typed `Tx` that
// `withTenant` hands out. Same object at runtime — one cast at the seam, not one per call site.
const daily = (tx: Db) => dailyStatsRows(tx as unknown as Parameters<typeof dailyStatsRows>[0]);
const hourly = (tx: Db) => hourlyStatsRows(tx as unknown as Parameters<typeof hourlyStatsRows>[0]);

/** Drop to the non-owner role with this store's GUC — precisely what `withTenant` does per request. */
const asTenant = (tx: Db, storeId: string) =>
  tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`).then(() => tx.execute(sql`set local role tokophi_app`));

/** Today / N days ago, in the merchant's calendar — asked of Postgres, so the test cannot drift. */
async function wibDate(tx: Db, minusDays = 0): Promise<string> {
  const r = await rows(tx, sql`select to_char(timezone('Asia/Jakarta', now())::date - ${minusDays}::int, 'YYYY-MM-DD') as d`);
  return r[0].d as string;
}

suite("daily series, derived from orders (real Postgres, under RLS)", () => {
  it("is DENSE and ends on TODAY even when the store sold nothing for days", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      await mkOrder(tx, storeId, `${await wibDate(tx, 10)} 10:00`, 100_000);
      await asTenant(tx, storeId);

      const days = await daily(tx);
      expect(days).toHaveLength(SERIES_DAYS + 1);
      expect(days[days.length - 1].date).toBe(await wibDate(tx, 0));
      expect(days[0].date).toBe(await wibDate(tx, SERIES_DAYS));
      // one contiguous calendar day per row — the assumption `resolve()`'s slice() rests on
      for (let i = 1; i < days.length; i++) {
        expect(days[i].ts - days[i - 1].ts).toBe(86_400_000);
      }
      expect(days[days.length - 1].sales).toBe(0); // today really is zero, and says so
      expect(days[days.length - 11].sales).toBe(100_000);
    });
  });

  it("a store with NO rows at all still gets a full series of zeros, never an empty screen", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      await asTenant(tx, storeId);
      const days = await daily(tx);
      expect(days).toHaveLength(SERIES_DAYS + 1);
      expect(days.every((d) => d.sales === 0 && d.orders === 0 && d.visitors === 0)).toBe(true);
    });
  });

  it("buckets on the merchant's WIB day, not the container's UTC day", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const today = await wibDate(tx, 0);
      // 23:30 WIB today == 16:30 UTC today — same day either way, a control.
      await mkOrder(tx, storeId, `${today} 23:30`, 11_000);
      // 06:30 WIB today == 23:30 UTC YESTERDAY. Under the old `to_char(placed_at, …)` (session TZ =
      // UTC) this landed on "kemarin" and the merchant's morning vanished from "hari ini".
      await mkOrder(tx, storeId, `${today} 06:30`, 22_000);
      await asTenant(tx, storeId);

      const days = await daily(tx);
      const last = days[days.length - 1];
      expect(last.date).toBe(today);
      expect(last.sales).toBe(33_000);
      expect(last.orders).toBe(2);
      expect(days[days.length - 2].sales).toBe(0);
    });
  });

  it("reconciles with `orders` to the rupiah: cancelled excluded, tax excluded", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const today = await wibDate(tx, 0);
      await mkOrder(tx, storeId, `${today} 08:00`, 100_000, { tax: 11_000 });
      await mkOrder(tx, storeId, `${today} 09:00`, 50_000, { status: "batal" });
      await mkOrder(tx, storeId, `${await wibDate(tx, 3)} 09:00`, 70_000);
      await asTenant(tx, storeId);

      const days = await daily(tx);
      const total = days.reduce((a, d) => a + d.sales, 0);
      const [truth] = await rows(
        tx,
        sql`select coalesce(sum(total_idr - tax_idr), 0)::bigint as s, count(*)::int as n from orders where status <> 'batal'`,
      );
      expect(total).toBe(Number(truth.s));
      expect(days.reduce((a, d) => a + d.orders, 0)).toBe(truth.n);
      expect(total).toBe(89_000 + 70_000); // and the arithmetic, written out
    });
  });

  it("RLS scopes it — another store's orders are not in this store's series", async () => {
    await inTxn(async (tx) => {
      const mine = await mkStore(tx);
      const theirs = await mkStore(tx);
      const today = await wibDate(tx, 0);
      await mkOrder(tx, mine, `${today} 08:00`, 10_000);
      await mkOrder(tx, theirs, `${today} 08:00`, 999_000);
      await asTenant(tx, mine);
      const days = await daily(tx);
      expect(days[days.length - 1].sales).toBe(10_000);
    });
  });

  it("uses immutable Seller proceeds and accepted shipping debit, while the view remains tenant-scoped", async () => {
    await inTxn(async (tx) => {
      const mine = await mkStore(tx);
      const theirs = await mkStore(tx);
      const today = await wibDate(tx, 0);
      const mineOrder = await mkOrder(tx, mine, `${today} 08:00`, 120_000);
      const theirOrder = await mkOrder(tx, theirs, `${today} 08:00`, 999_000);
      await tx.execute(sql`
        insert into order_financials
          (store_id, order_id, goods_proceeds_idr, shipping_charged_idr, order_payable_idr)
        values
          (${mine}, ${mineOrder}, 100000, 20000, 120000),
          (${theirs}, ${theirOrder}, 999000, 0, 999000)`);
      await tx.execute(sql`
        insert into shipment_bookings
          (store_id, order_id, provider_reference, courier, service_type, service_name, shipping_charged_idr,
           shipping_actual_idr, seller_debit_idr, platform_margin_idr, status, accepted_at)
        values
          (${mine}, ${mineOrder}, ${"DS-BOOK-" + ++seq}, 'spx', '1', 'SPX Standard', 20000,
           30000, 10000, 0, 'accepted', now())`);
      await asTenant(tx, mine);

      const days = await daily(tx);
      expect(days[days.length - 1].sales).toBe(90_000);
    });
  });

  it("the mismatch report is tenant-scoped and returns only inconsistent snapshots", async () => {
    await inTxn(async (tx) => {
      const mine = await mkStore(tx);
      const theirs = await mkStore(tx);
      const mineOrder = await mkOrder(tx, mine, `${await wibDate(tx)} 10:00`, 120_000);
      const theirOrder = await mkOrder(tx, theirs, `${await wibDate(tx)} 10:00`, 999_000);
      await tx.execute(sql`
        insert into order_financials
          (store_id, order_id, goods_proceeds_idr, shipping_charged_idr, order_payable_idr)
        values
          (${mine}, ${mineOrder}, 100000, 20000, 120001),
          (${theirs}, ${theirOrder}, 999000, 0, 999001)`);
      await asTenant(tx, mine);

      const report = await reconciliationMismatchRows(tx as unknown as Tx, mine);
      expect(report).toHaveLength(1);
      expect(report[0].orderPayable).toBe(120_001);
    });
  });

  it("the checkout allocation is immutable after insert", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, `${await wibDate(tx)} 11:00`, 100_000);
      await tx.execute(sql`
        insert into order_financials (store_id, order_id, goods_proceeds_idr, order_payable_idr)
        values (${storeId}, ${orderId}, 100000, 100000)`);
      await expect(
        tx.execute(sql`update order_financials set goods_proceeds_idr = 1 where order_id = ${orderId}`),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it("visitors are COUNTED from analytics_events, the same rows the Pengunjung KPI counts", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const today = await wibDate(tx, 0);
      for (const h of ["01:00", "02:00", "03:00"]) {
        await tx.execute(sql`
          insert into analytics_events (store_id, ts, type, session_id, device)
          values (${storeId}, timezone('Asia/Jakarta', ${`${today} ${h}`}::timestamp), 'visit', ${"s-" + ++seq}, 'ponsel')`);
      }
      await tx.execute(sql`
        insert into analytics_events (store_id, ts, type, session_id, device)
        values (${storeId}, timezone('Asia/Jakarta', ${`${today} 04:00`}::timestamp), 'add_to_cart', 's-x', 'ponsel')`);
      await asTenant(tx, storeId);

      const days = await daily(tx);
      expect(days[days.length - 1].visitors).toBe(3); // `add_to_cart` is not a visit
    });
  });

  it("the 24 intraday buckets sum to the day's own total, hour for hour", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const today = await wibDate(tx, 0);
      await mkOrder(tx, storeId, `${today} 06:30`, 22_000);
      await mkOrder(tx, storeId, `${today} 23:30`, 11_000);
      await asTenant(tx, storeId);

      const hours = await hourly(tx);
      const mine = hours.filter((h) => h.date === today);
      expect(mine.map((h) => h.hour).sort((a, b) => a - b)).toEqual([6, 23]);
      const days = await daily(tx);
      expect(mine.reduce((a, h) => a + h.sales, 0)).toBe(days[days.length - 1].sales);
    });
  });
});
