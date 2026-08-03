// Backfill the DELIVERY SNAPSHOT on demo orders — recipient, phone, street address, and a destination
// (district + postcode + the city/province DERIVED from it) that actually resolves.
//
//   npm run backfill:ship-address -w @tokophi/db          # writes
//   DRY_RUN=1 npm run backfill:ship-address -w @tokophi/db  # prints the plan, writes nothing
//
// WHY THIS IS NOT PART OF `seed-recent.ts`
// `seed-recent` is INSERT-only and says so in its own header — that is the whole reason it is safe to
// point at production while other people are working. This job is an UPDATE of rows that already
// exist, so folding it in would quietly retire that promise. Worse, `seed-recent` SAMPLES its
// destinations *from `orders`* — it is downstream of this data, not a source for it, and on the live
// store it was sampling 7 districts and addresses like "Test ruma kami". Fixing the rows here fixes
// what `seed-recent` copies from, for free.
//
// WHAT IT WRITES, AND WHAT IT REFUSES TO TOUCH
//   writes: ship_recipient · ship_phone · ship_address · ship_district_id · ship_postcode · city · province
//   never:  total_idr · subtotal_idr · shipping_idr · tax_idr · discount_idr · status · financial_status
//           · courier · service_type · awb · ka_order_id · customer_id · placed_at · label_printed_at
//           — and no other table. Orders carry payments, line items and ledger entries; a destination
//           is not money, and this script must never be able to move money.
//
// WHICH ROWS
// A row is repaired when its snapshot cannot ship a parcel:
//   · no `ship_address`, or shorter than 15 characters                       (50 + 58 on prod)
//   · an address with NO DIGIT in it — "Jalan maju", "Jsjsj rw rt dkdj". A street with no house
//     number, no RT/RW and no block is not an address a rider can walk to, whatever its length.
//   · no `ship_district_id` / `ship_postcode`, or a district id that does not resolve
//   · `city`/`province` that are not the ones DERIVED from the district — the typed pair is ignored
//     everywhere and was the COD hole, so a snapshot where they disagree is repaired, not trusted.
// Everything else is LEFT ALONE. "Ngoto RT 01 Bangunharjo Sewon Bantul" is a real address someone
// typed; a backfill that overwrites it is destroying data, not filling a gap.
//
// IDEMPOTENT BY THE SAME PREDICATE: after a run, no row satisfies it, so a second run updates 0 rows.
//
// HONESTY RULES BAKED IN
// · Every `ship_district_id` is a REAL `kiriminaja_areas` id, and each one is pinned to the district
//   name it is expected to be — if the reference table is ever re-imported and an id moves, the script
//   FAILS instead of silently addressing parcels to a different island.
// · Every `ship_postcode` is a real kelurahan postcode UNDER that district (`kelurahan`), never made up.
// · `city`/`province` are read off the district, never typed.
// · Names and phones are the shapes the validator has to accept (`Nur'aini`, `M. Rizky`,
//   `I Gusti Ngurah Rai`, prefixes 0838/0881/0895/0851) — this data exists to exercise the rules.
// · Deterministic (mulberry32 over a hash of the order number) — the same row always gets the same
//   address, so a re-run after widening the predicate does not reshuffle the demo.
//
// ⚠️ ON THE FIVE ORDERS THAT ARE ALREADY BOOKED. Four of them match the predicate. They are SANDBOX
// bookings (`KIRIMINAJA_ENV=sandbox`, `ka_order_id` 5758-…, the single AWB reads `DEMO…`): no parcel
// exists and no label was ever printed (`label_printed_at` is null on all 219 rows). Against a
// PRODUCTION KiriminAja account this would not be safe — a booked parcel's destination is already
// committed at the courier — so if this script is ever re-pointed at a store with live shipments,
// exclude `awb is not null` first.
import { db, client } from "./client";
import { sql } from "drizzle-orm";
import {
  BUCKETS, DESTINATIONS, RECIPIENTS,
  buildAddress, buildPhone, hash32, interleaved, mulberry32, recipientFor,
  type Dest,
} from "./demo-addresses";

const SLUG = "batik-nusantara";

// ─────────────────────────────────────────────────────────────────────────────
type Row = Record<string, string | number | null>;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Row[];

// The ONE definition of "this snapshot cannot ship a parcel". Also the idempotence guarantee: after a
// run nothing satisfies it. `city`/`province` are compared against the DERIVED pair, never the typed one.
const DEFICIENT = sql`(
     o.ship_address is null
  or length(btrim(o.ship_address)) < 15
  or o.ship_address !~ '[0-9]'
  or o.ship_district_id is null
  or o.ship_postcode is null
  or not exists (select 1 from kiriminaja_areas a where a.id = o.ship_district_id)
  or o.city is null or o.province is null
  or exists (
       select 1 from kiriminaja_areas a
        where a.id = o.ship_district_id
          and (a.province_name is distinct from o.province
            or btrim(coalesce(a.city_type, '') || ' ' || a.city_name) is distinct from o.city))
)`;

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const [store] = await q(sql`select id, name from stores where slug = ${SLUG}`);
  if (!store) throw new Error(`Store ${SLUG} not found — nothing to backfill.`);
  const storeId = String(store.id);

  // 1) Resolve the pool and PIN it. A district id that has moved, or lost its kelurahan rows, is a
  //    parcel addressed to the wrong place — fail rather than write it.
  const ids = DESTINATIONS.map((d) => d.id);
  const areas = await q(sql`
    select a.id, a.district_name, coalesce(a.city_type, '') as city_type, a.city_name, a.province_name
      from kiriminaja_areas a where a.id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}`);
  const areaById = new Map(areas.map((a) => [Number(a.id), a]));
  const kels = await q(sql`
    select district_id, name, postcode from kelurahan
     where district_id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}
     order by district_id, name`);
  const kelByDistrict = new Map<number, Row[]>();
  for (const k of kels) {
    const d = Number(k.district_id);
    if (!kelByDistrict.has(d)) kelByDistrict.set(d, []);
    kelByDistrict.get(d)!.push(k);
  }
  const problems: string[] = [];
  for (const d of DESTINATIONS) {
    const a = areaById.get(d.id);
    if (!a) { problems.push(`${d.id} (${d.label}) does not resolve in kiriminaja_areas`); continue; }
    const label = `${a.district_name}, ${String(a.city_type)} ${a.city_name}, ${a.province_name}`.replace(/\s+/g, " ").trim();
    if (label !== d.label) problems.push(`${d.id} is now "${label}", expected "${d.label}"`);
    if (!kelByDistrict.get(d.id)?.length) problems.push(`${d.id} (${d.label}) has no kelurahan → no honest postcode`);
  }
  if (problems.length) throw new Error(`Destination pool is stale:\n  - ${problems.join("\n  - ")}`);

  // 2) The rows that cannot ship, in a stable order.
  const targets = await q(sql`
    select o.id, o.number, o.customer_id, coalesce(o.courier, '') as courier
      from orders o
     where o.store_id = ${storeId} and ${DEFICIENT}
     order by o.number`);
  if (!targets.length) {
    console.log("✓ Semua pesanan sudah punya alamat pengiriman yang lengkap — tidak ada yang diperbaiki.");
    return;
  }

  // 3) One identity per CUSTOMER, not per order: a shop where the same buyer's parcels go to eight
  //    different people reads like corrupt data. Ordered by id so the assignment is reproducible, and
  //    the validator-edge names sit at the front of the pool so the lowest indices get them.
  const customers = await q(sql`select id from customers where store_id = ${storeId} order by id`);
  const custIndex = new Map(customers.map((c, i) => [String(c.id), i]));

  const pool = interleaved();
  const spxRows = targets.filter((t) => String(t.courier) === "spx");
  const otherRows = targets.filter((t) => String(t.courier) !== "spx");
  const half = Math.floor(pool.length / 2); // offset the non-SPX partition so the two don't overlap
  const plan = new Map<string, Dest>();
  spxRows.forEach((t, i) => plan.set(String(t.id), pool[i % pool.length]));
  otherRows.forEach((t, i) => plan.set(String(t.id), pool[(i + half) % pool.length]));

  const values: ReturnType<typeof sql>[] = [];
  const dist = new Map<string, number>();
  const preview: string[] = [];
  for (const t of targets) {
    const dest = plan.get(String(t.id))!;
    const area = areaById.get(dest.id)!;
    const rnd = mulberry32(hash32(String(t.number)));
    const villages = kelByDistrict.get(dest.id)!;
    const village = villages[Math.floor(rnd() * villages.length)];
    const ci = t.customer_id ? (custIndex.get(String(t.customer_id)) ?? 0) : hash32(String(t.number)) % RECIPIENTS.length;
    const recipient = recipientFor(ci);
    const phone = buildPhone(ci);
    const address = buildAddress(rnd, String(village.name));
    const city = `${String(area.city_type)} ${area.city_name}`.replace(/\s+/g, " ").trim();
    const province = String(area.province_name);

    values.push(sql`(${String(t.id)}::uuid, ${recipient}, ${phone}, ${address}, ${dest.id}::int,
                     ${String(village.postcode)}, ${city}, ${province})`);
    dist.set(dest.bucket, (dist.get(dest.bucket) ?? 0) + 1);
    dist.set(province, (dist.get(province) ?? 0) + 1);
    if (preview.length < 10) preview.push(`${t.number}  ${recipient} · ${phone} · ${address} · ${city}, ${province} ${village.postcode} (${dest.id}, ${dest.bucket})`);
  }

  console.log(`Rencana: ${targets.length} pesanan (${spxRows.length} SPX, ${otherRows.length} non-SPX) → ${new Set([...plan.values()].map((d) => d.id)).size} kecamatan.`);
  for (const b of BUCKETS) console.log(`  ${b.padEnd(10)} ${dist.get(b) ?? 0}`);
  console.log(preview.map((p) => "  " + p).join("\n"));

  if (dryRun) {
    console.log("DRY_RUN=1 — tidak ada yang ditulis.");
    return;
  }

  // 4) ONE statement, one transaction, seven columns. Nothing else on the row is named, so nothing
  //    else can move — money least of all.
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    await db.execute(sql`
      update orders o set
        ship_recipient   = v.recipient,
        ship_phone       = v.phone,
        ship_address     = v.address,
        ship_district_id = v.district_id,
        ship_postcode    = v.postcode,
        city             = v.city,
        province         = v.province
      from (values ${sql.join(chunk, sql`, `)})
        as v(id, recipient, phone, address, district_id, postcode, city, province)
     where o.id = v.id and o.store_id = ${storeId}`);
  }
  console.log(`✓ ${values.length} alamat pengiriman diperbaiki untuk ${store.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
