// Seed RECENT orders — a targeted top-up that fills the gap between the main seed's fixed anchor and
// today, for ONE store (batiknusantara).
//
// WHY THIS EXISTS
// `seed.ts` anchors every date to `TODAY = 2026-06-30`. Wall-clock time does not stop, so the demo
// rots a day per day: by 2026-07-17 the last order was 15 days old, `/keuangan/penghasilan?hari=7`
// was legitimately EMPTY, the 30-day chart drew a cliff to zero, and "-42% vs 30 hari sebelumnya"
// was measuring the seed running out rather than a business trend. The pages were honest; the data
// was stale.
//
// The blunt fix is `SEED_FORCE=1 npm run seed`. Do NOT reach for it: it TRUNCATES the whole database
// and hands out new store_ids, so every other agent mid-verification silently loses their data and
// their logged-in session. This script is the targeted alternative — it only ever INSERTS, it never
// truncates, and it touches exactly one store.
//
//   npm run seed:recent -w @tokophi/db
//
// IDEMPOTENT BY CONSTRUCTION: it fills only days that currently have ZERO orders for this store.
// Run it twice and the second run inserts nothing. Run it next week and it fills just the new gap.
//
// HONESTY RULES BAKED IN
// - Destinations, couriers and service types are SAMPLED FROM REAL ROWS already in `orders`, never
//   invented — a made-up ship_district_id would not resolve in `kiriminaja_areas` and the order could
//   never actually be booked. Dummy data that cannot travel the real code path is a trap, not a demo.
// - `shipping_idr` is populated. The main seed writes `subtotal = total` and leaves shipping at 0,
//   which is why "Ongkir dibayar pembeli" reads Rp 0 across 96 orders. These rows carry a real ongkir
//   so the number means something.
// - The ledger is DERIVED from `payments`, using the same SQL shape as seed.ts. It is never written
//   beside the orders: two sources for one balance is two versions of the truth about money.
// - Deterministic (mulberry32, never Math.random) so the same gap always produces the same orders.
import { pathToFileURL } from "node:url";
import { db, client } from "./client";
import { sql, type SQL } from "drizzle-orm";

const SLUG = "batiknusantara";

// ─────────────────────────────────────────────────────────────────────────────
// stores.current_period_end — the ONE column whose rot blocks WRITES, not charts (Task 8.13).
//
// The main seed writes it `fromNow(20)` (relative to the real clock, not the TODAY anchor), so a
// fresh seed is fine — but a database seeded 20 days ago holds a period end that has passed, and
// `computeBilling()` (`@tokophi/lib/billing`) then returns `readOnly` once the 3-day grace is over.
// Every admin write goes through that gate and throws `SuspendedError`, surfacing as "Gagal
// menyimpan produk" on a store nobody suspended. Two browser agents lost an afternoon to it on
// 2026-09-08 and both had to hand-edit `stores` to drive any write path at all.
//
// This is the ONE UPDATE in this script that touches a row it did not insert. Contract: only a
// period end that has ALREADY LAPSED is moved (`< now()`), only for the anchor store, to
// `now() + 30 days` — the same window the promo vouchers above get. A future period end is left
// exactly as it is, a NULL one (trial) is left NULL (trial stays trial — the dates are the
// schedule, `nonaktif`-style), and an operator suspension (`suspended_at`) is a separate fact this
// does not touch (AGENTS.md → "AN OPERATOR SUSPENSION IS A SEPARATE FACT FROM BILLING"). Idempotent
// by the WHERE: the second run matches zero rows.
//
// Exported, and takes its executor as a parameter, so `seed-recent-billing.test.ts` can run the
// real statement inside a rolled-back transaction against the throwaway `_test` database.
// ─────────────────────────────────────────────────────────────────────────────
export const RECENT_PERIOD_DAYS = 30;
type Exec = { execute(q: SQL): Promise<unknown> };

/** Pushes a LAPSED `current_period_end` to now()+30d. Returns the new end (WIB date) or null if untouched. */
export async function seedBillingPeriod(exec: Exec, storeId: string): Promise<string | null> {
  const rows = (await exec.execute(sql`
    update stores
       set current_period_end = now() + (${RECENT_PERIOD_DAYS} || ' days')::interval
     where id = ${storeId} and current_period_end < now()
     returning to_char(current_period_end at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as until
  `)) as Row[];
  return rows.length ? String(rows[0].until) : null;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = Record<string, string | number | null>;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Row[];

// Populate the /promo hub for the demo store: a LIVE flash sale, the hub banner copy, the thematic
// voucher codes refreshed to a live window, and automatic free ongkir. Every step is idempotent.
async function seedPromo(storeId: string) {
  // 1) Flash sale — only create one if none is active right now (re-running never stacks sales).
  const [live] = await q(sql`
    select id from flash_sales
    where store_id = ${storeId} and status <> 'nonaktif' and now() >= starts_at and now() < ends_at
    limit 1`);
  if (!live) {
    const [fs] = await q(sql`
      insert into flash_sales (store_id, name, starts_at, ends_at, status)
      values (${storeId}, 'Promo Gajian', now() - interval '1 day', now() + interval '14 days', 'aktif')
      returning id`);
    const fsId = String(fs.id);
    // Top 5 by price, 30% off rounded to the nearest 1rb — a real, believable markdown.
    const picks = await q(sql`
      select p.id, v.price_idr as price
      from products p
      join product_variants v on v.product_id = p.id and v.position = 0
      where p.store_id = ${storeId} and p.status = 'active'
      order by v.price_idr desc
      limit 5`);
    for (const p of picks) {
      const sale = Math.round((Number(p.price) * 0.7) / 1000) * 1000;
      await q(sql`
        insert into flash_sale_items (flash_sale_id, product_id, sale_price_idr)
        values (${fsId}, ${String(p.id)}, ${sale})
        on conflict do nothing`);
    }
    console.log(`✓ Flash sale "Promo Gajian" dibuat (${picks.length} produk, aktif 14 hari).`);
  } else {
    console.log("✓ Flash sale aktif sudah ada — dilewati.");
  }

  // 2) Hub banner copy — fill only if the merchant has not set it (empty/NULL).
  await q(sql`
    update store_settings set
      promo_hub_title = coalesce(nullif(promo_hub_title, ''), 'Promo Gajian'),
      promo_hub_subtitle = coalesce(nullif(promo_hub_subtitle, ''), 'Flash sale, kode voucher, & gratis ongkir — semuanya di sini.')
    where store_id = ${storeId}`);

  // 3) Thematic voucher codes → a live window, so they actually show on the hub / work at checkout.
  await q(sql`
    update discounts set ends_at = now() + interval '30 days', status = 'aktif'
    where store_id = ${storeId} and code in ('GAJIAN25', 'ONGKIRGRATIS') and (ends_at is null or ends_at < now())`);

  // 4) Automatic free ongkir for the demo — only flip the untouched default (off / 0), never a merchant's choice.
  await q(sql`
    update store_settings set free_ship_enabled = true, free_ship_min_idr = 300000
    where store_id = ${storeId} and free_ship_enabled = false and free_ship_min_idr = 0`);

  console.log("✓ Halaman promo (/promo) siap: banner, voucher, gratis ongkir.");
}

async function seedOrders(storeId: string, storeName: string) {
  // Gap = every calendar day (Asia/Jakarta) in the last 30 that has no order at all for this store.
  // Bounded to 30 days on purpose: this tops the demo up, it does not rewrite history.
  const gap = await q(sql`
    with span as (
      select generate_series(
        (now() at time zone 'Asia/Jakarta')::date - interval '29 days',
        (now() at time zone 'Asia/Jakarta')::date,
        '1 day'
      )::date as day
    )
    select to_char(s.day, 'YYYY-MM-DD') as day
    from span s
    where not exists (
      select 1 from orders o
      where o.store_id = ${storeId}
        and (o.placed_at at time zone 'Asia/Jakarta')::date = s.day
    )
    order by s.day
  `);
  if (!gap.length) {
    console.log("✓ Tidak ada hari kosong dalam 30 hari terakhir — tidak ada yang perlu ditambahkan.");
    return;
  }

  const customers = await q(sql`select id, name, phone from customers where store_id = ${storeId}`);
  const variants = await q(sql`
    select v.id, p.title as title, v.price_idr as price
    from product_variants v
    join products p on p.id = v.product_id
    where p.store_id = ${storeId} and p.archived_at is null
  `);
  // Real destinations + real courier/service pairs, lifted from orders that already exist.
  //
  // ⚠️ **No `ship_kelurahan_name` here, and do not put it back without a migration.** It used to be
  // selected AND inserted, and the column exists in no `.sql` and in no `schema.ts` entry on this
  // branch: it arrived from `0049_shipping_kelurahan`, which lost its slot to a second `0049`
  // (`0049_watery_supernaut`) and was never re-numbered. It survives on the shared dev container
  // only because that database had the losing migration applied before the collision — so this
  // script was green on dev and **could not run against production at all**, which has 86 applied
  // migrations, 77 tables and no such column (verified 2026-08-03). Nothing in `apps/` ever read it.
  const dests = await q(sql`
    select distinct on (ship_district_id, courier)
           ship_recipient, ship_phone, ship_address, ship_district_id,
           ship_postcode, city, province, courier, service_type
    from orders
    where store_id = ${storeId} and ship_district_id is not null and courier is not null
      and service_type is not null
    limit 40
  `);
  if (!customers.length || !variants.length || !dests.length)
    throw new Error("Store has no customers / variants / shippable orders to sample from.");

  // Continue the SEED's own short numbering (PHI-5201, 5202, …) and ignore real checkout orders.
  //
  // ⚠️ This filter is load-bearing. A real order is `PHI-<9-digit timestamp><3 base36>` — e.g.
  // PHI-202951778F2Y — so stripping non-digits yields 2_029_517_782, which is (barely) inside int4
  // and would make the next seeded order PHI-2029517783. A slightly longer number overflows and the
  // script dies with "integer out of range". Neither is wanted: seeded rows should look seeded.
  // `orders.number` is UNIQUE **globally** (orders_number_unique), not per store, so a collision here
  // is an insert error, not silent corruption — but the range must still not be shared with the live
  // generator's.
  const [maxRow] = await q(sql`
    select coalesce(max(substring(number from 5)::int), 5200) as n
    from orders
    where store_id = ${storeId} and number ~ '^PHI-[0-9]{1,6}$'
  `);
  let next = Number(maxRow.n) + 1;

  const rnd = mulberry32(0x70b1); // fixed seed → same gap, same orders, every run
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  let made = 0;

  for (const g of gap) {
    const day = String(g.day);
    const ageDays = Math.round((Date.now() - Date.parse(`${day}T12:00:00+07:00`)) / 86_400_000);
    const perDay = 3 + Math.floor(rnd() * 7); // 3–9/day — the density the seed itself produces

    for (let i = 0; i < perDay; i++) {
      const cust = pick(customers);
      const dest = pick(dests);
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(variants));
      const subtotal = lines.reduce((a, v) => a + Number(v.price), 0);
      // A real ongkir band for JVA-scale domestic parcels. The main seed leaves this 0.
      const shipping = 9_000 + Math.floor(rnd() * 27_000);

      // Money is only "available" once the order is `selesai`. Fresh days stay in flight so the
      // pending balance, the "perlu dikirim" badge and the shipping queue all have something real to
      // show — the demo should exercise the states, not just the happy ending.
      const roll = rnd();
      const status =
        ageDays <= 2 ? (roll < 0.5 ? "baru" : "diproses")
        : ageDays <= 5 ? (roll < 0.35 ? "diproses" : roll < 0.8 ? "dikirim" : "selesai")
        : roll < 0.06 ? "batal"
        : roll < 0.12 ? "dikirim"
        : "selesai";
      const paid = status !== "batal";

      // Spread across the working day in WIB, not at midnight — the hour buckets on other screens
      // would otherwise show one absurd spike.
      const at = sql`(${`${day} 09:00:00`}::timestamp at time zone 'Asia/Jakarta') + (${Math.floor(rnd() * 660)} || ' minutes')::interval`;
      const number = `PHI-${next++}`;

      const [ord] = await q(sql`
        insert into orders (store_id, number, customer_id, status, financial_status, channel,
                            subtotal_idr, discount_idr, shipping_idr, tax_idr, total_idr,
                            city, province, placed_at, courier, service_type,
                            ship_recipient, ship_phone, ship_address, ship_district_id,
                            ship_postcode)
        values (${storeId}, ${number}, ${cust.id}, ${status}::order_status,
                ${paid ? "dibayar" : "pending"}::financial_status,
                ${pick(["organic", "meta_ads", "tiktok_ads", "google_ads", "other"])}::order_channel,
                ${subtotal}, 0, ${shipping}, 0, ${subtotal + shipping},
                ${dest.city}, ${dest.province}, ${at}, ${dest.courier}, ${dest.service_type},
                ${cust.name}, ${cust.phone}, ${dest.ship_address}, ${dest.ship_district_id},
                ${dest.ship_postcode})
        returning id
      `);
      const orderId = String(ord.id);

      for (const v of lines) {
        await db.execute(sql`
          insert into order_line_items (order_id, variant_id, title, qty, price_idr, total_idr)
          values (${orderId}, ${v.id}, ${v.title}, 1, ${Number(v.price)}, ${Number(v.price)})
        `);
      }
      await db.execute(sql`
        insert into payments (order_id, store_id, method, amount_idr, status, paid_at)
        values (${orderId}, ${storeId}, ${pick(["transfer", "qris", "va", "gopay", "cod"])}::payment_method,
                ${subtotal + shipping}, ${paid ? "berhasil" : "gagal"}::payment_status,
                ${paid ? at : null})
      `);
      made++;
    }
  }

  // Ledger — DERIVED from the payments just written, exactly as seed.ts derives it. Only for orders
  // that have no entry yet, so a re-run cannot double-credit anyone's balance.
  await db.execute(sql`
    insert into ledger_entries (store_id, order_id, payment_id, kind, status, amount_idr, note, created_at, available_at)
    select o.store_id, o.id, p.id, 'sale'::ledger_kind,
           case when o.status in ('selesai','retur') then 'available' else 'pending' end::ledger_status,
           p.amount_idr, 'Penjualan ' || o.number, coalesce(p.paid_at, o.placed_at),
           case when o.status in ('selesai','retur') then coalesce(p.paid_at, o.placed_at) end
      from payments p
      join orders o on o.id = p.order_id
     where o.store_id = ${storeId} and p.status = 'berhasil'
       and not exists (select 1 from ledger_entries l where l.order_id = o.id and l.kind = 'sale')
  `);

  // customers.last_order_at is DERIVED, never typed in beside the orders (0044).
  await db.execute(sql`
    update customers c set last_order_at = o.last_at
      from (select customer_id, max(placed_at) as last_at from orders
             where store_id = ${storeId} and customer_id is not null group by customer_id) o
     where o.customer_id = c.id
  `);

  // A withdrawal and a return, so "Sudah ditarik" / "Ditarik kembali" stop reading Rp 0. Both are
  // NEGATIVE available entries — that is how getBalance() derives them (`-sum(...) filter kind=...`),
  // and a payout that did not reduce the balance would be a payout that never happened.
  const [hasPayout] = await q(sql`select count(*)::int as n from payouts where store_id = ${storeId}`);
  if (Number(hasPayout.n) === 0) {
    for (const [amount, daysAgo] of [[15_000_000, 12], [8_500_000, 4]] as const) {
      const [po] = await q(sql`
        insert into payouts (store_id, amount_idr, status, bank_name, bank_account, bank_holder, requested_at, paid_at)
        values (${storeId}, ${amount}, 'selesai'::payout_status, 'BCA', '1234567890', 'Ongki Pratama',
                now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo - 1} || ' days')::interval)
        returning id
      `);
      await db.execute(sql`
        insert into ledger_entries (store_id, payout_id, kind, status, amount_idr, note, created_at, available_at)
        values (${storeId}, ${String(po.id)}, 'payout'::ledger_kind, 'available'::ledger_status,
                ${-amount}, 'Penarikan ke BCA ••••7890', now() - (${daysAgo} || ' days')::interval,
                now() - (${daysAgo} || ' days')::interval)
      `);
    }
    // One returned parcel, charged back against a real order that actually came back.
    await db.execute(sql`
      insert into ledger_entries (store_id, order_id, kind, status, amount_idr, note, created_at, available_at)
      select o.store_id, o.id, 'retur'::ledger_kind, 'available'::ledger_status,
             -o.total_idr, 'Retur ' || o.number, now() - interval '6 days', now() - interval '6 days'
        from orders o
       where o.store_id = ${storeId} and o.status = 'selesai' and o.total_idr > 0
         and not exists (select 1 from ledger_entries l where l.order_id = o.id and l.kind = 'retur')
       order by o.placed_at desc limit 2
    `);
  }

  console.log(`✓ ${made} pesanan ditambahkan untuk ${storeName} — mengisi ${gap.length} hari kosong (${gap[0].day} → ${gap[gap.length - 1].day}).`);
}

// ─────────────────────────────────────────────────────────────────────────────
// checkout_sessions — the carts that never became orders.
//
// WHY THIS IS HERE. Un-anchoring `apps/admin/lib/data/checkout.ts` from the seed's frozen date was
// correct (the old "30 hari" window was a frozen start with no upper bound, 60 days wide by 1
// Agustus), but it exposed a DATA gap: the main seed's newest `ditinggal` row is 2026-07-15 and this
// script refreshed orders, flash sales and the ledger while inserting no `checkout_sessions` at all.
// Keranjang Ditinggal fell from 796/340 to 6/143. The fix is seeding — never re-anchoring the app so
// the demo looks busy.
//
// The volume is DERIVED from the orders, per day, exactly as seed.ts derives it:
//     abandoned(day) = 4 × orders(day)    →  4 / (4 + 1) = 80% abandonment (Indonesia runs ~82–83%)
// and the RESCUED ones are pulled out of that pool at 14%, giving a recovery rate of
//     0.56 / (4 + 0.56) ≈ 12,3%  — the honest band for WhatsApp cart recovery, not a vendor's 35%.
//
// ⚠️ THE METRIC TRAP (0045). A straight-through checkout ALSO ends `pulih`, so `pulih / (pulih +
// ditinggal)` counts every ordinary sale as a rescue. `abandoned_at` is the only thing that tells
// them apart, and both kinds are generated here so the difference stays visible in the data:
//   rescued  = abandoned_at IS NOT NULL and recovered_at IS NOT NULL   (went quiet, then came back)
//   straight = abandoned_at IS NULL     and recovered_at IS NOT NULL   (an ordinary sale)
// `aktif` rows are NOT generated: they are excluded from both sides of every rate anyway, the sweep
// would flip them to `ditinggal` within the hour, and inventing a live shopper who is not there is
// the one thing this table must never do.
//
// IDEMPOTENT the same way the orders are: it fills only days (WIB) that currently have ZERO sessions
// for this store. A second run inserts nothing. INSERT-only — nothing here updates or deletes a row.
// ─────────────────────────────────────────────────────────────────────────────
type CkStep = "keranjang" | "kontak" | "alamat" | "pengiriman" | "pembayaran";
const STEP_MIX: Array<[CkStep, number]> = [
  ["keranjang", 0.46], ["kontak", 0.2], ["alamat", 0.15], ["pengiriman", 0.11], ["pembayaran", 0.08],
];
const STEP_RANK: Record<CkStep, number> = { keranjang: 0, kontak: 1, alamat: 2, pengiriman: 3, pembayaran: 4 };

async function seedCheckoutSessions(storeId: string) {
  const gap = await q(sql`
    with span as (
      select generate_series(
        (now() at time zone 'Asia/Jakarta')::date - interval '29 days',
        (now() at time zone 'Asia/Jakarta')::date,
        '1 day'
      )::date as day
    )
    select to_char(s.day, 'YYYY-MM-DD') as day
      from span s
     where not exists (
       select 1 from checkout_sessions c
        where c.store_id = ${storeId}
          and (c.created_at at time zone 'Asia/Jakarta')::date = s.day
     )
     order by s.day
  `);
  if (!gap.length) {
    console.log("✓ Keranjang: tidak ada hari kosong dalam 30 hari terakhir — tidak ada yang perlu ditambahkan.");
    return;
  }

  // The orders those carts are scaled against, and the ones the `pulih` rows point AT — a recovered
  // session that names no real order is a recovery nobody can open.
  const orders = await q(sql`
    select id, total_idr as total, customer_id,
           to_char((placed_at at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD') as day,
           to_json(placed_at) #>> '{}' as at
      from orders
     where store_id = ${storeId} and placed_at >= now() - interval '30 days'
     order by placed_at
  `);
  const byDay = new Map<string, Row[]>();
  for (const o of orders) (byDay.get(String(o.day)) ?? byDay.set(String(o.day), []).get(String(o.day))!).push(o);

  const customers = await q(sql`select id, name, phone, email, city from customers where store_id = ${storeId}`);
  // Real destinations, lifted from orders that already exist — a made-up district id would not resolve
  // in `kiriminaja_areas`, so the cart could never be quoted, let alone recovered.
  const dests = await q(sql`
    select distinct on (ship_district_id)
           ship_address as address, ship_district_id as district_id, ship_postcode as postcode, city, province
      from orders
     where store_id = ${storeId} and ship_district_id is not null
     limit 40
  `);
  const catalog = await q(sql`
    select p.handle, p.title, v.title as variant, v.price_idr as price
      from product_variants v
      join products p on p.id = v.product_id
     where p.store_id = ${storeId} and p.archived_at is null and p.status = 'active' and v.position = 0
  `);
  if (!customers.length || !catalog.length || !dests.length)
    throw new Error("Store has no customers / products / shippable orders to sample carts from.");

  const rnd = mulberry32(0x7373); // fixed seed → same gap, same carts, every run
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const rollStep = (): CkStep => {
    let r = rnd();
    for (const [s, w] of STEP_MIX) if ((r -= w) <= 0) return s;
    return "keranjang";
  };
  const cart = () => {
    const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
      const p = pick(catalog);
      return { handle: String(p.handle), name: String(p.title), variant: String(p.variant), qty: rnd() < 0.18 ? 2 : 1, price: Number(p.price) };
    });
    return { items, subtotal: items.reduce((a, i) => a + i.price * i.qty, 0) };
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  type Ck = {
    sid: string; customerId: string | null; name: string | null; phone: string | null; email: string | null;
    address: string | null; city: string | null; province: string | null; postcode: string | null; districtId: number | null;
    items: unknown; subtotal: number; shipping: number; step: CkStep; status: "ditinggal" | "pulih";
    abandonedAt: string | null; recoveredOrderId: string | null; recoveredAt: string | null;
    createdAt: string; updatedAt: string;
  };
  const rows: Ck[] = [];
  let seq = 0;
  let skipped = 0;

  for (const g of gap) {
    const day = String(g.day);
    const dayOrders = byDay.get(day) ?? [];
    // No orders that day means nothing to scale the carts against. After the order top-up above this
    // does not happen; if it ever does, inventing a volume out of nothing is worse than a thin day.
    if (!dayOrders.length) { skipped++; continue; }

    const nAbandoned = dayOrders.length * 4;
    const nRescued = Math.min(Math.round(nAbandoned * 0.14), dayOrders.length);
    const dayStart = Date.parse(`${day}T08:00:00+07:00`);

    // ---- ditinggal: never became anything ----
    for (let k = 0; k < nAbandoned; k++) {
      const step = rollStep();
      const rank = STEP_RANK[step];
      const anon = rank === 0; // never reached the contact form → we have nothing but a session id
      // A quarter of the identified carts belong to someone who has bought here before, so the admin
      // can open the whole customer rather than a bare phone number.
      const known = !anon && rnd() < 0.25 ? pick(customers) : null;
      const dest = pick(dests);
      const { items, subtotal } = cart();
      // Stamped inside the working day (WIB), and never in the future: the newest day is TODAY, and a
      // cart abandoned at 20:00 tonight would render as "-4 jam lalu" and clamp to "baru saja".
      // 95 minutes of headroom is the +27 min last touch plus the 60 min the sweep waits.
      const created = Math.min(dayStart + Math.floor(rnd() * 780) * 60_000, Date.now() - (95 + Math.floor(rnd() * 240)) * 60_000);
      const updated = created + (2 + Math.floor(rnd() * 25)) * 60_000;
      rows.push({
        sid: `ckr-${day}-${seq++}`,
        customerId: known ? String(known.id) : null,
        name: anon ? null : known ? String(known.name) : pick(customers).name as string,
        // Canonical 62… on write, from every path (the checkout API normalises, so the seed must too).
        phone: anon ? null : known?.phone ? String(known.phone) : `62812${String(1_000_000 + Math.floor(rnd() * 8_999_999))}`,
        email: anon || rnd() < 0.45 ? null : (known?.email as string) ?? null,
        address: rank >= 2 ? String(dest.address) : null,
        city: rank >= 2 ? String(dest.city) : null,
        province: rank >= 2 ? String(dest.province) : null,
        postcode: rank >= 2 ? (dest.postcode == null ? null : String(dest.postcode)) : null,
        districtId: rank >= 2 ? Number(dest.district_id) : null,
        items, subtotal,
        shipping: rank >= 3 ? 20_000 : 0,
        step,
        status: "ditinggal",
        // The sweep flips a session once it has been quiet for 60 minutes, and stamps the moment it
        // WENT quiet — not "now". Same arithmetic here.
        abandonedAt: iso(updated + 60 * 60_000),
        recoveredOrderId: null,
        recoveredAt: null,
        createdAt: iso(created),
        updatedAt: iso(updated),
      });
    }

    // ---- pulih: the sessions that BECAME one of this day's orders ----
    //   k <  nRescued → went quiet, was chased, came back  → a real RESCUE (abandoned_at set)
    //   k >= nRescued → walked straight through to payment → an ordinary sale (abandoned_at NULL)
    for (let k = 0; k < dayOrders.length; k++) {
      const o = dayOrders[k];
      const placed = Date.parse(String(o.at));
      const rescued = k < nRescued;
      const cust = o.customer_id ? customers.find((c) => c.id === o.customer_id) : null;
      const { items } = cart();
      // A rescue started a day or two before it finally paid; a straight-through checkout takes minutes.
      const created = placed - (rescued ? 1440 + Math.floor(rnd() * 2880) : 6 + Math.floor(rnd() * 20)) * 60_000;
      rows.push({
        sid: `ckr-${rescued ? "pulih" : "lurus"}-${day}-${seq++}`,
        customerId: cust ? String(cust.id) : null,
        name: cust ? String(cust.name) : null,
        phone: cust?.phone ? String(cust.phone) : null,
        email: (cust?.email as string) ?? null,
        address: null,
        city: cust?.city ? String(cust.city) : null,
        province: null,
        postcode: null,
        districtId: null,
        items,
        subtotal: Number(o.total),
        shipping: 20_000,
        step: "pembayaran",
        status: "pulih",
        abandonedAt: rescued ? iso(created + 90 * 60_000) : null,
        recoveredOrderId: String(o.id),
        recoveredAt: iso(placed),
        createdAt: iso(created),
        updatedAt: iso(placed),
      });
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map(
      (r) => sql`(${storeId}, ${r.sid}, ${r.customerId}, ${r.name}, ${r.phone}, ${r.email}, ${r.address},
                  ${r.city}, ${r.province}, ${r.postcode}, ${r.districtId}, ${JSON.stringify(r.items)}::jsonb,
                  ${r.subtotal}, ${r.shipping}, ${r.step}::checkout_step, ${r.status}::checkout_status,
                  ${r.abandonedAt}::timestamptz, ${r.recoveredOrderId}::uuid, ${r.recoveredAt}::timestamptz,
                  ${r.createdAt}::timestamptz, ${r.updatedAt}::timestamptz)`,
    );
    await db.execute(sql`
      insert into checkout_sessions (store_id, session_id, customer_id, name, phone, email, address,
                                     city, province, postcode, district_id, items,
                                     subtotal_idr, shipping_idr, step, status,
                                     abandoned_at, recovered_order_id, recovered_at, created_at, updated_at)
      values ${sql.join(values, sql`, `)}
      on conflict (store_id, session_id) do nothing
    `);
  }

  const filled = gap.length - skipped;
  console.log(
    `✓ ${rows.length} keranjang ditambahkan — mengisi ${filled} hari kosong` +
      `${skipped ? ` (${skipped} hari dilewati: tidak ada pesanan)` : ""}.`,
  );
}

async function main() {
  const [store] = await q(sql`select id, name from stores where slug = ${SLUG}`);
  if (!store) throw new Error(`Store ${SLUG} not found — nothing to top up.`);
  const storeId = String(store.id);

  // BILLING FIRST — a lapsed period makes every admin write fail (Task 8.13), and that is the one
  // symptom of seed rot this script used to leave in place. One row, printed once, no-op when current.
  const until = await seedBillingPeriod(db, storeId);
  console.log(
    until
      ? `✓ Langganan ${store.name} sudah kedaluwarsa — current_period_end dimajukan ke ${until} (+${RECENT_PERIOD_DAYS} hari).`
      : `✓ Langganan ${store.name} masih aktif — current_period_end tidak disentuh.`,
  );

  // PROMO demo (PROMO P5) — runs BEFORE the order top-up's early return so the /promo hub is always
  // populated, even when there are no empty order days. All now()-relative (the anchored main seed
  // can't make a flash sale that is live TODAY) and idempotent, so it is safe on prod.
  await seedPromo(storeId);
  await seedOrders(storeId, String(store.name));
  // AFTER the orders, always — the cart volume is derived per day from that day's orders, so running
  // it first would leave every day the top-up just filled without a single cart, and the NEXT run
  // would insert them: a script that only settles on the third run is not idempotent.
  await seedCheckoutSessions(storeId);
}

// Entrypoint guard (same shape as `verify-ledger.ts`): `seedBillingPeriod` is imported by a test,
// and importing this module must NOT run the top-up against whatever DATABASE_URL is in scope.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => client.end());
}
