"use server";
import { schema } from "@tokophi/db";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { getShippingRates, createShipment, trackShipment } from "@/lib/actions/shipping";

// Pengiriman Massal — bulk booking / resi fetch / print marking.
//
// This orchestrates the SINGLE-order actions; it does not re-implement any of them. createShipment
// already re-quotes, enforces the COD gate (lib/cod.ts), composes the pickup address and persists the
// booking; trackShipment already fetches the waybill and stores it. Writing a second copy of any of
// that is how the seller's list and the courier's parcel end up disagreeing — the exact failure
// composePickupAddress had when it existed twice.
//
// SEQUENTIAL, not parallel, and deliberately so: each item is a live call to KiriminAja that BOOKS A
// REAL PICKUP. Firing 50 at once risks rate-limiting mid-run and leaving an unknowable half-state —
// and a duplicate pickup is not a retry, it is a second parcel. Slower is the correct trade here.
//
// PARTIAL FAILURE IS THE NORMAL CASE and is reported per order, never summarised into "berhasil".
// 8 booked / 2 failed must read as exactly that: the seller has to know WHICH two.

export type BulkResult = {
  ok: boolean;
  done: number;
  failed: { number: string; error: string }[];
  /** Booked but the courier has not issued a waybill yet — the NORMAL post-booking state, not an
   *  error. KiriminAja returns awb:null until a courier accepts the pickup. */
  awaitingResi: string[];
  /** Orders whose destination district was FUZZY-MATCHED from a free-text city because they carry no
   *  `ship_district_id` (pre-0042). Booked, but to a district nobody confirmed. A bulk run is exactly
   *  where these disappear — 50 successes and no line saying 3 of them were guesses. */
  guessedDestination?: { number: string; district: string }[];
};

/** Book every selected order with the service the SHOPPER paid for (orders.courier + service_type).
 *  No rate picker: the order already knows what was bought — asking the seller to re-choose is asking
 *  them to guess on someone else's money. */
export async function bulkGenerateResi(numbers: string[]): Promise<BulkResult> {
  await requireCapability("orders:write");
  const failed: { number: string; error: string }[] = [];
  const awaitingResi: string[] = [];
  const guessedDestination: { number: string; district: string }[] = [];
  let done = 0;

  for (const number of numbers.slice(0, 50)) {
    try {
      // Re-quote per order: the price and the service list are live, and the order's own district +
      // real weight drive it. This is the same call the single-order screen makes.
      const q = await getShippingRates({ orderNumber: number });
      if (!q.ok) {
        failed.push({ number, error: q.error ?? "Gagal cek ongkir" });
        continue;
      }
      const want = await orderService(number);
      if (!want) {
        failed.push({ number, error: "Pesanan tidak punya kurir/layanan tersimpan." });
        continue;
      }
      // Match on courier+type — the pair the checkout matched on. A service that is no longer quoted
      // is REJECTED, never silently swapped for a neighbour: re-couriering someone's parcel behind
      // their back is the same class of lie as re-pricing it.
      const rate = q.rates.find((r) => r.code === want.courier && r.type === want.serviceType);
      if (!rate) {
        failed.push({ number, error: `Layanan ${want.courier}/${want.serviceType} tidak tersedia lagi untuk tujuan ini.` });
        continue;
      }
      const r = await createShipment({
        orderNumber: number,
        service: rate.code,
        serviceType: rate.type,
        serviceName: rate.service,
        cost: rate.cost,
        insurance: false,
        // ⚠️ NOT `!!rate.cod`. That is the SERVICE's capability — true for every order on an SPX
        // service in a COD-enabled store — while this queue deliberately holds PREPAID orders too
        // (`financial_status='dibayar' OR has-cod-payment`). It booked 75 already-paid orders on this
        // store with `cod = total`, i.e. the courier asking a buyer who has paid to pay again at the
        // door. `createShipment` now derives COD from `payments.method` itself; omitting it here says
        // "you decide", which is the only correct answer a bulk loop can give.
      });
      if (!r.ok) {
        failed.push({ number, error: r.error ?? "Gagal membuat pengiriman" });
        continue;
      }
      done++;
      if (!r.awb) awaitingResi.push(number);
      if (r.destinationGuessed) guessedDestination.push({ number, district: r.destinationGuessed });
    } catch (e) {
      failed.push({ number, error: String((e as { message?: string })?.message ?? e) });
    }
  }
  revalidatePath("/pesanan/massal");
  return { ok: failed.length === 0, done, failed, awaitingResi, guessedDestination };
}

/** Ask KiriminAja for the waybill of every booked-but-resi-less order. trackShipment persists it. */
export async function bulkFetchResi(numbers: string[]): Promise<BulkResult> {
  await requireCapability("orders:write");
  const failed: { number: string; error: string }[] = [];
  const awaitingResi: string[] = [];
  let done = 0;

  for (const number of numbers.slice(0, 50)) {
    try {
      const r = await trackShipment(number);
      if (r.awb) done++;
      else awaitingResi.push(number); // still no waybill — the courier has not accepted yet
    } catch (e) {
      failed.push({ number, error: String((e as { message?: string })?.message ?? e) });
    }
  }
  revalidatePath("/pesanan/massal");
  return { ok: failed.length === 0, done, failed, awaitingResi };
}

/** Stamp label_printed_at. Called AFTER the browser opened the print dialog.
 *  ⚠️ This records that we RENDERED the labels — we cannot observe a printer. The UI says
 *  "ditandai dicetak", never "berhasil dicetak" (same honesty rule as the CRM's "WA dibuka"). */
export async function markLabelsPrinted(numbers: string[]): Promise<{ ok: boolean; done: number }> {
  const { storeId } = await requireCapability("orders:write");
  if (!numbers.length) return { ok: true, done: 0 };
  // `done` is what we actually WROTE, not what we were asked to write. It used to be `numbers.length`,
  // which reports full success for numbers that matched nothing — an order belonging to another store
  // (RLS filters it out, no error) or one that no longer exists. "12 label ditandai tercetak" while
  // three of them are untouched is the kind of lie a merchant only discovers at the drop-off point.
  const rows = await withTenant(storeId, (db) =>
    db
      .update(schema.orders)
      .set({ labelPrintedAt: new Date() })
      .where(inArray(schema.orders.number, numbers))
      .returning({ number: schema.orders.number }),
  );
  revalidatePath("/pesanan/massal");
  return { ok: rows.length === numbers.length, done: rows.length };
}

async function orderService(number: string): Promise<{ courier: string; serviceType: string } | null> {
  const { storeId } = await requireCapability("orders:write");
  return withTenant(storeId, async (db) => {
    const [o] = await db
      .select({ courier: schema.orders.courier, serviceType: schema.orders.serviceType })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    return o?.courier && o?.serviceType ? { courier: o.courier, serviceType: o.serviceType } : null;
  });
}
