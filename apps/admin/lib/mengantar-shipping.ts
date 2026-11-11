import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/lib/tenant";
import { openFailureMessage, openStoreMengantar, storePickupAddressId, type MgOpen } from "@tokophi/db/mengantar-account";
import {
  mgBalance,
  mgCancel,
  mgCreateOrder,
  mgEstimate,
  mgPayUnpaid,
  mgPickupSlot,
  mgPickupSlots,
  earliestPickupSlot,
  nextPickupStart,
  type MgPickupSlotRow,
  mgUpsertPickupAddress,
  MengantarNotWhitelistedError,
  MengantarPosCodIneligibleError,
  type MgCreatedOrder,
  type MgCreateOrderInput,
  type MgRate,
  type MgResult,
} from "@tokophi/lib/mengantar";
import { DEFAULT_SHIPPING_PROVIDER, type MengantarConfig, type ShippingProvider } from "@tokophi/lib/provider-config";
import { cacheGet, cacheSet } from "@tokophi/lib/cache";
import { isInstantCourier } from "@tokophi/lib/couriers";
import { kaServiceGroups, mengantarRates, type QuotedRate } from "@/lib/shipping-quote";
import { mengantarDestination } from "@/lib/data/areas";
import { weightForOrder } from "@/lib/shipping-weight";
import { composePickupAddress } from "@/lib/pickup-address";
import { applyOrderStatusChange, shipmentLocked, type OrderStatus } from "@/lib/order-status";
import { syncOrderFromKa } from "@/lib/ka-tracking";
import { MG_VANISH_MIN_AGE_MS, pullMengantar } from "@/lib/mengantar-tracking";
import type { CreateShipmentResult, Rate } from "@/lib/actions/shipping";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SHIP-MENGANTAR phase 3 — booking and cancel for orders STAMPED `shipping_provider = 'mengantar'`.
//
// The `"use server"` actions in `actions/shipping.ts` keep their capability gate and dispatch here
// by the ORDER's own stamp (never the platform switch), so a KiriminAja order never reaches this file
// and a Mengantar order never reaches KiriminAja. Design: `specs/docs/tasks/2026-11-05-mengantar-
// integration-analysis.md` §2.2.1, §4 (booking/cancel rows), §6 R1/R4/R5/R9.
//
// PARTNER MODEL (owner 2026-11-05): every call acts as THE STORE'S OWN Mengantar seller account —
// `openStoreMengantar` (packages/db/src/mengantar-account.ts) hands out its key; a booking stamps
// `mg_env` + `mg_seller_id`, and cancel / pay / tracking reopen THAT account (a store whose account
// changed since is refused, never handed the new key). The seller's Mengantar WALLET pays the courier,
// so there is NO TokoΦ ledger debit here (owner O3): the buyer's shipping is passed through to the
// seller's TokoΦ balance instead (ledger-credit.ts / view order_seller_entitlements, FINANCE.md §2).
//
// THE RULES THIS FILE HOLDS
//
// 1. EVERY BOOKING IS REAL MONEY (the seller's wallet) and the provider's idempotency key is proven in
//    the sandbox only (lib/mengantar.ts `mgCreateOrder`; we send one, derived from our booking id, but
//    do not rely on it until production shows the same). So:
//    · EXACTLY-ONCE CLAIM: the reservation inserts a `shipment_bookings` row in `reserved` under the
//      store's advisory lock + the order row's `FOR UPDATE`, after refusing any active booking. The
//      partial unique index `shipment_one_active_per_order` makes a second active row a DATABASE
//      impossibility — two clicks, two tabs, a bulk run racing the order screen: one POST /order.
//    · OUTCOME UNKNOWN BLOCKS: a timeout / dropped connection / 5xx / unreadable 2xx on POST /order
//      leaves the booking `unknown`, the debit reserved, and every later attempt refused ("belum
//      diketahui") until an operator reconciles it against the provider's dashboard (our order number
//      rides as `destinationMark`). Never a blind retry.
//    · ONE POST /order IN FLIGHT PER SELLER ACCOUNT (trap 4, 409 for JT/SiCepat): the call runs under
//      an advisory lock keyed on the store's seller account. A 409 that still arrives (the seller using
//      their own Mengantar app at the same moment) is a refusal — nothing created — retried with backoff.
// 2. A WAYBILL IS WRITTEN ONLY WHEN THE PROVIDER RETURNS ONE (`cnote_no`). The booking `_id` /
//    `ORDER_ID` go to `mg_order_id` / `mg_order_code`, never to `awb`. And a waybill is NOT a pickup:
//    the order goes to `diproses` here; only a tracking STATUS moves it on (mengantar-tracking.ts).
// 3. A LOW SELLER WALLET DOES NOT FAIL: the order is created `isPaid:false` with no waybill. It is
//    stored (`mg_is_paid=false`) and shown on the order as "Ongkir pengiriman BELUM dibayar". The SELLER
//    tops up in their own Mengantar app and presses "Bayar ongkir" (`payMengantarUnpaid` below —
//    compare-and-swap `false → null → true`, the same discipline the booking claim has).
// 4. COD NEVER TRAVELS THIS PATH (owner O4/O6): COD orders are quoted and booked through the default
//    provider; a COD order stamped here is refused before anything leaves.
// 5. The provider's own text may reach the SELLER (they act on it). Seller copy may name Mengantar
//    (owner O5); shoppers never see it (ADR 0004 still holds for them).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type MgShippingOptions = {
  /** Injected transport (tests, the sandbox e2e). A write under NODE_ENV=test refuses without one. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Clock for the pickup slot (tests). */
  now?: number;
  /** Backoff before each 409 retry, ms. Default 1 s, 2 s. */
  retry409Ms?: number[];
  /**
   * `scheduledPickup` (default: a courier comes) or `dropOff` (the seller takes the parcel to the
   * courier). Env `MENGANTAR_PICKUP_MODE` overrides the default — the sandbox offers NO pickup slots
   * (`GET /time` → []), so drop-off is the only bookable mode there.
   */
  pickupMode?: "scheduledPickup" | "dropOff";
};

/** How long a pickup address's `GET /time` list is reused (a bulk run books many orders of one store). */
const SLOT_CACHE_MS = 60_000;
/** One POST /order in flight per SELLER ACCOUNT (the 409 is per account). */
const leaseKey = (storeId: string, sellerId: string) => `shipping:mg:create-order:${storeId}:${sellerId}`;

const pickupModeOf = (opts: MgShippingOptions): "scheduledPickup" | "dropOff" =>
  opts.pickupMode ?? (process.env.MENGANTAR_PICKUP_MODE === "dropOff" ? "dropOff" : "scheduledPickup");

/** The call options for ONE seller account. */
const callFor = (cfg: MengantarConfig, opts: MgShippingOptions) => ({ cfg, fetch: opts.fetch, timeoutMs: opts.timeoutMs });
type Call = ReturnType<typeof callFor>;

/** The order's provider stamp, read through RLS. `null` = no such order in this store. */
export async function orderShippingProvider(storeId: string, orderNumber: string): Promise<ShippingProvider | null> {
  const [o] = await withTenant(storeId, (tx) =>
    tx.select({ p: schema.orders.shippingProvider }).from(schema.orders).where(eq(schema.orders.number, orderNumber)).limit(1),
  );
  if (!o) return null;
  return o.p === "mengantar" ? "mengantar" : DEFAULT_SHIPPING_PROVIDER;
}

type OrderCtx = Awaited<ReturnType<typeof loadOrder>>;

async function loadOrder(storeId: string, orderNumber: string) {
  return withTenant(storeId, async (tx) => {
    const [s] = await tx.select().from(schema.storeSettings).where(eq(schema.storeSettings.storeId, storeId)).limit(1);
    const [o] = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        provider: schema.orders.shippingProvider,
        awb: schema.orders.awb,
        mgOrderId: schema.orders.mgOrderId,
        mgEnv: schema.orders.mgEnv,
        mgSellerId: schema.orders.mgSellerId,
        subtotal: schema.orders.subtotalIdr,
        shipping: schema.orders.shippingIdr,
        total: schema.orders.totalIdr,
        courier: schema.orders.courier,
        serviceType: schema.orders.serviceType,
        city: schema.orders.city,
        shipRecipient: schema.orders.shipRecipient,
        shipPhone: schema.orders.shipPhone,
        shipAddress: schema.orders.shipAddress,
        shipDistrictId: schema.orders.shipDistrictId,
        shipKelurahanName: schema.orders.shipKelurahanName,
        shipAreaId: schema.orders.shipMengantarAreaId,
        custName: schema.customers.name,
        custPhone: schema.customers.phone,
        // Aliased + table-qualified: the two traps `shipment-payment-guard.test.ts` documents.
        isCod: sql<boolean>`exists (select 1 from payments p where p.order_id = "orders"."id" and p.method = 'cod')`.as("is_cod"),
        hasSuccessfulPayment: sql<boolean>`exists (select 1 from payments p where p.order_id = "orders"."id" and p.status = 'berhasil')`.as("has_successful_payment"),
      })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.number, orderNumber))
      .limit(1);
    if (!o) return { s, o: undefined, lines: [], pkg: null };
    // Child rows read in the SAME tenant txn, keyed on the parent just read through RLS.
    const lines = await tx
      .select({ title: schema.orderLineItems.title, qty: schema.orderLineItems.qty })
      .from(schema.orderLineItems)
      .where(eq(schema.orderLineItems.orderId, o.id));
    const pkg = await weightForOrder(tx, o.id);
    return { s, o, lines, pkg };
  });
}

type PricedRate = { rate: QuotedRate; mg: MgRate };

/**
 * The live price list for ONE order, under the SAME courier rule the checkout applies
 * (`mengantarRates`): seller origin, the kecamatan representative as the PRICE destination (what the
 * checkout quoted), and the order's own Σ-lines weight in kg. Never cached — a booking prices now.
 */
async function orderRates(storeId: string, ctx: NonNullable<OrderCtx>, call: Call): Promise<{ ok: true; rates: PricedRate[] } | { ok: false; error: string }> {
  const { s, o, pkg } = ctx;
  if (!o || !pkg) return { ok: false, error: "Pesanan tidak ditemukan." };
  const origin = s?.senderMengantarAreaId?.trim();
  if (!origin) return { ok: false, error: "Alamat pengambilan toko belum diatur (Pengaturan → Alamat)." };
  if (!o.shipDistrictId) return { ok: false, error: "Kecamatan tujuan pesanan tidak diketahui — pesanan ini tidak bisa dihitung ongkirnya." };
  const priceDest = await mengantarDestination(o.shipDistrictId, null);
  if (!priceDest) return { ok: false, error: "Ongkir belum tersedia untuk kecamatan tujuan ini." };

  const platformRows = await db.select({ courier: schema.platformCouriers.courier, enabled: schema.platformCouriers.enabled, services: schema.platformCouriers.services }).from(schema.platformCouriers);
  const platformOn = platformRows.filter((p) => p.enabled && !isInstantCourier(p.courier)).map((p) => p.courier);
  const picked = await withTenant(storeId, (tx) =>
    tx
      .select({ courier: schema.storeShippingMethods.courier, service: schema.storeShippingMethods.service })
      .from(schema.storeShippingMethods)
      .where(eq(schema.storeShippingMethods.enabled, true)),
  );

  let r: MgResult<MgRate[]>;
  try {
    r = await mgEstimate({ originId: origin, destinationId: priceDest.areaId, kg: pkg.billableGrams / 1000 }, call);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `Gagal mengambil tarif dari Mengantar.` };
  }
  if (!r.ok) return { ok: false, error: r.error || `Gagal mengambil tarif dari Mengantar.` };
  const all = r.data;
  const quoted = mengantarRates(all, { platformOn, merchant: s?.couriers ?? null, picked, kaGroups: kaServiceGroups(platformRows) });
  const rates: PricedRate[] = [];
  for (const q of quoted) {
    const mg = all.find((m) => m.key === q.type);
    if (mg) rates.push({ rate: q, mg });
  }
  return { ok: true, rates };
}

/** `getShippingRates` for a Mengantar order — the seller's "Cek Ongkir" list and the bulk loop's re-quote. */
export async function mengantarOrderRates(
  storeId: string,
  orderNumber: string,
  opts: MgShippingOptions = {},
): Promise<{ ok: boolean; rates: Rate[]; origin?: string; destination?: string; codEnabled?: boolean; error?: string }> {
  const ctx = await loadOrder(storeId, orderNumber);
  const acc = await openStoreMengantar(storeId, ctx.o ?? undefined);
  if (!acc.ok) return { ok: false, rates: [], error: openFailureMessage(acc.reason) };
  const q = await orderRates(storeId, ctx, callFor(acc.cfg, opts));
  if (!q.ok) return { ok: false, rates: [], error: q.error };
  return {
    ok: true,
    origin: ctx.s?.senderKecamatanName ?? "",
    destination: ctx.o?.city ?? "",
    // COD never travels this provider (owner O4/O6).
    codEnabled: false,
    rates: q.rates.map(({ rate }) => ({
      service: rate.name,
      code: rate.code,
      type: rate.type,
      cost: rate.cost,
      etd: rate.etd,
      cod: false,
      group: rate.group,
      codFee: { amount: null, pct: null, minimum: null },
      insurance: 0,
      forceInsurance: false,
    })),
  };
}

/**
 * The pickup address id IN THIS SELLER ACCOUNT, registering it (`POST /address`, with the store's own
 * key) the first time. Stored compare-and-set on the account row: if two bookings of one store register
 * at once, the first stored id wins and both book against it (the loser's address stays orphaned at the
 * provider — harmless, never booked against). `saveSenderAddress` clears it when the address changes,
 * so the next booking registers the new one rather than sending a courier to the old door.
 */
async function ensurePickupAddress(storeId: string, acc: Extract<MgOpen, { ok: true }>, s: NonNullable<OrderCtx["s"]>, opts: Call): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const existing = acc.pickupAddressId?.trim();
  if (existing) return { ok: true, id: existing };
  let r: MgResult<string>;
  try {
    r = await mgUpsertPickupAddress(
      {
        name: s.senderName?.trim() || "Toko",
        pic: s.senderName?.trim() || "Toko",
        picPhone: s.senderPhone?.trim() ?? "",
        address: composePickupAddress({ address: s.senderAddress, kelurahanName: s.senderKelurahanName, postcode: s.senderPostcode }) || (s.senderAddress ?? ""),
        areaId: s.senderMengantarAreaId ?? "",
      },
      opts,
    );
  } catch (e) {
    console.error("[shipping/mg] pickup address registration outcome unknown", storeId, e instanceof Error ? e.name : "UnknownError");
    return { ok: false, error: `Alamat pengambilan belum terdaftar di Mengantar (respons terputus). Coba lagi sebentar.` };
  }
  if (!r.ok) return { ok: false, error: `Alamat pengambilan ditolak Mengantar: ${r.error}` };
  const id = await storePickupAddressId(storeId, acc.sellerId, r.data, {
    senderName: s.senderName ?? null,
    senderPhone: s.senderPhone ?? null,
    senderAddress: s.senderAddress ?? null,
    senderKelurahanName: s.senderKelurahanName ?? null,
    senderPostcode: s.senderPostcode ?? null,
    senderMengantarAreaId: s.senderMengantarAreaId ?? null,
  });
  return id ? { ok: true, id } : { ok: false, error: "Alamat pengambilan tidak tersimpan. Coba lagi." };
}

// ── Pickup schedule ────────────────────────────────────────────────────────────────────────────
const SLOT_LABEL = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** "Kamis, 6 November 2026 pukul 10.00 WIB" — what the seller is told. */
export const pickupSlotLabel = (startsAt: number) => `${SLOT_LABEL.format(new Date(startsAt))} WIB`;

/**
 * The pickup slot, from the PROVIDER's own schedule (owner ruling 2026-11-05): the address's existing
 * slots (`GET /time?address=`, reused for `SLOT_CACHE_MS`) — the earliest one still ≥ 90 min away —
 * else the earliest slot the provider's documented rule allows (09–18 WIB, ≥ 90 min), created with
 * `POST /time` (`mgPickupSlot` re-lists first, so a retry never makes a second one). If the schedule
 * cannot be READ, the booking is refused: a slot we guessed is a courier at the wrong hour, or a
 * rejected booking.
 */
async function choosePickupSlot(addressId: string, now: number, opts: Call): Promise<{ ok: true; id: string; startsAt: number } | { ok: false; error: string }> {
  const key = `mg:time:${addressId}`;
  let rows = cacheGet<MgPickupSlotRow[]>(key);
  if (!rows) {
    let r: MgResult<MgPickupSlotRow[]>;
    try {
      r = await mgPickupSlots(addressId, opts);
    } catch (e) {
      console.error("[shipping/mg] pickup schedule unreadable", e instanceof Error ? e.name : "UnknownError");
      return { ok: false, error: "Jadwal penjemputan kurir tidak bisa dibaca saat ini. Pengiriman belum dibuat — coba lagi sebentar." };
    }
    if (!r.ok) return { ok: false, error: `Jadwal penjemputan kurir tidak bisa dibaca: ${r.error}. Pengiriman belum dibuat.` };
    rows = r.data;
    cacheSet(key, rows, SLOT_CACHE_MS);
  }
  const hit = earliestPickupSlot(rows, now);
  if (hit) return { ok: true, id: hit.id, startsAt: hit.startsAt };

  const next = nextPickupStart(now);
  let created: MgResult<string>;
  try {
    created = await mgPickupSlot(addressId, next.date, next.hour, { ...opts, now });
  } catch (e) {
    console.error("[shipping/mg] pickup slot outcome unknown", e instanceof Error ? e.name : "UnknownError");
    return { ok: false, error: "Jadwal penjemputan belum bisa dibuat (respons kurir terputus). Coba lagi sebentar." };
  }
  if (!created.ok) return { ok: false, error: `Jadwal penjemputan ditolak: ${created.error}` };
  cacheSet(key, [...rows, { id: created.data, date: next.date, hour: next.hour, startsAt: next.startsAt }], SLOT_CACHE_MS);
  return { ok: true, id: created.data, startsAt: next.startsAt };
}

/**
 * Run `fn` holding the SELLER ACCOUNT's booking lease: one POST /order in flight per account (trap 4). A transaction-scoped advisory lock on the owner pool — released by commit, rollback or a
 * dropped connection, so a crashed process can never leave a stale lease behind.
 * // lazy: pins one pooled connection for ≤ MG_TIMEOUT_MS while the HTTP call runs; if pool pressure
 * // ever shows, move to a lease row with an expiry (adsbookcms `mengantar-dispatch.ts:147-198`).
 * The lock wait is bounded (30 s). A failure to ACQUIRE is reported as `{ leased:false }` — nothing
 * was sent. Once `fn` has returned, a failing COMMIT cannot lose its result.
 */
async function withBookingLease<T>(key: string, fn: () => Promise<T>): Promise<{ leased: false } | { leased: true; value: T }> {
  let entered = false;
  let done = false;
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '30s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
      entered = true;
      value = await fn();
      done = true;
    });
  } catch (e) {
    if (!entered) {
      console.error("[shipping/mg] booking lease not acquired", e instanceof Error ? e.message : e);
      return { leased: false };
    }
    if (!done) throw e;
  }
  return { leased: true, value: value as T };
}

async function createWith409Retry(payload: MgCreateOrderInput, call: Call, idempotencyKey: string, opts: MgShippingOptions): Promise<MgResult<MgCreatedOrder>> {
  const waits = opts.retry409Ms ?? [1000, 2000];
  for (let attempt = 0; ; attempt++) {
    const r = await mgCreateOrder(payload, { ...call, idempotencyKey });
    if (r.ok || r.httpStatus !== 409 || attempt >= waits.length) return r;
    // 409 = this seller account already had a create in flight (their own Mengantar app). Not created.
    await new Promise((res) => setTimeout(res, waits[attempt]));
  }
}

/** Mark a reserved booking failed — the provider definitively did not book. (No ledger debit exists to reverse: O3.) */
async function releaseReservation(storeId: string, bookingId: string, note: string): Promise<void> {
  await withTenant(storeId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
    await tx
      .update(schema.shipmentBookings)
      .set({ status: "failed", failureNote: note.slice(0, 500) })
      .where(and(eq(schema.shipmentBookings.id, bookingId), eq(schema.shipmentBookings.status, "reserved")));
  });
}

/**
 * Book ONE order stamped `mengantar`. Called by `createShipment` (single order, any in-scope service
 * the seller picked, cost re-checked) and through it by `bulkGenerateResi` (the service the shopper
 * paid for). The caller has already passed `requireCapability("orders:write")`; `storeId` is the
 * session's.
 */
export async function bookMengantar(
  storeId: string,
  input: { orderNumber: string; service: string; serviceType: string; serviceName?: string; cost?: number; cod?: boolean },
  opts: MgShippingOptions = {},
): Promise<CreateShipmentResult> {
  const ctx = await loadOrder(storeId, input.orderNumber);
  const { s, o } = ctx;
  if (!o) return { ok: false, error: "Pesanan tidak ditemukan." };
  // Defensive: the dispatcher already routed by this stamp. A mismatch is a bug, never a booking.
  if (o.provider !== "mengantar") return { ok: false, error: "Pesanan ini tidak memakai jalur pengiriman ini." };
  // THE STORE'S OWN seller account (and, if the order already names one, that same account).
  const acc = await openStoreMengantar(storeId, o);
  if (!acc.ok) return { ok: false, error: openFailureMessage(acc.reason) };
  const call = callFor(acc.cfg, opts);
  if (o.awb) return { ok: false, error: `Pesanan sudah punya resi (${o.awb}).` };
  if (o.mgOrderId) return { ok: false, error: "Pesanan sudah dibooking ke kurir." };
  if (input.cod !== undefined && !!input.cod !== !!o.isCod) {
    return { ok: false, error: o.isCod ? `Pesanan ${o.number} dibayar COD — resi harus dibuat dengan penagihan COD.` : `Pesanan ${o.number} sudah dibayar di muka — resi tidak boleh menagih COD lagi.` };
  }
  if (o.isCod) return { ok: false, error: `Pesanan COD ${o.number} tidak bisa dikirim lewat Mengantar — COD selalu lewat pengiriman standar TokoΦ.` };
  if (!o.hasSuccessfulPayment) {
    return { ok: false, error: `Pesanan ${o.number} belum dibayar. Pengiriman prepaid hanya dapat dibuat setelah pembayaran berhasil.` };
  }
  if (shipmentLocked(o.status)) return { ok: false, error: `Pesanan sudah ${o.status} — tidak bisa dibuatkan pengiriman.` };

  const missing: string[] = [];
  if (!s?.senderName?.trim()) missing.push("nama pengirim");
  if (!s?.senderPhone?.trim()) missing.push("nomor HP pengirim");
  if (!s?.senderAddress?.trim()) missing.push("alamat lengkap");
  if (!s?.senderMengantarAreaId?.trim()) missing.push("kecamatan/kelurahan (wajib — kurir tidak bisa menjemput tanpa ini)");
  if (missing.length || !s) {
    return { ok: false, senderIncomplete: true, missing, error: `Alamat pengirim belum lengkap: ${missing.join(", ")}. Lengkapi di Pengaturan → Alamat sebelum membuat pengiriman.` };
  }
  if (!o.shipAddress?.trim()) {
    return { ok: false, error: `Alamat tujuan pesanan ${o.number} tidak lengkap (hanya kota "${o.city ?? "—"}", tanpa alamat jalan). Kurir tidak bisa mengantar tanpa alamat lengkap — hubungi pembeli dan lengkapi alamat pesanan.` };
  }
  // The BOOKING destination: the area stamped at checkout, else the order's kelurahan / kecamatan
  // through the same bridge. No city-name guess: a guessed area is a parcel to the wrong place.
  // lazy: a kelurahan with no exact bridge (~9.5% of the 78,764, measured 2026-11-05) books to the
  // kecamatan's REPRESENTATIVE kelurahan — same kecamatan, while the street, kelurahan name and kodepos
  // the courier reads travel in the address text. Upgrade path if a misroute is ever reported: stamp
  // `from` at checkout and surface it like `destinationGuessed`.
  const destAreaId = o.shipAreaId?.trim() || (o.shipDistrictId ? (await mengantarDestination(o.shipDistrictId, o.shipKelurahanName))?.areaId : null);
  if (!destAreaId) return { ok: false, error: `Area tujuan pesanan ${o.number} tidak ditemukan di Mengantar.` };

  // Re-price on the server immediately before booking; `input.cost` is display state.
  const q = await orderRates(storeId, ctx, call);
  if (!q.ok) return { ok: false, error: q.error };
  const picked = q.rates.find((r) => r.rate.code === input.service && r.rate.type === input.serviceType);
  if (!picked) return { ok: false, error: "Layanan ini tidak tersedia pada tarif terbaru. Pilih layanan lain." };
  const serverCost = Math.max(0, Math.round(picked.rate.cost));
  if (input.cost !== undefined && serverCost !== Math.max(0, Math.round(input.cost))) {
    return { ok: false, error: `Tarif berubah menjadi Rp${serverCost.toLocaleString("id-ID")}. Periksa dan konfirmasi ulang sebelum booking.` };
  }

  // Pickup address and slot BEFORE the claim — neither books a parcel.
  const addr = await ensurePickupAddress(storeId, acc, s, call);
  if (!addr.ok) return { ok: false, error: addr.error };
  const mode = pickupModeOf(opts);
  const slot = mode === "scheduledPickup" ? await choosePickupSlot(addr.id, opts.now ?? Date.now(), call) : null;
  if (slot && !slot.ok) return { ok: false, error: slot.error };

  // ── THE CLAIM ─────────────────────────────────────────────────────────────────────────────────
  const bookingId = crypto.randomUUID();
  const reservation = await withTenant(storeId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
    const [locked] = await tx
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        mgOrderId: schema.orders.mgOrderId,
        priorBookings: sql<number>`(select count(*) from shipment_bookings sb where sb.order_id = "orders"."id")`.as("prior_bookings"),
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, input.orderNumber))
      .limit(1)
      .for("update");
    if (!locked || shipmentLocked(locked.status)) return { ok: false as const, error: "Pesanan tidak lagi dapat dibuatkan pengiriman." };
    if (locked.mgOrderId) return { ok: false as const, error: "Pesanan sudah dibooking ke kurir." };
    const [active] = await tx
      .select({ status: schema.shipmentBookings.status })
      .from(schema.shipmentBookings)
      .where(sql`${schema.shipmentBookings.orderId} = ${locked.id} and ${schema.shipmentBookings.status} in ('reserved', 'unknown', 'accepted', 'cancellation_requested')`)
      .limit(1);
    if (active) {
      return {
        ok: false as const,
        error:
          active.status === "unknown"
            ? "Status booking sebelumnya belum diketahui. Jangan booking ulang; hubungi dukungan TokoΦ untuk rekonsiliasi."
            : active.status === "cancellation_requested"
              ? "Pembatalan pengiriman masih diproses kurir."
              : "Pengiriman sedang atau sudah dibooking. Muat ulang pesanan.",
      };
    }
    // NO LEDGER DEBIT (owner O3): the seller's own Mengantar wallet pays the courier, so a debit here
    // would charge them twice. The booking row still records charged / actual / delta for the books;
    // `seller_debit_idr` and `platform_margin_idr` stay 0 — the buyer's shipping is passed through to
    // the seller instead (ledger-credit.ts, order_seller_entitlements).
    const [money] = await tx
      .select({ shippingCharged: schema.orderFinancials.shippingChargedIdr })
      .from(schema.orderFinancials)
      .where(eq(schema.orderFinancials.orderId, locked.id))
      .limit(1);
    const shippingCharged = Number(money?.shippingCharged ?? o.shipping ?? 0);
    await tx.insert(schema.shipmentBookings).values({
      id: bookingId,
      storeId,
      orderId: locked.id,
      // Unique per attempt; read under the lock, so two attempts cannot mint the same one.
      providerReference: `mg:${input.orderNumber}:${Number(locked.priorBookings ?? 0)}`,
      courier: picked.rate.code,
      serviceType: picked.rate.type,
      serviceName: picked.rate.name,
      status: "reserved",
      shippingChargedIdr: shippingCharged,
      shippingActualIdr: serverCost,
      shippingDeltaIdr: serverCost - shippingCharged,
      sellerDebitIdr: 0,
      platformMarginIdr: 0,
    });
    return { ok: true as const, orderId: locked.id };
  });
  if (!reservation.ok) return reservation;

  const totalQty = Math.max(1, ctx.lines.reduce((a, l) => a + (l.qty ?? 1), 0));
  const content = ctx.lines.map((l) => `${l.title?.trim() || "Barang"} x${l.qty ?? 1}`).join(", ");
  const payload: MgCreateOrderInput = {
    courier: picked.mg.shipment.courier,
    pickup: slot?.ok ? { type: "scheduledPickup", address_id: addr.id, time_id: slot.id, volume: "volumeMotor" } : { type: "dropOff", address_id: addr.id },
    orders: [
      {
        customerName: o.shipRecipient?.trim() || o.custName || "Penerima",
        customerPhone: o.shipPhone?.trim() || o.custPhone || "",
        customerAddress: o.shipAddress.trim(),
        customerAddressDataId: destAreaId,
        parcelContent: (content || `Pesanan ${o.number}`).slice(0, 200),
        // The SAME kg the quote priced: Σ every line, 1 kg floor (adsbookcms A1 not inherited).
        weight: (ctx.pkg?.billableGrams ?? 1000) / 1000,
        quantity: totalQty,
        goodsValue: Number(o.subtotal || o.total || 0),
        destinationMark: o.number,
        ...(picked.mg.shipment.cargo ? { cargo: true } : {}),
      },
    ],
  };

  // ── THE CALL, under the seller account's lease ───────────────────────────────────────────────
  // The replay key is derived from OUR booking id (unique per attempt), so a resend of THIS attempt is
  // the same request to the provider. Sent, never relied on (sandbox-proven only, 2026-11-05).
  let created: MgResult<MgCreatedOrder>;
  try {
    const leased = await withBookingLease(leaseKey(storeId, acc.sellerId), () => createWith409Retry(payload, call, `tokophi-${bookingId}`, opts));
    if (!leased.leased) {
      await releaseReservation(storeId, bookingId, "Antrean booking akun Mengantar toko penuh; tidak ada permintaan yang dikirim.");
      return { ok: false, error: "Antrean booking kurir sedang penuh. Coba lagi sebentar." };
    }
    created = leased.value;
  } catch (error) {
    if (error instanceof MengantarPosCodIneligibleError || error instanceof MengantarNotWhitelistedError) {
      // Definitive refusals from the provider: nothing was created.
      await releaseReservation(storeId, bookingId, error.message);
      return { ok: false, error: error.message };
    }
    // OUTCOME UNKNOWN (and anything we cannot classify — conservative): the parcel may exist. Keep
    // the reservation, block every re-book until someone reconciles by our order number.
    await withTenant(storeId, (tx) =>
      tx
        .update(schema.shipmentBookings)
        .set({ status: "unknown", failureNote: "Respons provider tidak diterima; cek dashboard provider berdasarkan nomor pesanan sebelum apa pun." })
        .where(eq(schema.shipmentBookings.id, bookingId)),
    );
    console.error("[shipping/mg] booking outcome unknown", input.orderNumber, error instanceof Error ? error.name : "UnknownError");
    return {
      ok: false,
      error: `Status booking ${input.orderNumber} belum diketahui karena respons kurir terputus. Jangan booking ulang; hubungi dukungan TokoΦ untuk rekonsiliasi.`,
    };
  }
  if (!created.ok) {
    await releaseReservation(storeId, bookingId, created.error);
    if (created.httpStatus === 409) return { ok: false, error: "Kurir sedang memproses booking lain. Coba lagi sebentar." };
    return { ok: false, error: `Mengantar menolak booking: ${created.error}` };
  }

  const c = created.data;
  // A waybill only if it is one — never the provider's own ids echoed back.
  const awb = c.cnoteNo && c.cnoteNo !== c.id && c.cnoteNo !== c.orderId ? c.cnoteNo : null;

  // Identity FIRST, in its own txn: if the order write below fails, the accepted booking still names
  // the shipment that exists (adsbookcms `linkAcceptedMengantarShipment`).
  await withTenant(storeId, (tx) =>
    tx
      .update(schema.shipmentBookings)
      .set({ status: "accepted", providerBookingId: c.id, acceptedAt: new Date(), failureNote: c.isPaid ? null : "Booking belum dibayar (saldo Mengantar toko kurang); resi terbit setelah Bayar ongkir." })
      .where(eq(schema.shipmentBookings.id, bookingId)),
  );
  let stored: { awb: string | null; mgOrderCode: string | null } | undefined;
  await withTenant(storeId, async (tx) => {
    const [cur] = await tx.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, reservation.orderId)).limit(1).for("update");
    if (!cur) return;
    [stored] = await tx
      .update(schema.orders)
      .set({
        awb,
        courier: picked.rate.code,
        serviceType: picked.rate.type,
        mgOrderId: c.id,
        mgOrderCode: c.orderId || null,
        mgBatchId: c.batchId || null,
        mgIsPaid: c.isPaid,
        mgCourier: picked.mg.shipment.courier,
        // WHICH account booked it — cancel / pay / tracking reopen exactly this one.
        mgEnv: acc.env,
        mgSellerId: acc.sellerId,
      })
      .where(eq(schema.orders.id, cur.id))
      .returning({ awb: schema.orders.awb, mgOrderCode: schema.orders.mgOrderCode });
    // `diproses`, never `dikirim`: a waybill here is not a pickup (R5). Tracking moves it on.
    if (!shipmentLocked(cur.status)) {
      await applyOrderStatusChange(tx, { storeId, order: { id: cur.id, status: cur.status as OrderStatus }, status: "diproses" });
    }
  });
  return {
    ok: true,
    awb: stored?.awb ?? null,
    kaOrderId: stored?.mgOrderCode ?? c.id,
    awbPending: !stored?.awb,
    pickupAt: slot?.ok ? pickupSlotLabel(slot.startsAt) : "Antar sendiri paket ke gerai kurir (drop-off).",
  };
}

// ── Cancel ──────────────────────────────────────────────────────────────────────────────────────

async function recordMgCancelAnswer(storeId: string, bookingId: string | null, patch: { status: "accepted" | "cancellation_requested"; failureNote: string }): Promise<void> {
  if (!bookingId) return;
  try {
    await withTenant(storeId, (tx) =>
      tx
        .update(schema.shipmentBookings)
        .set(patch)
        .where(and(eq(schema.shipmentBookings.id, bookingId), eq(schema.shipmentBookings.status, "cancellation_requested"))),
    );
  } catch (error) {
    console.error("[shipping/mg] cancel answer not recorded; intent row stands", bookingId, error instanceof Error ? error.name : "UnknownError");
  }
}

/**
 * Cancel a Mengantar shipment: `DELETE /order {courier, ids:[_id]}` — keyed by the provider `_id`,
 * so unlike KiriminAja a fresh booking with no waybill CAN be cancelled. Same intent-before-call
 * discipline as the KiriminAja path: the booking flips to `cancellation_requested` first, the answer
 * is recorded after.
 * MEASURED (sandbox E2E 2026-11-05): a DELETE'd order does NOT turn CANCELED — it VANISHES from
 * `GET /order` a moment later. Left to tracking, that "not found" lands on the reconciler's
 * `attention` branch and asks a human to check a cancellation Mengantar already confirmed. So a reply
 * whose `deletedCount` covers the id (`mgCancel` refuses anything less) IS the vendor's confirmation:
 * it goes through the same reconciler as a tracked CANCELED (→ voided, ids dropped, re-bookable).
 * An outcome-unknown DELETE still waits for tracking (its "not found" stays a human's call).
 */
export async function cancelMengantar(storeId: string, orderNumber: string, opts: MgShippingOptions = {}): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
  const [o] = await withTenant(storeId, (tx) =>
    tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        awb: schema.orders.awb,
        mgOrderId: schema.orders.mgOrderId,
        mgOrderCode: schema.orders.mgOrderCode,
        mgIsPaid: schema.orders.mgIsPaid,
        mgCourier: schema.orders.mgCourier,
        status: schema.orders.status,
        mgEnv: schema.orders.mgEnv,
        mgSellerId: schema.orders.mgSellerId,
      })
      .from(schema.orders)
      .where(eq(schema.orders.number, orderNumber))
      .limit(1),
  );
  if (!o?.mgOrderId || !o.mgCourier) return { ok: false, error: "Pesanan ini belum punya pengiriman." };
  if (shipmentLocked(o.status)) return { ok: false, error: `Pesanan sudah ${o.status} — pengirimannya tidak bisa dibatalkan lagi.` };
  // The account that BOOKED it — never the store's current one if they differ.
  const acc = await openStoreMengantar(storeId, o);
  if (!acc.ok) return { ok: false, error: openFailureMessage(acc.reason) };
  const call = callFor(acc.cfg, opts);

  const intent = await withTenant(storeId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId})::bigint)`);
    const [booking] = await tx
      .select({ id: schema.shipmentBookings.id, status: schema.shipmentBookings.status, acceptedAt: schema.shipmentBookings.acceptedAt })
      .from(schema.shipmentBookings)
      .where(sql`${schema.shipmentBookings.orderId} = ${o.id} and ${schema.shipmentBookings.status} in ('accepted', 'cancellation_requested')`)
      .limit(1)
      .for("update");
    if (booking?.status === "cancellation_requested") return { kind: "pending" as const };
    if (!booking) return { kind: "none" as const };
    await tx
      .update(schema.shipmentBookings)
      .set({ status: "cancellation_requested", failureNote: "Pembatalan sedang diminta ke kurir; jawaban kurir belum tercatat." })
      .where(eq(schema.shipmentBookings.id, booking.id));
    return { kind: "recorded" as const, bookingId: booking.id, acceptedAt: booking.acceptedAt };
  });
  if (intent.kind === "pending") return { ok: false, error: "Permintaan pembatalan sebelumnya masih diproses kurir." };
  // Every booking this file makes has a row; an order with provider ids and no active booking is not
  // something we created — refuse rather than void a shipment we cannot account for.
  if (intent.kind === "none") return { ok: false, error: "Booking pengiriman pesanan ini tidak ditemukan. Hubungi dukungan TokoΦ." };

  let result: MgResult<{ deleted: number }>;
  try {
    result = await mgCancel(o.mgCourier, [o.mgOrderId], call);
  } catch (error) {
    console.error("[shipping/mg] cancellation outcome unknown", orderNumber, error instanceof Error ? error.name : "UnknownError");
    await recordMgCancelAnswer(storeId, intent.bookingId, {
      status: "cancellation_requested",
      failureNote: "Respons kurir terputus saat meminta pembatalan; hasilnya diperiksa otomatis lewat pelacakan.",
    });
    return { ok: false, pending: true, error: "Respons kurir terputus saat meminta pembatalan. Permintaan tercatat dan hasilnya diperiksa otomatis lewat pelacakan; periksa tracking sebelum mencoba lagi." };
  }
  if (!result.ok) {
    // A refusal for a shipment that no longer EXISTS (the seller deleted it in their own Mengantar
    // app; a deleted order vanishes) is not "still registered": read it back with the same account,
    // and only a verified "not found" closes it — through the reconciler, as a confirmed void.
    try {
      const pull = pullMengantar({ number: o.number, awb: o.awb, mgOrderId: o.mgOrderId, mgOrderCode: o.mgOrderCode, mgIsPaid: o.mgIsPaid }, call);
      const back = pull ? await pull : null;
      // Only for a booking old enough to be indexed: a fresh one that "is not there yet" is not gone.
      const age = intent.acceptedAt ? Date.now() - new Date(intent.acceptedAt).getTime() : Infinity;
      if (back?.ok && back.data === null && age >= MG_VANISH_MIN_AGE_MS) {
        const s = await syncOrderFromKa(orderNumber, null, null, null, { kind: "tracked", outcome: "canceled" }, null, { mgOrderId: o.mgOrderId });
        if (s.changed.includes("cancel:voided")) return { ok: true };
      }
    } catch (error) {
      console.error("[shipping/mg] cancel read-back failed", orderNumber, error instanceof Error ? error.name : "UnknownError");
    }
    await recordMgCancelAnswer(storeId, intent.bookingId, { status: "accepted", failureNote: `Kurir menolak pembatalan: ${result.error.slice(0, 400)}` });
    return { ok: false, error: `Mengantar menolak pembatalan: ${result.error}. Pengiriman masih terdaftar di kurir.` };
  }
  await recordMgCancelAnswer(storeId, intent.bookingId, { status: "cancellation_requested", failureNote: "Pembatalan diterima kurir; menunggu konfirmasi lewat pelacakan." });
  try {
    const s = await syncOrderFromKa(orderNumber, null, null, null, { kind: "tracked", outcome: "canceled" }, null, { mgOrderId: o.mgOrderId });
    if (s.changed.includes("cancel:voided")) return { ok: true };
  } catch (error) {
    // The DELETE landed; tracking still closes it (as `attention` at worst). Never report a failure here.
    console.error("[shipping/mg] confirmed cancel not reconciled; tracking will", orderNumber, error instanceof Error ? error.name : "UnknownError");
  }
  return { ok: true, pending: true };
}

// ── Bayar ongkir (the seller's own wallet) ──────────────────────────────────────────────────────

/**
 * "Bayar ongkir": pay the batch a short wallet left unpaid, from THE STORE'S OWN Mengantar wallet
 * (moved here from the old Super Admin platform-wallet screen). The caller passed
 * `requireCapability("orders:write")` — the same capability that booked it. Rules:
 *   · CLAIM: `mg_is_paid false → null` for this store's orders of the batch, in the UPDATE's own WHERE
 *     (inside `withTenant`); a second click finds nothing and sends nothing.
 *   · `null` = requested, unconfirmed — NOT payable again. Outcome-unknown leaves it there; the next
 *     tracking pull settles it (waybill → true, provider isPaid:false → false).
 *   · refusal → back to `false`; success → `true` (the waybill still arrives through tracking).
 */
export async function payMengantarUnpaid(storeId: string, orderNumber: string, opts: MgShippingOptions = {}): Promise<{ ok: boolean; pending?: boolean; message: string }> {
  const [o] = await withTenant(storeId, (tx) =>
    tx
      .select({ batchId: schema.orders.mgBatchId, courier: schema.orders.mgCourier, mgEnv: schema.orders.mgEnv, mgSellerId: schema.orders.mgSellerId, provider: schema.orders.shippingProvider, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.number, orderNumber))
      .limit(1),
  );
  if (!o || o.provider !== "mengantar" || !o.batchId || !o.courier) return { ok: false, message: "Pesanan ini tidak punya booking Mengantar yang belum dibayar." };
  if (shipmentLocked(o.status)) return { ok: false, message: `Pesanan sudah ${o.status}.` };
  const acc = await openStoreMengantar(storeId, o);
  if (!acc.ok) return { ok: false, message: openFailureMessage(acc.reason) };
  const batchId = o.batchId;
  const sameBatch = and(eq(schema.orders.mgBatchId, batchId), eq(schema.orders.shippingProvider, "mengantar"), eq(schema.orders.mgSellerId, acc.sellerId));
  // Orders of this batch ALREADY in flight (an earlier pay whose answer was lost): Mengantar may pay them
  // in this call too, so its count can no longer be matched to OUR claim — read before claiming.
  const inFlight = await withTenant(storeId, (tx) => tx.select({ number: schema.orders.number }).from(schema.orders).where(and(sameBatch, isNull(schema.orders.mgIsPaid))));
  const claimed = await withTenant(storeId, (tx) =>
    tx.update(schema.orders).set({ mgIsPaid: null }).where(and(sameBatch, eq(schema.orders.mgIsPaid, false))).returning({ number: schema.orders.number }),
  );
  if (!claimed.length) return { ok: false, message: "Ongkir pesanan ini tidak lagi berstatus belum dibayar — sudah dibayar, atau pembayarannya sedang dikonfirmasi." };
  const mine = claimed.map((c) => c.number);
  // Settles exactly the rows THIS click claimed — never another click's in-flight row.
  const settle = (to: boolean) =>
    withTenant(storeId, (tx) =>
      tx.update(schema.orders).set({ mgIsPaid: to }).where(and(sameBatch, isNull(schema.orders.mgIsPaid), inArray(schema.orders.number, mine))).returning({ number: schema.orders.number }),
    );

  let r: MgResult<{ paid: number; cnotes: string[] }>;
  try {
    r = await mgPayUnpaid(batchId, o.courier, callFor(acc.cfg, opts));
  } catch (e) {
    console.error("[shipping/mg] pay-unpaid outcome unknown", orderNumber, e instanceof Error ? e.name : "UnknownError");
    return { ok: false, pending: true, message: "Respons Mengantar terputus. Pembayaran mungkin sudah terjadi — statusnya dicek otomatis lewat pelacakan. Jangan bayar ulang." };
  }
  if (!r.ok) {
    await settle(false);
    // Not every refusal is a short wallet ("batch not found" is not) — say what Mengantar said, and only
    // point at the balance as the likely fix, never as the diagnosis.
    return { ok: false, message: `Mengantar menolak pembayaran: ${r.error}. Kalau saldo Mengantar toko kurang, isi saldo di aplikasi Mengantar lalu coba lagi; selain itu hubungi dukungan TokoΦ.` };
  }
  // A SHORT pay (the wallet covered only part of the batch): the reply counts, it does not name which
  // orders were paid. Guessing would mark an unpaid shipment paid — so every claimed order stays
  // `null` (in flight, not re-payable) and tracking settles each one (waybill → paid; isPaid:false → payable).
  if (r.data.paid < claimed.length || inFlight.length > 0) {
    return {
      ok: true,
      pending: true,
      message: `Mengantar membayar ${r.data.paid} dari ${claimed.length} pesanan di batch ini (saldo kurang?). Status tiap pesanan dicek otomatis lewat pelacakan — jangan bayar ulang sebelum statusnya kembali "belum dibayar".`,
    };
  }
  const paid = await settle(true);
  return { ok: true, message: `Ongkir dibayar dari saldo Mengantar toko (${paid.length} pesanan). Resi terbit lewat pelacakan.` };
}

/** The store's Mengantar wallet balance for Pengaturan (a read with the store's own key). `null` = unreadable. */
export async function mengantarStoreBalance(storeId: string, opts: MgShippingOptions = {}): Promise<number | null> {
  const acc = await openStoreMengantar(storeId);
  if (!acc.ok) return null;
  try {
    const r = await mgBalance(callFor(acc.cfg, opts));
    return r.ok ? r.data.balance : null;
  } catch {
    return null;
  }
}
