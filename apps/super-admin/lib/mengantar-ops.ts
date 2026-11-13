import { db, schema } from "@tokophi/db";
import { openFailureMessage, openStoreMengantar } from "@tokophi/db/mengantar-account";
import { and, eq, sql } from "drizzle-orm";
import { mgTrackByCnote, mgTrackByOrderId, shipmentName, type MgResult, type MgTracking } from "@tokophi/lib/mengantar";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mengantar Partner Business API — the OPERATOR half.
//
// The platform-wallet "pay unpaid" screen is GONE: every store pays its own postage from its own
// Mengantar wallet, so "Bayar ongkir" is a SELLER action now (apps/admin/lib/mengantar-shipping.ts).
// What stays here is an operator RECONCILIATION:
//
//   RELEASE OF AN `unknown` BOOKING. A booking whose POST /order answer was lost blocks the order
//   forever (that is the point). The operator reconciles it, using THE STORE'S OWN seller key:
//     · with a provider reference (ORDER_ID or cnote, found on the store's Mengantar account by our
//       order number = `destinationMark`): a verified `GET /order` pull; if the provider has it, ADOPT
//       it — booking `accepted`, order `mg_*` / `awb` / `mg_env` / `mg_seller_id` filled from the PULL
//       and the opener, never from the form;
//     · or the operator attests the provider does NOT have it: booking `failed` (there is no ledger
//       debit to reverse — the seller's wallet pays, owner O3).
//   Both need a reason; both are a CAS on `status = 'unknown'` so two operators cannot both act.
//
// Every function takes the operator's email from the action's `platformGate` — no session read here.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type MgOpsDeps = {
  /** Audit line against a store (`platform_activity`), the action file's `logStore`. */
  log: (storeId: string, text: string) => Promise<void>;
  /** Injected transport (tests). The ACCOUNT is always the booking store's own (`openStoreMengantar`). */
  fetch?: typeof fetch;
};

export const RECONCILE_REASON_MIN = 10;

export type UnknownBookingRow = {
  bookingId: string;
  storeId: string;
  storeName: string;
  orderNumber: string;
  courier: string;
  serviceType: string;
  createdAt: Date;
  note: string | null;
};

/** Mengantar bookings whose POST /order outcome is unknown — each one blocks its order. */
export async function listUnknownMengantar(): Promise<UnknownBookingRow[]> {
  const rows = await db
    .select({
      bookingId: schema.shipmentBookings.id,
      storeId: schema.shipmentBookings.storeId,
      storeName: schema.stores.name,
      orderNumber: schema.orders.number,
      courier: schema.shipmentBookings.courier,
      serviceType: schema.shipmentBookings.serviceType,
      createdAt: schema.shipmentBookings.createdAt,
      note: schema.shipmentBookings.failureNote,
    })
    .from(schema.shipmentBookings)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipmentBookings.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shipmentBookings.storeId))
    .where(and(eq(schema.shipmentBookings.status, "unknown"), eq(schema.orders.shippingProvider, "mengantar")))
    .orderBy(schema.shipmentBookings.createdAt);
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
}

export type ReconcileInput = {
  /** The provider's ORDER_ID or waybill for this shipment. Present = adopt (after a verified pull). */
  reference?: string | null;
  /** The operator searched the provider by our order number and it is NOT there. */
  notAtProvider?: boolean;
  reason: string;
};

/** Release one `unknown` Mengantar booking — adopt it from the store's account, or fail it. */
export async function reconcileUnknownBookingWith(deps: MgOpsDeps, operator: string, bookingId: string, input: ReconcileInput): Promise<{ ok: boolean; message: string }> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < RECONCILE_REASON_MIN) return { ok: false, message: `Alasan wajib diisi (minimal ${RECONCILE_REASON_MIN} karakter).` };
  const ref = input.reference?.trim() ?? "";
  if (!ref && !input.notAtProvider) return { ok: false, message: "Isi referensi provider untuk mengadopsi, atau nyatakan pengiriman tidak ada di provider." };
  if (ref && input.notAtProvider) return { ok: false, message: "Pilih salah satu: adopsi dengan referensi, ATAU tidak ada di provider." };

  const [b] = await db
    .select({
      id: schema.shipmentBookings.id,
      status: schema.shipmentBookings.status,
      storeId: schema.shipmentBookings.storeId,
      orderId: schema.shipmentBookings.orderId,
      serviceType: schema.shipmentBookings.serviceType,
      number: schema.orders.number,
      provider: schema.orders.shippingProvider,
    })
    .from(schema.shipmentBookings)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipmentBookings.orderId))
    .where(eq(schema.shipmentBookings.id, bookingId))
    .limit(1);
  if (!b || b.provider !== "mengantar") return { ok: false, message: "Booking tidak ditemukan." };
  if (b.status !== "unknown") return { ok: false, message: "Booking ini sudah tidak berstatus 'belum diketahui' — sudah ditangani." };

  if (input.notAtProvider) {
    const [won] = await db
      .update(schema.shipmentBookings)
      .set({ status: "failed", failureNote: `Dilepas operator ${operator}: tidak ada di provider — ${reason}`.slice(0, 500) })
      .where(and(eq(schema.shipmentBookings.id, b.id), eq(schema.shipmentBookings.status, "unknown")))
      .returning({ id: schema.shipmentBookings.id });
    if (!won) return { ok: false, message: "Booking ini baru saja ditangani operator lain." };
    await deps.log(b.storeId, `Booking kurir pesanan ${b.number} DILEPAS oleh ${operator} (tidak ada di akun Mengantar toko). Alasan: ${reason}`);
    return { ok: true, message: "Booking dilepas — pesanan bisa dibooking ulang." };
  }

  // ADOPT: the facts come from the provider's answer (THE STORE'S OWN account), never from the form.
  const acc = await openStoreMengantar(b.storeId);
  if (!acc.ok) return { ok: false, message: `Tidak bisa memeriksa: ${openFailureMessage(acc.reason)}` };
  const call = { cfg: acc.cfg, fetch: deps.fetch };
  let r: MgResult<MgTracking | null>;
  try {
    r = await mgTrackByOrderId(ref, call);
    if (r.ok && !r.data) r = await mgTrackByCnote(ref, call);
  } catch {
    return { ok: false, message: "Provider tidak bisa dihubungi. Tidak ada yang diubah." };
  }
  if (!r.ok) return { ok: false, message: `Provider menolak pengecekan: ${r.error}` };
  const t = r.data;
  if (!t) return { ok: false, message: "Referensi itu tidak ditemukan di provider. Tidak ada yang diadopsi." };
  if (t.destinationMark && t.destinationMark !== b.number) return { ok: false, message: `Pengiriman itu milik pesanan ${t.destinationMark}, bukan ${b.number}. Tidak diadopsi.` };
  if (!t.id) return { ok: false, message: "Jawaban provider tidak memuat _id pengiriman — tanpa itu pembatalan tidak mungkin. Tidak diadopsi." };
  const [taken] = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.mgOrderId, t.id)).limit(1);
  if (taken) return { ok: false, message: "Pengiriman itu sudah tercatat pada pesanan lain. Tidak diadopsi." };

  const courier = shipmentName(b.serviceType)?.courier ?? t.courier ?? null;
  const awb = t.cnoteNo && t.cnoteNo !== t.id && t.cnoteNo !== t.orderId ? t.cnoteNo : null;
  const adopted = await db.transaction(async (tx) => {
    const [won] = await tx
      .update(schema.shipmentBookings)
      .set({ status: "accepted", providerBookingId: t.id, acceptedAt: new Date(), failureNote: `Diadopsi operator ${operator}: ${reason}`.slice(0, 500) })
      .where(and(eq(schema.shipmentBookings.id, b.id), eq(schema.shipmentBookings.status, "unknown")))
      .returning({ id: schema.shipmentBookings.id });
    if (!won) return null;
    const [o] = await tx
      .update(schema.orders)
      .set({ mgOrderId: t.id, mgOrderCode: t.orderId, mgBatchId: t.batchId, mgIsPaid: t.isPaid ?? (awb ? true : null), mgCourier: courier, awb, mgEnv: acc.env, mgSellerId: acc.sellerId })
      .where(and(eq(schema.orders.id, b.orderId), sql`${schema.orders.mgOrderId} is null`))
      .returning({ mgOrderId: schema.orders.mgOrderId, awb: schema.orders.awb });
    if (!o) throw new Error("order already carries a provider shipment");
    return o;
  });
  if (!adopted) return { ok: false, message: "Booking ini baru saja ditangani operator lain." };
  await deps.log(b.storeId, `Booking kurir pesanan ${b.number} DIADOPSI oleh ${operator} dari provider (ORDER_ID ${t.orderId ?? "—"}, resi ${adopted.awb ?? "belum"}). Alasan: ${reason}`);
  return { ok: true, message: `Diadopsi — pesanan kini terhubung ke pengiriman ${t.orderId ?? t.id}${adopted.awb ? `, resi ${adopted.awb}` : ""}.` };
}

export type StoreAccountRow = {
  storeId: string;
  storeName: string;
  /** ADR 0019: `stores.shipping_provider` — a row whose store is on KiriminAja is history, not in use. */
  provider: string;
  env: string;
  /** `none` = the store is on Mengantar but has no account row in this env yet. */
  state: string;
  sellerId: string | null;
  partnerId: string | null;
  keyHint: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  updatedAt: Date;
};

/**
 * Every store on Mengantar, and every store holding a Mengantar account row, in the active env — oversight
 * for Super Admin (no keys, a 4-char hint only). ADR 0019: a store set to Mengantar with NO row yet is
 * listed too (state `none`), so "on Mengantar but nothing queued" is visible, and each row says which
 * provider the store is on (a row of a KiriminAja store is kept history, not in use).
 */
export async function listMengantarAccounts(env: string): Promise<StoreAccountRow[]> {
  const rows = await db
    .select({
      storeId: schema.stores.id,
      storeName: schema.stores.name,
      provider: schema.stores.shippingProvider,
      // Columns named in full inside `sql`: drizzle renders an interpolated column UNQUALIFIED there, and
      // with two tables joined an unqualified name is ambiguous or, worse, the wrong table's.
      env: sql<string>`coalesce("store_mengantar_accounts"."env", ${env})`,
      state: sql<string>`coalesce("store_mengantar_accounts"."state", 'none')`,
      sellerId: schema.storeMengantarAccounts.sellerId,
      partnerId: schema.storeMengantarAccounts.partnerId,
      keyHint: schema.storeMengantarAccounts.keyHint,
      lastErrorCode: schema.storeMengantarAccounts.lastErrorCode,
      lastError: schema.storeMengantarAccounts.lastError,
      updatedAt: sql<Date>`coalesce("store_mengantar_accounts"."updated_at", "stores"."created_at")`,
    })
    .from(schema.stores)
    .leftJoin(schema.storeMengantarAccounts, and(eq(schema.storeMengantarAccounts.storeId, schema.stores.id), eq(schema.storeMengantarAccounts.env, env)))
    .where(sql`"stores"."shipping_provider" = 'mengantar' or "store_mengantar_accounts"."store_id" is not null`)
    .orderBy(
      sql`"stores"."shipping_provider" <> 'mengantar'`,
      sql`"store_mengantar_accounts"."state" = 'connected'`,
      sql`coalesce("store_mengantar_accounts"."updated_at", "stores"."created_at")`,
    );
  return rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt) }));
}

export type StrandedOrderRow = {
  storeId: string;
  storeName: string;
  orderNumber: string;
  status: string;
  /** Has a Mengantar shipment already (tracking cannot run) vs still waiting to be booked (cannot ship). */
  booked: boolean;
  /** The store's account state in the order's env — `null` = no account row at all. */
  accountState: string | null;
  /** The order was booked on a seller account the store no longer holds. */
  sellerChanged: boolean;
  placedAt: Date;
};

/**
 * Live Mengantar-stamped orders whose store's seller account cannot serve them: no row, a state other
 * than `connected`, or a different seller than the one that booked it. Such an order cannot be booked
 * (and a booked one cannot be tracked) — and it must NOT be moved to the default provider: its buyer-paid
 * shipping is already the seller's money (`shipping_pass_through_idr`, owner O3). The way out is to
 * restore the store's account (retry / rotate above), so the operator has to SEE them. `rotating` is a
 * seconds-long state and is not listed.
 */
export async function listStrandedMengantar(env: string): Promise<StrandedOrderRow[]> {
  const rows = (await db.execute(sql`
    select o.store_id::text as "storeId", s.name as "storeName", o.number as "orderNumber", o.status::text as status,
           (o.mg_order_id is not null) as booked, a.state::text as "accountState",
           (o.mg_seller_id is not null and a.seller_id is distinct from o.mg_seller_id) as "sellerChanged",
           o.placed_at as "placedAt"
      from orders o
      join stores s on s.id = o.store_id
      left join store_mengantar_accounts a on a.store_id = o.store_id and a.env = coalesce(o.mg_env, ${env})
     where o.shipping_provider = 'mengantar'
       and o.status in ('baru', 'diproses', 'dikirim')
       and (a.state is null or a.state not in ('connected', 'rotating')
            or (o.mg_seller_id is not null and a.seller_id is distinct from o.mg_seller_id))
     order by o.placed_at
     limit 200
  `)) as unknown as (Omit<StrandedOrderRow, "placedAt"> & { placedAt: string | Date })[];
  return rows.map((r) => ({ ...r, placedAt: new Date(r.placedAt) }));
}
